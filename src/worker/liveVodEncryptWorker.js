/**
 * Encrypt plain live HLS from R2 recording prefix and promote to standard VOD path.
 * Source is MediaMTX fmp4 under live/recordings/{sessionId}/ (append-only), finalized as EVENT.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const db = require('../../db');
const r2Storage = require('../services/r2StorageService');
const r2LiveStorage = require('../services/r2LiveStorageService');
const keyStorage = require('../services/keyStorageService');
const errorLogService = require('../services/errorLogService');
const liveSegmentUploader = require('./liveSegmentUploader');

function isLiveMediaKey(key) {
  return /\.(ts|m4s|mp4|aac|m3u8)$/i.test(String(key || ''));
}

function isMediaSegmentKey(key) {
  return /\.(ts|m4s|mp4|aac)$/i.test(String(key || ''));
}

function normalizePrefix(prefix) {
  return String(prefix || '').trim().replace(/\/+$/, '');
}

function ensureLocalVodPlaylists(inputDir) {
  const files = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.m3u8')) files.push(full);
    }
  };
  walk(inputDir);

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter((l) => !/^#EXT-X-SERVER-CONTROL:/i.test(l.trim()));
    const isMaster = lines.some(
      (l) => l.startsWith('#EXT-X-STREAM-INF') || l.startsWith('#EXT-X-MEDIA:')
    );
    if (!isMaster) {
      if (!lines.some((l) => l.startsWith('#EXT-X-PLAYLIST-TYPE:'))) {
        const td = lines.findIndex((l) => l.startsWith('#EXT-X-TARGETDURATION:'));
        lines.splice(td >= 0 ? td + 1 : 2, 0, '#EXT-X-PLAYLIST-TYPE:EVENT');
      }
      while (lines.length && lines[lines.length - 1] === '') lines.pop();
      if (!lines.some((l) => l.trim() === '#EXT-X-ENDLIST')) lines.push('#EXT-X-ENDLIST');
    }
    fs.writeFileSync(filePath, `${lines.join('\n').trim()}\n`);
  }
}

class LiveVodEncryptWorker {
  async processTask(task) {
    const log = (msg, ...args) => console.log(`[LiveVodEncrypt] [Task ${task.id}] ${msg}`, ...args);
    let workDir = null;

    try {
      await db.query(
        `UPDATE video_processing_tasks SET started_at = NOW(), processing_stage = 'downloading', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );

      const videoRes = await db.query('SELECT * FROM videos WHERE id = $1', [task.video_id]);
      const video = videoRes.rows[0];
      if (!video) throw new Error('Video not found');

      try {
        const finalized = await liveSegmentUploader.finalizeSessionRecording(task.video_id);
        log(
          'Pre-encrypt finalize: ok=%s reason=%s segments=%s',
          finalized.ok,
          finalized.reason,
          finalized.segmentCount
        );
      } catch (finErr) {
        log('Pre-encrypt finalize skipped: %s', finErr.message);
      }

      const candidates = [
        normalizePrefix(task.source_r2_prefix),
        normalizePrefix(r2LiveStorage.getLiveRecordingPrefix(task.video_id)),
        normalizePrefix(r2LiveStorage.getLiveSessionPrefix(task.video_id)),
      ].filter(Boolean);
      const uniquePrefixes = [...new Set(candidates)];

      let sourcePrefix = null;
      let allKeys = [];
      let keys = [];
      let mediaKeys = [];

      for (const prefix of uniquePrefixes) {
        log('Listing live recording at %s', prefix);
        const listed = await r2Storage.listObjects(prefix);
        const filtered = listed.filter(isLiveMediaKey);
        const media = filtered.filter(isMediaSegmentKey);
        log('Found objects=%d media=%d (prefix=%s)', listed.length, media.length, prefix);
        if (media.length > 0) {
          sourcePrefix = prefix;
          allKeys = listed;
          keys = filtered;
          mediaKeys = media;
          break;
        }
        if (listed.length > 0 && allKeys.length === 0) {
          allKeys = listed;
          sourcePrefix = prefix;
        }
      }

      if (!sourcePrefix || mediaKeys.length === 0) {
        const sample = allKeys.slice(0, 12).join(', ') || '(none)';
        throw new Error(
          `No live segments found in R2 under ${uniquePrefixes.join(' | ') || '(missing prefix)'} ` +
            `(objects=${allKeys.length}, sample=${sample})`
        );
      }

      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-vod-'));
      const inputDir = path.join(workDir, 'input');
      const outputDir = path.join(workDir, 'output');
      fs.mkdirSync(inputDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });

      for (const key of keys) {
        let rel = key.slice(sourcePrefix.length);
        if (rel.startsWith('/')) rel = rel.slice(1);
        if (!rel || rel.includes('..')) continue;
        const localPath = path.join(inputDir, rel);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        await r2Storage.downloadToPath(key, localPath);
      }

      ensureLocalVodPlaylists(inputDir);

      const masterLocal = path.join(inputDir, 'master.m3u8');
      const videoPlaylistLocal = path.join(inputDir, '720p', 'playlist.m3u8');
      const audioPlaylistLocal = path.join(inputDir, '720p', 'audio.m3u8');
      let inputPlaylist = null;
      if (fs.existsSync(videoPlaylistLocal)) inputPlaylist = videoPlaylistLocal;
      else if (fs.existsSync(masterLocal)) inputPlaylist = masterLocal;
      else throw new Error('Live playlist not found after download from R2');

      const keyTargetDir = path.join(workDir, 'keys');
      fs.mkdirSync(keyTargetDir, { recursive: true });
      const keyPath = await keyStorage.getKeyLocalPath(task.video_id, keyTargetDir);
      const keyInfoPath = path.join(keyTargetDir, 'key_info');
      fs.writeFileSync(keyInfoPath, `/v1/video/get-key?id=${task.video_id}\n${keyPath}`);

      await db.query(
        `UPDATE video_processing_tasks SET processing_stage = 'encrypting', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );

      const outPlaylist = path.join(outputDir, '720p', 'playlist.m3u8');
      fs.mkdirSync(path.dirname(outPlaylist), { recursive: true });
      const hasSeparateAudio = fs.existsSync(audioPlaylistLocal);

      const runEncrypt = (videoCodecArgs) =>
        new Promise((resolve, reject) => {
          const cmd = ffmpeg();
          cmd.input(inputPlaylist).inputOptions([
            '-allowed_extensions', 'ALL',
            '-protocol_whitelist', 'file,crypto,data',
          ]);
          if (hasSeparateAudio && inputPlaylist === videoPlaylistLocal) {
            cmd.input(audioPlaylistLocal).inputOptions([
              '-allowed_extensions', 'ALL',
              '-protocol_whitelist', 'file,crypto,data',
            ]);
          }
          const mapArgs =
            hasSeparateAudio && inputPlaylist === videoPlaylistLocal
              ? ['-map', '0:v:0', '-map', '1:a:0']
              : [];
          cmd
            .outputOptions([
              ...mapArgs,
              ...videoCodecArgs,
              '-c:a', 'aac',
              '-b:a', '128k',
              '-ar', '48000',
              '-shortest',
              '-hls_time', '2',
              '-hls_list_size', '0',
              '-hls_playlist_type', 'vod',
              '-hls_key_info_file', keyInfoPath,
              '-hls_segment_filename', path.join(outputDir, '720p', 'seg_%05d.ts'),
              '-f', 'hls',
            ])
            .output(outPlaylist)
            .on('start', (cmdline) => log('FFmpeg: %s', cmdline))
            .on('progress', (p) => { if (p.timemark) log('FFmpeg progress %s', p.timemark); })
            .on('error', reject)
            .on('end', resolve)
            .run();
        });

      try {
        log('Encrypting with video copy + AAC audio (%d media files)', mediaKeys.length);
        await runEncrypt(['-c:v', 'copy']);
      } catch (copyErr) {
        log('Video copy failed (%s) — re-encoding H.264', copyErr.message);
        try {
          fs.rmSync(path.join(outputDir, '720p'), { recursive: true, force: true });
          fs.mkdirSync(path.join(outputDir, '720p'), { recursive: true });
        } catch (_) {}
        await runEncrypt([
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '28',
          '-pix_fmt', 'yuv420p',
        ]);
      }

      fs.writeFileSync(
        path.join(outputDir, 'master.m3u8'),
        [
          '#EXTM3U',
          '#EXT-X-VERSION:3',
          '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
          '720p/playlist.m3u8',
          '',
        ].join('\n')
      );

      if (!video.r2_key) throw new Error('Video missing r2_key for VOD promote');

      const processingPrefix = `${video.r2_key}/.processing/${task.id}`;
      log('Uploading encrypted HLS to %s', processingPrefix);
      await r2Storage.uploadDirectory(outputDir, processingPrefix);
      await r2Storage.promoteProcessingPrefix(processingPrefix, video.r2_key, ['720p']);
      await r2Storage.verifyHlsAtPrefix(video.r2_key, ['720p']);

      await r2LiveStorage.cleanupLiveSession(task.video_id);

      await db.query(`UPDATE videos SET status = 'active' WHERE id = $1`, [task.video_id]);
      await db.query(
        `UPDATE video_processing_tasks SET status = 'completed', processing_stage = NULL, updated_at = NOW() WHERE id = $1`,
        [task.id]
      );
      log('Completed live VOD encrypt for video %s', task.video_id);
    } catch (err) {
      console.error('[LiveVodEncrypt] failed:', err.message);
      await db.query(
        `UPDATE video_processing_tasks SET status = 'failed', error_message = $1, processing_stage = NULL, updated_at = NOW() WHERE id = $2`,
        [err.message, task.id]
      ).catch(() => {});
      await errorLogService
        .logWorkerError(err, { taskId: task.id, videoId: task.video_id, stage: 'live_hls_encrypt' })
        .catch(() => {});
      if (workDir && fs.existsSync(workDir)) {
        try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
      }
      throw err;
    }

    if (workDir && fs.existsSync(workDir)) {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {}
    }
  }
}

module.exports = new LiveVodEncryptWorker();
