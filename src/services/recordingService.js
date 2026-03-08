const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

// Assuming storage is at root/storage (Site/storage)
// __dirname is .../backend/src/services
// ../../../storage is .../Site/storage
const STORAGE_ROOT = path.resolve(__dirname, '../../../storage');
const RECORDINGS_DIR = path.join(STORAGE_ROOT, 'recordings');
const VOD_DIR = path.join(STORAGE_ROOT, 'vod');

// Ensure directories exist
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
if (!fs.existsSync(VOD_DIR)) fs.mkdirSync(VOD_DIR, { recursive: true });

class RecordingService {
    async findLatestRecording(lessonId) {
        const log = (msg, ...args) => console.log('[RecordingService] [findLatestRecording]', msg, ...args);
        try {
            log('Looking for recordings for lessonId=%s in %s', lessonId, RECORDINGS_DIR);
            const files = await fs.promises.readdir(RECORDINGS_DIR);
            const matches = files.filter(f => f.startsWith(lessonId) && f.endsWith('.flv'));
            if (matches.length === 0) {
                log('No .flv files found for lesson %s', lessonId);
                return null;
            }
            const fileStats = await Promise.all(matches.map(async f => {
                const stat = await fs.promises.stat(path.join(RECORDINGS_DIR, f));
                return { name: f, mtime: stat.mtime };
            }));
            fileStats.sort((a, b) => b.mtime - a.mtime);
            const chosen = path.join(RECORDINGS_DIR, fileStats[0].name);
            log('Using latest recording: %s', fileStats[0].name);
            return chosen;
        } catch (err) {
            console.error('[RecordingService] [findLatestRecording] Error:', err);
            return null;
        }
    }

    async processRecording(lessonId) {
        const log = (msg, ...args) => console.log('[RecordingService] [processRecording]', msg, ...args);
        const inputPath = await this.findLatestRecording(lessonId);
        if (!inputPath) throw new Error('Recording not found');

        const outputDir = path.join(VOD_DIR, lessonId);
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, 'index.m3u8');

        log('Starting FFmpeg transcoding. lessonId=%s', lessonId);
        log('Input: %s', inputPath);
        log('Output: %s', outputPath);
        log('Options: libx264, CRF 23, preset veryfast, AAC 128k, HLS 10s segments');

        return new Promise((resolve, reject) => {
            let lastPct = 0;
            ffmpeg(inputPath)
                .outputOptions([
                    '-c:v libx264',
                    '-crf 23',
                    '-preset veryfast',
                    '-c:a aac',
                    '-b:a 128k',
                    '-hls_time 10',
                    '-hls_list_size 0',
                    '-f hls'
                ])
                .output(outputPath)
                .on('start', (cmdLine) => {
                    log('FFmpeg command: %s', cmdLine);
                })
                .on('progress', (progress) => {
                    if (progress.percent != null && progress.percent > 0) {
                        const pct = Math.floor(progress.percent);
                        if (pct >= lastPct + 15) {
                            lastPct = pct;
                            log('Progress: ~%s%%', Math.min(100, pct));
                        }
                    }
                })
                .on('end', async () => {
                    log('FFmpeg transcoding finished.');
                    try {
                        await fs.promises.unlink(inputPath);
                        log('Deleted raw FLV: %s', inputPath);
                    } catch (e) {
                        console.error('[RecordingService] Failed to delete raw file:', e);
                    }
                    resolve(`/vod/${lessonId}/index.m3u8`);
                })
                .on('error', (err) => {
                    console.error('[RecordingService] [processRecording] FFmpeg error:', err.message);
                    reject(err);
                })
                .run();
        });
    }

    async discardRecording(lessonId) {
        console.log('[RecordingService] [discardRecording] lessonId=%s', lessonId);
        const inputPath = await this.findLatestRecording(lessonId);
        if (inputPath) {
            await fs.promises.unlink(inputPath);
            console.log('[RecordingService] [discardRecording] Deleted: %s', inputPath);
            return true;
        }
        console.log('[RecordingService] [discardRecording] No recording found to discard');
        return false;
    }
}

module.exports = new RecordingService();