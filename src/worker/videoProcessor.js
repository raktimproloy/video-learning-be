const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const db = require('../../db');
const r2Storage = require('../services/r2StorageService');

const KEYS_ROOT_DIR = process.env.KEYS_ROOT_DIR || path.join(__dirname, '../../keys');

const getDirSize = (dirPath) => {
    let size = 0;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) {
            size += getDirSize(filePath);
        } else {
            size += stats.size;
        }
    }
    return size;
};

async function uploadDirToR2(localDir, r2KeyPrefix) {
    const entries = fs.readdirSync(localDir, { withFileTypes: true });
    for (const e of entries) {
        const localPath = path.join(localDir, e.name);
        const relativePath = path.relative(localDir, localPath).split(path.sep).join('/');
        const r2Key = r2KeyPrefix ? `${r2KeyPrefix}/${relativePath}` : relativePath;
        if (e.isDirectory()) {
            await uploadDirToR2(localPath, r2KeyPrefix ? `${r2KeyPrefix}/${e.name}` : e.name);
        } else {
            const ext = path.extname(e.name).toLowerCase();
            const contentType = ext === '.m3u8' ? 'application/vnd.apple.mpegurl' : ext === '.ts' ? 'video/mp2t' : 'application/octet-stream';
            await r2Storage.uploadFromPath(localPath, r2Key, contentType);
        }
    }
}

class VideoProcessor {
    async processTask(task) {
        console.log(`Starting task ${task.id} for video ${task.video_id}`);
        let workDir = null;

        try {
            const videoRes = await db.query('SELECT * FROM videos WHERE id = $1', [task.video_id]);
            if (videoRes.rows.length === 0) throw new Error('Video not found');
            const video = videoRes.rows[0];
            const useR2 = video.storage_provider === 'r2' && video.r2_key && r2Storage.isConfigured;

            let sourcePath;
            let outputDir;
            let stagingDirToDelete = null;

            if (useR2) {
                sourcePath = video.storage_path;
                if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
                    const dir = sourcePath;
                    const mp4 = path.join(dir, 'input.mp4');
                    const webm = path.join(dir, 'input.webm');
                    sourcePath = fs.existsSync(mp4) ? mp4 : fs.existsSync(webm) ? webm : mp4;
                }
                if (!fs.existsSync(sourcePath)) throw new Error(`Staging file not found at ${sourcePath}`);
                workDir = path.join(os.tmpdir(), `video-${task.id}`);
                fs.mkdirSync(workDir, { recursive: true });
                outputDir = workDir;
                stagingDirToDelete = path.dirname(sourcePath);
            } else {
                sourcePath = video.storage_path;
                if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
                    const dir = sourcePath;
                    const mp4 = path.join(dir, 'input.mp4');
                    const webm = path.join(dir, 'input.webm');
                    sourcePath = fs.existsSync(mp4) ? mp4 : fs.existsSync(webm) ? webm : mp4;
                }
                if (!fs.existsSync(sourcePath)) throw new Error(`Source file not found at ${sourcePath}`);
                outputDir = path.dirname(sourcePath);
                if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
            }

            // 3. Prepare Encryption Key Info
            const keyDir = path.join(KEYS_ROOT_DIR, task.video_id);
            const keyPath = path.join(keyDir, 'enc.key');
            
            if (!fs.existsSync(keyPath)) {
                throw new Error(`Encryption key not found at ${keyPath}`);
            }

            const keyInfoPath = path.join(keyDir, 'key_info');
            const keyUri = `/v1/video/get-key?id=${task.video_id}`; 
            
            // Format: URI\nKeyPath\nIV(optional)
            const keyInfoContent = `${keyUri}\n${path.resolve(keyPath)}`;
            fs.writeFileSync(keyInfoPath, keyInfoContent);

            // 3b. Remux WebM to MP4 if needed (MediaRecorder WebM can be malformed for ffprobe)
            const isWebm = sourcePath.toLowerCase().endsWith('.webm');
            if (isWebm) {
                const dir = path.dirname(sourcePath);
                const remuxedPath = path.join(dir, 'input_remuxed.mp4');
                try {
                    await new Promise((resolve, reject) => {
                        ffmpeg(sourcePath)
                            .outputOptions(['-c copy', '-movflags', '+faststart'])
                            .output(remuxedPath)
                            .on('end', () => resolve())
                            .on('error', (err) => reject(err))
                            .run();
                    });
                    sourcePath = remuxedPath;
                } catch (remuxErr) {
                    console.error('WebM remux failed:', remuxErr);
                    throw new Error('Recording file is invalid or incomplete. Try recording for a few seconds before saving.');
                }
            }

            // 4. Analyze Input Video (FFprobe)
            const metadata = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(sourcePath, (err, data) => {
                    if (err) return reject(err);
                    resolve(data);
                });
            });

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
            
            if (!videoStream) {
                throw new Error('No video stream found in input file');
            }

            const origWidth = videoStream.width;
            const origHeight = videoStream.height;
            console.log(`Original Video: ${origWidth}x${origHeight}. Audio: ${audioStream ? 'Yes' : 'No'}`);

            // 5. Determine Compression Settings
            // Logic:
            // - If task.codec_preference is 'h265', use libx265, CRF 26 (Pro/Low Storage).
            // - If task.codec_preference is 'h264' (or default), use libx264, CRF 28 (100% Support).
            
            let codec = 'libx264';
            let crf = 28; // Default "Professional Safe" CRF for H.264
            
            if (task.codec_preference === 'h265') {
                codec = 'libx265';
                crf = 26; // Default "Professional Low Storage" CRF for H.265
            } else {
                // Default fallback or explicit h264
                codec = 'libx264';
                crf = 28;
            }

            // Allow override if specifically provided in task (e.g. for testing)
            if (task.crf) {
                crf = task.crf;
            }
            
            const preset = 'slow'; // Professional grade compression
            
            // 6. Use original resolution only (no multiple resolutions)
            // Round dimensions to even numbers (ffmpeg requirement for yuv420p)
            const safeW = origWidth % 2 === 0 ? origWidth : origWidth - 1;
            const safeH = origHeight % 2 === 0 ? origHeight : origHeight - 1;
            const targetResolutions = [{
                w: safeW,
                h: safeH,
                name: 'original',
                bandwidth: 2500000 // Estimation for original quality
            }];
            console.log(`Using original resolution only: ${safeW}x${safeH} (encrypted, no multi-resolution)`);

            // 7. Process each resolution
            const variants = [];

            for (const res of targetResolutions) {
                console.log(`Processing resolution: ${res.name} with ${codec}, CRF ${crf}, Preset ${preset}`);
                
                const resDir = path.join(outputDir, res.name);
                if (!fs.existsSync(resDir)) {
                    fs.mkdirSync(resDir, { recursive: true });
                }

                const playlistName = `playlist.m3u8`;
                const playlistPath = path.join(resDir, playlistName);

                await new Promise((resolve, reject) => {
                    const outputOpts = [
                        '-map', '0:v:0',
                        '-map', '0:a:0?',
                        `-crf ${crf}`,
                        `-preset ${preset}`,
                        '-hls_time 6',
                        '-hls_playlist_type vod',
                        `-hls_key_info_file ${keyInfoPath}`,
                        '-hls_segment_filename', path.join(resDir, 'segment_%03d.ts')
                    ];
                    let command = ffmpeg(sourcePath)
                        .videoCodec(codec)
                        .size(`${res.w}x${res.h}`)
                        .outputOptions(outputOpts);
                    
                    if (audioStream) {
                        command
                            .audioCodec('aac')
                            .audioChannels(2)
                            .audioFrequency(44100)
                            .audioBitrate('128k');
                    } else {
                        command.outputOptions('-an');
                    }
                    
                    if (codec === 'libx265') {
                        command.outputOptions('-tag:v hvc1');
                    }

                    command
                        .output(playlistPath)
                        .on('start', (cmdLine) => {
                            console.log(`[${res.name}] Spawned Ffmpeg: ${cmdLine}`);
                        })
                        .on('error', (err) => {
                            console.error(`[${res.name}] Error:`, err);
                            reject(err);
                        })
                        .on('end', () => {
                            console.log(`[${res.name}] Completed.`);
                            resolve();
                        })
                        .run();
                });

                let codecs = codec === 'libx265' ? 'hvc1.1.4.L93.B0' : 'avc1.4d401f';
                if (audioStream) {
                    codecs += ',mp4a.40.2';
                }

                variants.push({
                    bandwidth: res.bandwidth,
                    resolution: `${res.w}x${res.h}`,
                    path: `${res.name}/${playlistName}`, // Relative path for master playlist
                    codecs: codecs
                });
            }

            // 8. Create Master Playlist
            const masterPlaylistPath = path.join(outputDir, 'master.m3u8');
            let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n';
            
            for (const variant of variants) {
                masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution},CODECS="${variant.codecs}"\n`;
                masterContent += `${variant.path}\n`;
            }

            fs.writeFileSync(masterPlaylistPath, masterContent);
            console.log('Master playlist created at:', masterPlaylistPath);

            const totalSize = getDirSize(outputDir);

            if (useR2) {
                await uploadDirToR2(outputDir, video.r2_key);
                if (workDir && fs.existsSync(workDir)) {
                    fs.rmSync(workDir, { recursive: true, force: true });
                }
                if (stagingDirToDelete && fs.existsSync(stagingDirToDelete)) {
                    fs.rmSync(stagingDirToDelete, { recursive: true, force: true });
                }
                await db.query('UPDATE videos SET storage_path = $1 WHERE id = $2', ['r2_only', task.video_id]);
            }

            await db.query(
                `UPDATE video_processing_tasks 
                 SET status = 'completed', updated_at = NOW() 
                 WHERE id = $1`,
                [task.id]
            );
            const durationSeconds = metadata.format?.duration != null ? Math.round(Number(metadata.format.duration) * 100) / 100 : null;
            await db.query(
                'UPDATE videos SET size_bytes = $1, duration_seconds = COALESCE(duration_seconds, $2), status = $3 WHERE id = $4',
                [totalSize, durationSeconds, 'active', task.video_id]
            );

            console.log(`Task ${task.id} completed successfully. Duration: ${durationSeconds ?? 'N/A'}s`);

        } catch (error) {
            console.error(`Task ${task.id} failed:`, error);
            await db.query(
                `UPDATE video_processing_tasks 
                 SET status = 'failed', error_message = $1, updated_at = NOW() 
                 WHERE id = $2`,
                [error.message, task.id]
            );
            // Keep status as 'processing' on failure - teacher can retry or set to inactive manually
        }
    }
}

module.exports = new VideoProcessor();
