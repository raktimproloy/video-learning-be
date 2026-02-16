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
        // Look for files starting with lessonId in RECORDINGS_DIR
        try {
            const files = await fs.promises.readdir(RECORDINGS_DIR);
            const matches = files.filter(f => f.startsWith(lessonId) && f.endsWith('.flv'));
            
            if (matches.length === 0) return null;

            // Sort by modification time (descending)
            const fileStats = await Promise.all(matches.map(async f => {
                const stat = await fs.promises.stat(path.join(RECORDINGS_DIR, f));
                return { name: f, mtime: stat.mtime };
            }));

            fileStats.sort((a, b) => b.mtime - a.mtime);
            return path.join(RECORDINGS_DIR, fileStats[0].name);
        } catch (err) {
            console.error("Error finding recording:", err);
            return null;
        }
    }

    async processRecording(lessonId) {
        const inputPath = await this.findLatestRecording(lessonId);
        if (!inputPath) throw new Error('Recording not found');

        const outputDir = path.join(VOD_DIR, lessonId);
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const outputPath = path.join(outputDir, 'index.m3u8');

        console.log(`Starting transcoding for ${lessonId} from ${inputPath}`);

        return new Promise((resolve, reject) => {
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
                .on('end', async () => {
                    console.log('Transcoding finished');
                    // Delete the raw FLV after successful transcoding
                    try {
                        await fs.promises.unlink(inputPath);
                    } catch (e) {
                        console.error("Failed to delete raw file:", e);
                    }
                    resolve(`/vod/${lessonId}/index.m3u8`);
                })
                .on('error', (err) => {
                    console.error('Transcoding error:', err);
                    reject(err);
                })
                .run();
        });
    }

    async discardRecording(lessonId) {
        const inputPath = await this.findLatestRecording(lessonId);
        if (inputPath) {
            await fs.promises.unlink(inputPath);
            return true;
        }
        return false;
    }
}

module.exports = new RecordingService();