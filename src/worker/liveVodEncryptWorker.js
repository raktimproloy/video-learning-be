/**
 * Encrypt plain live HLS from R2 and promote to standard VOD path.
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

      const sourcePrefix = task.source_r2_prefix;
      if (!sourcePrefix) throw new Error('Missing source_r2_prefix for live_hls_encrypt task');

      workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-vod-'));
      const inputDir = path.join(workDir, 'input');
      const outputDir = path.join(workDir, 'output');
      fs.mkdirSync(inputDir, { recursive: true });
      fs.mkdirSync(outputDir, { recursive: true });

      log('Listing segments at %s', sourcePrefix);
      const keys = (await r2Storage.listObjects(sourcePrefix))
        .filter((k) => k.endsWith('.ts') || k.endsWith('.m4s'));
      if (keys.length === 0) throw new Error('No live segments found in R2');

      for (const key of keys) {
        const rel = key.slice(sourcePrefix.length + 1);
        const localPath = path.join(inputDir, rel);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        await r2Storage.downloadToPath(key, localPath);
      }

      const playlistKey = `${sourcePrefix}/720p/playlist.m3u8`;
      let inputPlaylist = path.join(inputDir, '720p', 'playlist.m3u8');
      if (await r2Storage.objectExists(playlistKey)) {
        await r2Storage.downloadToPath(playlistKey, inputPlaylist);
      } else {
        const masterKey = `${sourcePrefix}/master.m3u8`;
        if (await r2Storage.objectExists(masterKey)) {
          await r2Storage.downloadToPath(masterKey, path.join(inputDir, 'master.m3u8'));
          inputPlaylist = path.join(inputDir, 'master.m3u8');
        } else {
          throw new Error('Live playlist not found in R2');
        }
      }

      const keyTargetDir = path.join(workDir, 'keys');
      fs.mkdirSync(keyTargetDir, { recursive: true });
      const keyPath = await keyStorage.getKeyLocalPath(task.video_id, keyTargetDir);
      const keyInfoPath = path.join(keyTargetDir, 'key_info');
      const keyUri = `/v1/video/get-key?id=${task.video_id}`;
      fs.writeFileSync(keyInfoPath, `${keyUri}\n${keyPath}`);

      await db.query(
        `UPDATE video_processing_tasks SET processing_stage = 'encrypting', updated_at = NOW() WHERE id = $1`,
        [task.id]
      );

      const outPlaylist = path.join(outputDir, '720p', 'playlist.m3u8');
      fs.mkdirSync(path.dirname(outPlaylist), { recursive: true });

      await new Promise((resolve, reject) => {
        ffmpeg(inputPlaylist)
          .inputOptions(['-allowed_extensions', 'ALL'])
          .outputOptions([
            '-c copy',
            '-hls_time 2',
            '-hls_list_size 0',
            '-hls_key_info_file', keyInfoPath,
            '-hls_segment_filename', path.join(outputDir, '720p', 'seg_%05d.ts'),
            '-f hls',
          ])
          .output(outPlaylist)
          .on('error', reject)
          .on('end', resolve)
          .run();
      });

      const masterOut = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720',
        '720p/playlist.m3u8',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(outputDir, 'master.m3u8'), masterOut);

      const processingPrefix = `${video.r2_key}/.processing/${task.id}`;
      log('Uploading encrypted HLS to %s', processingPrefix);
      await r2Storage.uploadDirectory(outputDir, processingPrefix);

      await r2Storage.promoteProcessingPrefix(processingPrefix, video.r2_key, ['720p']);
      await r2Storage.verifyHlsAtPrefix(video.r2_key, ['720p']);

      const sessionId = task.video_id;
      await r2LiveStorage.cleanupLiveSession(sessionId);

      await db.query(
        `UPDATE videos SET status = 'active', updated_at = NOW() WHERE id = $1`,
        [task.video_id]
      );
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
      await errorLogService.logWorkerError(err, { taskId: task.id, videoId: task.video_id, stage: 'live_hls_encrypt' }).catch(() => {});
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
