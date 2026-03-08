const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const db = require('../../db');
const r2Storage = require('../services/r2StorageService');
const keyStorage = require('../services/keyStorageService');

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
            console.log(`[VideoProcessor] [R2] Uploading: ${r2Key}`);
            await r2Storage.uploadFromPath(localPath, r2Key, contentType);
        }
    }
}

class VideoProcessor {
    async processTask(task) {
        const log = (msg, ...args) => console.log(`[VideoProcessor] [Task ${task.id}] ${msg}`, ...args);
        const logStep = (step, msg, ...args) => console.log(`[VideoProcessor] [Task ${task.id}] [${step}] ${msg}`, ...args);

        log('Starting processing for video_id=%s', task.video_id);
        let workDir = null;

        try {
            logStep('DB', 'Fetching video record...');
            const videoRes = await db.query('SELECT * FROM videos WHERE id = $1', [task.video_id]);
            if (videoRes.rows.length === 0) throw new Error('Video not found');
            const video = videoRes.rows[0];
            const useR2 = video.storage_provider === 'r2' && video.r2_key && r2Storage.isConfigured;
            const isR2Staging = video.storage_path === 'r2_staging';
            logStep('DB', 'Video found. storage_provider=%s, useR2=%s, isR2Staging=%s', video.storage_provider, useR2, isR2Staging);

            let sourcePath;
            let outputDir;
            let stagingDirToDelete = null;

            if (useR2) {
                logStep('WorkDir', 'Creating temp work directory...');
                workDir = path.join(os.tmpdir(), `video-${task.id}`);
                fs.mkdirSync(workDir, { recursive: true });
                outputDir = workDir;
                logStep('WorkDir', 'Work dir: %s', workDir);

                if (isR2Staging) {
                    logStep('R2', 'Source is R2 staging. Checking for input file...');
                    const r2Mp4 = `${video.r2_key}/staging/input.mp4`;
                    const r2Webm = `${video.r2_key}/staging/input.webm`;
                    const localMp4 = path.join(workDir, 'input.mp4');
                    const localWebm = path.join(workDir, 'input.webm');
                    if (await r2Storage.objectExists(r2Mp4)) {
                        logStep('R2', 'Downloading staging input.mp4 from R2...');
                        await r2Storage.downloadToPath(r2Mp4, localMp4);
                        sourcePath = localMp4;
                        logStep('R2', 'Download complete: %s', localMp4);
                    } else if (await r2Storage.objectExists(r2Webm)) {
                        logStep('R2', 'Downloading staging input.webm from R2...');
                        await r2Storage.downloadToPath(r2Webm, localWebm);
                        sourcePath = localWebm;
                        logStep('R2', 'Download complete: %s', localWebm);
                    } else {
                        throw new Error('Staging file not found in R2. Try re-uploading the video.');
                    }
                    stagingDirToDelete = null;
                } else {
                    logStep('Source', 'Legacy/local staging. Checking path: %s', video.storage_path);
                    let localPath = video.storage_path;
                    let found = false;
                    if (localPath && fs.existsSync(localPath)) {
                        if (fs.statSync(localPath).isDirectory()) {
                            const mp4 = path.join(localPath, 'input.mp4');
                            const webm = path.join(localPath, 'input.webm');
                            sourcePath = fs.existsSync(mp4) ? mp4 : fs.existsSync(webm) ? webm : mp4;
                        } else {
                            sourcePath = localPath;
                        }
                        found = fs.existsSync(sourcePath);
                    }
                    if (!found) {
                        logStep('R2', 'Local not found. Fallback: downloading from R2 staging...');
                        const r2Mp4 = `${video.r2_key}/staging/input.mp4`;
                        const r2Webm = `${video.r2_key}/staging/input.webm`;
                        const localMp4 = path.join(workDir, 'input.mp4');
                        const localWebm = path.join(workDir, 'input.webm');
                        if (await r2Storage.objectExists(r2Mp4)) {
                            await r2Storage.downloadToPath(r2Mp4, localMp4);
                            sourcePath = localMp4;
                            logStep('R2', 'Downloaded input.mp4');
                        } else if (await r2Storage.objectExists(r2Webm)) {
                            await r2Storage.downloadToPath(r2Webm, localWebm);
                            sourcePath = localWebm;
                            logStep('R2', 'Downloaded input.webm');
                        } else {
                            throw new Error(`Staging file not found. The video was uploaded before R2 staging was enabled. Please delete and re-upload the video.`);
                        }
                        stagingDirToDelete = null;
                    } else {
                        stagingDirToDelete = path.dirname(sourcePath);
                        logStep('Source', 'Using local source: %s', sourcePath);
                    }
                }
            } else {
                logStep('Source', 'Using local storage. Path: %s', video.storage_path);
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
                logStep('Source', 'Resolved source file: %s', sourcePath);
            }

            // 3. Prepare Encryption Key Info
            logStep('Key', 'Preparing encryption key...');
            const keyTargetDir = workDir || path.join(os.tmpdir(), `video-key-${task.id}`);
            if (!fs.existsSync(keyTargetDir)) {
                fs.mkdirSync(keyTargetDir, { recursive: true });
            }
            const keyPath = await keyStorage.getKeyLocalPath(task.video_id, keyTargetDir);
            logStep('Key', 'Key local path: %s', keyPath);

            const keyInfoPath = path.join(keyTargetDir, 'key_info');
            const keyUri = `/v1/video/get-key?id=${task.video_id}`;
            // Format: URI\nKeyPath\nIV(optional)
            const keyInfoContent = `${keyUri}\n${keyPath}`;
            fs.writeFileSync(keyInfoPath, keyInfoContent);
            logStep('Key', 'Key info file written: %s (URI: %s)', keyInfoPath, keyUri);

            // 3b. Remux WebM to MP4 if needed
            const isWebm = sourcePath.toLowerCase().endsWith('.webm');
            if (isWebm) {
                logStep('FFmpeg', 'WebM detected. Remuxing to MP4 (copy, no re-encode)...');
                const dir = path.dirname(sourcePath);
                const remuxedPath = path.join(dir, 'input_remuxed.mp4');
                try {
                    await new Promise((resolve, reject) => {
                        ffmpeg(sourcePath)
                            .outputOptions(['-c copy', '-movflags', '+faststart'])
                            .output(remuxedPath)
                            .on('start', (cmdLine) => {
                                logStep('FFmpeg', 'Remux command: %s', cmdLine);
                            })
                            .on('end', () => {
                                logStep('FFmpeg', 'Remux completed. Using: %s', remuxedPath);
                                resolve();
                            })
                            .on('error', (err) => reject(err))
                            .run();
                    });
                    sourcePath = remuxedPath;
                } catch (remuxErr) {
                    console.error('[VideoProcessor] [Task %s] WebM remux failed:', task.id, remuxErr);
                    throw new Error('Recording file is invalid or incomplete. Try recording for a few seconds before saving.');
                }
            }

            // 4. Analyze Input Video (FFprobe)
            logStep('FFprobe', 'Analyzing input video...');
            const metadata = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(sourcePath, (err, data) => {
                    if (err) return reject(err);
                    resolve(data);
                });
            });
            logStep('FFprobe', 'Probe done. Streams: %s', metadata.streams?.length ?? 0);

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

            if (!videoStream) {
                throw new Error('No video stream found in input file');
            }

            const origWidth = videoStream.width;
            const origHeight = videoStream.height;
            logStep('FFprobe', 'Video: %sx%s, codec=%s. Audio: %s', origWidth, origHeight, videoStream.codec_name || 'unknown', audioStream ? `Yes (${audioStream.codec_name || 'unknown'})` : 'No');
            if (metadata.format && metadata.format.duration) {
                logStep('FFprobe', 'Duration: %s seconds', Number(metadata.format.duration).toFixed(2));
            }

            // 5. Determine Compression Settings (CPU-friendly: veryfast preset + thread limit so API stays responsive)
            let codec = 'libx264';
            let crf = 28;

            if (task.codec_preference === 'h265') {
                codec = 'libx265';
                crf = 26;
            } else {
                codec = 'libx264';
                crf = 28;
            }
            if (task.crf) crf = task.crf;
            const preset = 'veryfast'; // Lower CPU than 'slow'; keeps API responsive when worker runs in same process
            const numCpus = Math.max(1, typeof os.cpus === 'function' ? os.cpus().length : 4);
            const ffmpegThreads = Math.max(2, Math.min(4, numCpus - 2)); // Leave ≥2 cores for Node/API
            logStep('Encode', 'Codec=%s, CRF=%s, Preset=%s, Threads=%s (cpus=%s)', codec, crf, preset, ffmpegThreads, numCpus);

            // 6. Use original resolution only
            const safeW = origWidth % 2 === 0 ? origWidth : origWidth - 1;
            const safeH = origHeight % 2 === 0 ? origHeight : origHeight - 1;
            const targetResolutions = [{
                w: safeW,
                h: safeH,
                name: 'original',
                bandwidth: 2500000
            }];
            logStep('Encode', 'Target resolution: %sx%s (single variant, encrypted)', safeW, safeH);

            // 7. Process each resolution (encrypting stage for UI)
            await db.query(
                `UPDATE video_processing_tasks SET processing_stage = $1, updated_at = NOW() WHERE id = $2`,
                ['encrypting', task.id]
            );

            const variants = [];

            for (const res of targetResolutions) {
                logStep('FFmpeg', 'Starting encode+encrypt for resolution "%s" (%sx%s)...', res.name, res.w, res.h);

                const resDir = path.join(outputDir, res.name);
                if (!fs.existsSync(resDir)) {
                    fs.mkdirSync(resDir, { recursive: true });
                }
                logStep('FFmpeg', '[%s] Output dir: %s', res.name, resDir);

                const playlistName = `playlist.m3u8`;
                const playlistPath = path.join(resDir, playlistName);

                await new Promise((resolve, reject) => {
                    const outputOpts = [
                        '-threads', String(ffmpegThreads),
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
                            logStep('FFmpeg', '[%s] Command: %s', res.name, cmdLine);
                        })
                        .on('progress', (progress) => {
                            if (progress.percent != null && progress.percent > 0) {
                                const pct = Math.floor(progress.percent);
                                if (!command._lastProgressPct || pct >= command._lastProgressPct + 10) {
                                    command._lastProgressPct = pct;
                                    logStep('FFmpeg', '[%s] Progress: ~%s%%', res.name, Math.min(100, pct));
                                }
                            }
                        })
                        .on('error', (err) => {
                            console.error(`[VideoProcessor] [Task ${task.id}] [FFmpeg] [${res.name}] Error:`, err.message);
                            reject(err);
                        })
                        .on('end', () => {
                            logStep('FFmpeg', '[%s] Encode+encrypt completed.', res.name);
                            resolve();
                        })
                        .run();
                });

                let codecs = codec === 'libx265' ? 'hvc1.1.4.L93.B0' : 'avc1.4d401f';
                if (audioStream) codecs += ',mp4a.40.2';
                variants.push({
                    bandwidth: res.bandwidth,
                    resolution: `${res.w}x${res.h}`,
                    path: `${res.name}/${playlistName}`,
                    codecs: codecs
                });
            }

            // 8. Create Master Playlist
            logStep('HLS', 'Writing master playlist...');
            const masterPlaylistPath = path.join(outputDir, 'master.m3u8');
            let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n';
            for (const variant of variants) {
                masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution},CODECS="${variant.codecs}"\n`;
                masterContent += `${variant.path}\n`;
            }
            fs.writeFileSync(masterPlaylistPath, masterContent);
            logStep('HLS', 'Master playlist: %s', masterPlaylistPath);

            const totalSize = getDirSize(outputDir);
            logStep('Output', 'Total output size: %s bytes (~%s MB)', totalSize, (totalSize / 1024 / 1024).toFixed(2));

            if (useR2) {
                await db.query(
                    `UPDATE video_processing_tasks SET processing_stage = $1, updated_at = NOW() WHERE id = $2`,
                    ['storing', task.id]
                );
                logStep('R2', 'Uploading encrypted HLS to R2 (prefix: %s)...', video.r2_key);
                await uploadDirToR2(outputDir, video.r2_key);
                logStep('R2', 'Upload complete.');
                if (workDir && fs.existsSync(workDir)) {
                    fs.rmSync(workDir, { recursive: true, force: true });
                    logStep('Cleanup', 'Removed work dir: %s', workDir);
                }
                if (stagingDirToDelete && fs.existsSync(stagingDirToDelete)) {
                    fs.rmSync(stagingDirToDelete, { recursive: true, force: true });
                    logStep('Cleanup', 'Removed staging dir: %s', stagingDirToDelete);
                }
                // Always delete R2 staging (initial dummy upload) after successful encrypt+upload so it is never left behind
                try {
                    await r2Storage.deletePrefix(`${video.r2_key}/staging`);
                    logStep('R2', 'Deleted R2 staging (initial upload).');
                } catch (e) {
                    console.warn('[VideoProcessor] [Task %s] Failed to delete R2 staging:', task.id, e.message);
                }
                logStep('DB', 'Updating video storage_path to r2_only...');
                await db.query('UPDATE videos SET storage_path = $1 WHERE id = $2', ['r2_only', task.video_id]);
            }

            logStep('DB', 'Marking task completed...');
            await db.query(
                `UPDATE video_processing_tasks 
                 SET status = 'completed', processing_stage = NULL, updated_at = NOW() 
                 WHERE id = $1`,
                [task.id]
            );
            const durationSeconds = metadata.format?.duration != null ? Math.round(Number(metadata.format.duration) * 100) / 100 : null;
            await db.query(
                'UPDATE videos SET size_bytes = $1, duration_seconds = COALESCE(duration_seconds, $2), status = $3 WHERE id = $4',
                [totalSize, durationSeconds, 'active', task.video_id]
            );
            logStep('DB', 'Video updated: size=%s, duration=%s, status=active', totalSize, durationSeconds ?? 'N/A');

            log('Completed successfully. Duration=%ss', durationSeconds ?? 'N/A');

        } catch (error) {
            console.error(`[VideoProcessor] [Task ${task.id}] FAILED:`, error.message);
            await db.query(
                `UPDATE video_processing_tasks 
                 SET status = 'failed', error_message = $1, processing_stage = NULL, updated_at = NOW() 
                 WHERE id = $2`,
                [error.message, task.id]
            );
        }
    }
}

module.exports = new VideoProcessor();
