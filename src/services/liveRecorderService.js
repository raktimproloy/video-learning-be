const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('../../db');
const r2Storage = require('./r2StorageService');
const recordingDraftService = require('./recordingDraftService');
const liveIngestService = require('./liveIngestService');

/**
 * Live Recording Service
 *
 * Strategy:
 *   1. FFmpeg reads from the SRS RTMP stream and writes to a local tmp file.
 *      Using /tmp (tmpfs in Docker = RAM/swap, not the main disk).
 *   2. On stream end, we upload the completed MP4 to R2, then delete the tmp file.
 *   3. A recording_drafts row is created so the teacher can see it in the Video Editor.
 *
 * Why NOT direct pipe to R2:
 *   Piped fragmented MP4 lacks a proper `moov` atom that ffprobe/ffmpeg needs
 *   to process the file for encryption. Writing to a local tmp file first gives
 *   FFmpeg a chance to finalize the MP4 properly before upload.
 */

/** Map of streamKey -> { command, tmpPath, cleanupPromise } */
const activeRecordings = new Map();

// SRS RTMP host — inside Docker the service name is the hostname.
// Falls back to 127.0.0.1 if SRS_RTMP_HOST env is not set (e.g. local dev).
const SRS_HOST = process.env.SRS_RTMP_HOST || 'srs';
const SRS_PORT = process.env.SRS_RTMP_PORT || '1935';

class LiveRecorderService {
  /**
   * Start recording the live stream to a local tmp file.
   * @param {string} streamKey
   */
  async startRecording(streamKey) {
    if (activeRecordings.has(streamKey)) {
      console.log(`[LiveRecorder] Already recording: ${streamKey}`);
      return;
    }

    try {
      const session = await liveIngestService.getSessionByStreamKey(streamKey);
      if (!session) {
        console.warn(`[LiveRecorder] No session for stream key: ${streamKey}`);
        return;
      }

      const lessonRes = await db.query(
        `SELECT l.course_id, c.teacher_id, l.title
           FROM lessons l
           JOIN courses c ON l.course_id = c.id
          WHERE l.id = $1`,
        [session.lesson_id]
      );
      if (!lessonRes.rows.length) return;
      const { course_id, teacher_id, title } = lessonRes.rows[0];

      const rtmpUrl = `rtmp://${SRS_HOST}:${SRS_PORT}/live/${streamKey}`;
      const tmpFlvPath = path.join(os.tmpdir(), `live-rec-${session.id}-${Date.now()}.flv`);
      const tmpMp4Path = tmpFlvPath.replace('.flv', '.mp4');
      const r2Key = `teachers/${teacher_id}/drafts/recordings/session_${session.id}_${Date.now()}.mp4`;

      console.log(`[LiveRecorder] Starting FFmpeg → tmp file for session ${session.id}`);
      console.log(`[LiveRecorder] RTMP: ${rtmpUrl} → ${tmpFlvPath}`);

      const command = ffmpeg(rtmpUrl)
        .inputOptions([
          '-rtmp_live live',
          // rw_timeout is in microseconds (5,000,000 = 5 seconds)
          // If no data received for 5 seconds, FFmpeg will exit naturally.
          '-rw_timeout 5000000',
        ])
        .outputOptions([
          '-c:v copy',
          '-c:a copy',
          '-f flv',
        ])
        .output(tmpFlvPath)
        .on('start', (cmdline) => {
          console.log(`[LiveRecorder] FFmpeg cmd: ${cmdline}`);
        });

      // When FFmpeg completes (or is killed), we process the FLV file
      const cleanupPromise = new Promise((resolve) => {
        command.on('end', () => {
          console.log(`[LiveRecorder] FFmpeg finished writing FLV for ${streamKey}`);
          resolve();
        });
        command.on('error', (err) => {
          if (!err.message.includes('SIGKILL') && !err.message.includes('SIGINT')) {
            console.error(`[LiveRecorder] FFmpeg error for ${streamKey}:`, err.message);
          }
          resolve();
        });
      }).then(async () => {
        try {
          if (!fs.existsSync(tmpFlvPath)) {
            console.log(`[LiveRecorder] Tmp FLV file not found after recording: ${tmpFlvPath}`);
            return;
          }
          const stat = fs.statSync(tmpFlvPath);
          if (stat.size < 1024) {
            console.warn(`[LiveRecorder] Tmp FLV file too small (${stat.size}B), skipping.`);
            fs.unlinkSync(tmpFlvPath);
            return;
          }

          console.log(`[LiveRecorder] Remuxing FLV to MP4: ${tmpFlvPath} -> ${tmpMp4Path}`);
          await new Promise((remuxResolve, remuxReject) => {
            ffmpeg(tmpFlvPath)
              .outputOptions([
                '-c copy',
                '-movflags +faststart'
              ])
              .output(tmpMp4Path)
              .on('end', remuxResolve)
              .on('error', remuxReject)
              .run();
          });

          const mp4Stat = fs.statSync(tmpMp4Path);
          console.log(`[LiveRecorder] Uploading ${(mp4Stat.size / 1024 / 1024).toFixed(1)}MB to R2: ${r2Key}`);
          await r2Storage.uploadFromPath(tmpMp4Path, r2Key, 'video/mp4');
          console.log(`[LiveRecorder] R2 upload complete: ${r2Key}`);

          // Cleanup tmp files
          try { fs.unlinkSync(tmpFlvPath); } catch (_) {}
          try { fs.unlinkSync(tmpMp4Path); } catch (_) {}

          // Create the recording draft
          await recordingDraftService.create({
            teacherId: teacher_id,
            title: `${title || 'Live'} (Recording)`,
            description: `Live session recorded on ${new Date().toLocaleString()}`,
            courseId: course_id,
            lessonId: session.lesson_id,
            sourceObjectKey: r2Key,
            sourcePrefix: `teachers/${teacher_id}/drafts/recordings/`,
            mimeType: 'video/mp4',
            sizeBytes: mp4Stat.size,
          });
          console.log(`[LiveRecorder] Draft created for session ${session.id}`);

        } catch (err) {
          console.error(`[LiveRecorder] Remux/Upload error for ${streamKey}:`, err.message);
          try { if (fs.existsSync(tmpFlvPath)) fs.unlinkSync(tmpFlvPath); } catch (_) {}
          try { if (fs.existsSync(tmpMp4Path)) fs.unlinkSync(tmpMp4Path); } catch (_) {}
        } finally {
          activeRecordings.delete(streamKey);
        }
      });

      command.run();

      activeRecordings.set(streamKey, { command, tmpFlvPath, tmpMp4Path, cleanupPromise });

    } catch (err) {
      console.error(`[LiveRecorder] startRecording error:`, err.message);
    }
  }

  /**
   * Stop recording instantly. Since we use FLV, we can safely SIGKILL it 
   * and the FLV container remains perfectly valid.
   * @param {string} streamKey
   */
  async stopRecording(streamKey) {
    const rec = activeRecordings.get(streamKey);
    if (!rec) {
      console.log(`[LiveRecorder] No active recording to stop for: ${streamKey}`);
      return;
    }

    console.log(`[LiveRecorder] OBS stream ended. Instantly stopping FFmpeg for ${streamKey}...`);
    
    // Kill instantly. FLV does not corrupt on abrupt termination!
    try {
      rec.command.kill('SIGKILL');
    } catch (e) {
      console.error(`[LiveRecorder] Failed to kill FFmpeg:`, e.message);
    }
  }
}

module.exports = new LiveRecorderService();
