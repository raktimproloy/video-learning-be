const fs = require('fs');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const db = require('../../db');
const r2Storage = require('../services/r2StorageService');
const keyStorage = require('../services/keyStorageService');
const errorLogService = require('../services/errorLogService');
const videoDelivery = require('../config/videoDelivery');

const RES_MAP = {
    '360p': { w: 640, h: 360, bandwidth: 800000 },
    '720p': { w: 1280, h: 720, bandwidth: 1600000 },
    '1080p': { w: 1920, h: 1080, bandwidth: 3500000 },
};

const VARIANT_DIR_NAMES = ['360p', '720p', '1080p', 'original'];

const makeEven = (n) => {
    const x = Math.max(2, Math.floor(Number(n) || 0));
    return x % 2 === 0 ? x : x - 1;
};

function buildTargetResolutions(task, origWidth, origHeight) {
    const safeW = makeEven(origWidth);
    const safeH = makeEven(origHeight);
    const requested = Array.isArray(task.resolutions) ? task.resolutions : [];
    const ladderEnabled = videoDelivery.hlsLadderEnabled && requested.length > 0;

    if (!ladderEnabled) {
        const shouldDownscaleTo720 = safeH > 720;
        if (!shouldDownscaleTo720) {
            return [{ w: safeW, h: safeH, name: 'original', bandwidth: 2000000 }];
        }
        const scale = Math.min(1, 720 / safeH, 1280 / safeW);
        return [{
            w: makeEven(safeW * scale),
            h: makeEven(safeH * scale),
            name: '720p',
            bandwidth: 1600000,
        }];
    }

    const order = ['360p', '720p', '1080p'];
    const targets = [];
    for (const label of order) {
        if (!requested.includes(label)) continue;
        const spec = RES_MAP[label];
        if (!spec || spec.h > safeH) continue;
        const scale = Math.min(1, spec.h / safeH, spec.w / safeW);
        targets.push({
            w: makeEven(safeW * scale),
            h: makeEven(safeH * scale),
            name: label,
            bandwidth: spec.bandwidth,
        });
    }

    if (targets.length === 0) {
        return [{ w: safeW, h: safeH, name: 'original', bandwidth: 2000000 }];
    }
    return targets;
}

async function tryDownloadStagingInput(video, workDir, logStep) {
    const candidateExts = ['.mp4', '.webm', '.mov', '.mkv', '.avi'];
    for (const ext of candidateExts) {
        const key = `${video.r2_key}/staging/input${ext}`;
        if (await r2Storage.objectExists(key)) {
            const local = path.join(workDir, `input${ext}`);
            logStep('R2', 'Downloading staging %s...', path.basename(key));
            await r2Storage.downloadToPath(key, local);
            return local;
        }
    }
    return null;
}

async function tryDownloadOriginalSource(video, workDir, logStep) {
    if (!video.original_r2_key) return null;
    const ext = path.extname(video.original_r2_key) || '.mp4';
    const local = path.join(workDir, `original_source${ext}`);
    logStep('R2', 'Downloading original source %s...', video.original_r2_key);
    await r2Storage.downloadToPath(video.original_r2_key, local);
    return local;
}

async function resolveSourcePath(video, workDir, logStep) {
    const isR2Staging = video.storage_path === 'r2_staging';
    let stagingDirToDelete = null;

    if (isR2Staging) {
        const local = await tryDownloadStagingInput(video, workDir, logStep);
        if (!local) throw new Error('Staging file not found in R2. Try re-uploading the video.');
        return { sourcePath: local, stagingDirToDelete, fromOriginal: false };
    }

    let localPath = video.storage_path;
    if (localPath && localPath !== 'r2_only' && fs.existsSync(localPath)) {
        let sourcePath = localPath;
        if (fs.statSync(localPath).isDirectory()) {
            const mp4 = path.join(localPath, 'input.mp4');
            const webm = path.join(localPath, 'input.webm');
            sourcePath = fs.existsSync(mp4) ? mp4 : fs.existsSync(webm) ? webm : mp4;
        }
        if (fs.existsSync(sourcePath)) {
            stagingDirToDelete = path.dirname(sourcePath);
            logStep('Source', 'Using local source: %s', sourcePath);
            return { sourcePath, stagingDirToDelete, fromOriginal: false };
        }
    }

    const stagingLocal = await tryDownloadStagingInput(video, workDir, logStep);
    if (stagingLocal) {
        return { sourcePath: stagingLocal, stagingDirToDelete: null, fromOriginal: false };
    }

    const originalLocal = await tryDownloadOriginalSource(video, workDir, logStep);
    if (originalLocal) {
        return { sourcePath: originalLocal, stagingDirToDelete: null, fromOriginal: true };
    }

    throw new Error('Source video file not found. Re-upload the video or ensure original_r2_key exists.');
}

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

class VideoProcessor {
    async processTask(task) {
        const log = (msg, ...args) => console.log(`[VideoProcessor] [Task ${task.id}] ${msg}`, ...args);
        const logStep = (step, msg, ...args) => console.log(`[VideoProcessor] [Task ${task.id}] [${step}] ${msg}`, ...args);

        log('Starting processing for video_id=%s', task.video_id);
        let workDir = null;

        // Mark task as started (so watchdog can detect stuck tasks by started_at age)
        try {
            await db.query(
                `UPDATE video_processing_tasks SET started_at = NOW(), updated_at = NOW() WHERE id = $1`,
                [task.id]
            );
        } catch (e) {
            // Non-fatal — continue processing
            console.warn('[VideoProcessor] Could not set started_at:', e.message);
        }

        // Fetch teacher info for error log context
        let teacherId = null;
        let teacherEmail = null;
        let videoTitle = null;

        try {
            logStep('DB', 'Fetching video record...');
            const videoRes = await db.query(
                `SELECT v.*, u.email as owner_email FROM videos v
                 LEFT JOIN users u ON v.owner_id = u.id
                 WHERE v.id = $1`,
                [task.video_id]
            );
            if (videoRes.rows.length === 0) throw new Error('Video not found');
            const video = videoRes.rows[0];
            teacherId = video.owner_id;
            teacherEmail = video.owner_email;
            videoTitle = video.title;
            const useR2 = video.storage_provider === 'r2' && video.r2_key && r2Storage.isConfigured;
            const isReencode = task.task_type === 'reencode';
            logStep('DB', 'Video found. storage_provider=%s, useR2=%s, task_type=%s', video.storage_provider, useR2, task.task_type || 'initial');

            let sourcePath;
            let outputDir;
            let stagingDirToDelete = null;
            let sourceFromOriginal = false;

            if (useR2) {
                logStep('WorkDir', 'Creating temp work directory...');
                workDir = path.join(os.tmpdir(), `video-${task.id}`);
                fs.mkdirSync(workDir, { recursive: true });
                outputDir = workDir;
                logStep('WorkDir', 'Work dir: %s', workDir);

                const resolved = await resolveSourcePath(video, workDir, logStep);
                sourcePath = resolved.sourcePath;
                stagingDirToDelete = resolved.stagingDirToDelete;
                sourceFromOriginal = resolved.fromOriginal;
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

            // 6. Build resolution ladder from task.resolutions
            const targetResolutions = buildTargetResolutions(task, origWidth, origHeight);
            for (const res of targetResolutions) {
                logStep('Encode', 'Target variant "%s": %sx%s (~%skbps)', res.name, res.w, res.h, Math.round(res.bandwidth / 1000));
            }

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
                    const segmentSeconds = videoDelivery.hlsSegmentSeconds;
                    const outputOpts = [
                        '-threads', String(ffmpegThreads),
                        '-map', '0:v:0',
                        '-map', '0:a:0?',
                        `-crf ${crf}`,
                        `-preset ${preset}`,
                        `-hls_time ${segmentSeconds}`,
                        '-hls_playlist_type vod',
                        `-hls_key_info_file ${keyInfoPath}`,
                        '-hls_segment_filename', path.join(resDir, 'segment_%03d.ts'),
                        // Keyframe alignment improves startup/seek behavior with short HLS segments.
                        '-sc_threshold 0',
                        '-force_key_frames', `expr:gte(t,n_forced*${segmentSeconds})`,
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

                const processingPrefix = `${video.r2_key}/.processing/${task.id}`;
                const variantNames = targetResolutions.map((r) => r.name);

                try {
                    logStep('R2', 'Uploading encrypted HLS to staging prefix: %s (parallel)', processingPrefix);
                    await r2Storage.uploadDirectory(outputDir, processingPrefix, {
                        onProgress: ({ uploaded, total, r2Key }) => {
                            if (uploaded === total || uploaded % 50 === 0) {
                                logStep('R2', 'Upload progress: %s/%s (%s)', uploaded, total, r2Key);
                            }
                        },
                    });

                    logStep('R2', 'Promoting staging output to live prefix: %s (parallel)', video.r2_key);
                    await r2Storage.promoteProcessingPrefix(processingPrefix, video.r2_key, variantNames);

                    logStep('R2', 'Verifying promoted HLS assets...');
                    const verified = await r2Storage.verifyHlsAtPrefix(video.r2_key, variantNames);
                    logStep('R2', 'HLS verified: master=%s, variant=%s', verified.masterKey, verified.variantPlaylistKey);
                } catch (storeErr) {
                    try {
                        await r2Storage.deletePrefix(processingPrefix);
                        logStep('R2', 'Cleaned up failed processing prefix: %s', processingPrefix);
                    } catch (cleanupErr) {
                        console.warn('[VideoProcessor] [Task %s] Failed to cleanup processing prefix:', task.id, cleanupErr.message);
                    }
                    throw storeErr;
                }

                const uploadThumbnail = async () => {
                    if (!sourcePath || !fs.existsSync(sourcePath) || !r2Storage.isConfigured || video.custom_thumbnail_r2_key) {
                        return;
                    }
                    try {
                        logStep('Thumbnail', 'Generating thumbnail from first frame...');
                        const thumbPath = path.join(outputDir, 'thumbnail.jpg');
                        await new Promise((resolve, reject) => {
                            ffmpeg(sourcePath)
                                .seekInput(1)
                                .frames(1)
                                .output(thumbPath)
                                .outputOptions(['-vf', 'scale=iw*min(1\\,1280/iw):-2', '-q:v', '3'])
                                .on('end', resolve)
                                .on('error', reject)
                                .run();
                        });
                        if (fs.existsSync(thumbPath)) {
                            const thumbR2Key = `${video.r2_key}/thumbnail.jpg`;
                            await r2Storage.uploadFromPath(thumbPath, thumbR2Key, 'image/jpeg');
                            await db.query('UPDATE videos SET thumbnail_r2_key = $1 WHERE id = $2', [thumbR2Key, task.video_id]);
                            logStep('Thumbnail', 'Thumbnail uploaded: %s', thumbR2Key);
                        }
                    } catch (thumbErr) {
                        console.warn('[VideoProcessor] [Task %s] Thumbnail generation failed (non-fatal):', task.id, thumbErr.message);
                    }
                };

                const uploadOriginal = async () => {
                    if (
                        !sourcePath ||
                        !fs.existsSync(sourcePath) ||
                        !r2Storage.isConfigured ||
                        sourceFromOriginal ||
                        isReencode
                    ) {
                        return;
                    }
                    try {
                        logStep('Original', 'Uploading original unencrypted video...');
                        const ext = path.extname(sourcePath) || '.mp4';
                        const originalR2Key = `${video.r2_key}/original/source${ext}`;
                        const contentType = ext.toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4';
                        await r2Storage.uploadFromPath(sourcePath, originalR2Key, contentType);
                        await db.query('UPDATE videos SET original_r2_key = $1 WHERE id = $2', [originalR2Key, task.video_id]);
                        logStep('Original', 'Original uploaded: %s', originalR2Key);
                    } catch (origErr) {
                        console.warn('[VideoProcessor] [Task %s] Original video upload failed (non-fatal):', task.id, origErr.message);
                    }
                };

                await Promise.all([uploadThumbnail(), uploadOriginal()]);

                if (workDir && fs.existsSync(workDir)) {
                    fs.rmSync(workDir, { recursive: true, force: true });
                    logStep('Cleanup', 'Removed work dir: %s', workDir);
                }
                if (stagingDirToDelete && fs.existsSync(stagingDirToDelete)) {
                    fs.rmSync(stagingDirToDelete, { recursive: true, force: true });
                    logStep('Cleanup', 'Removed staging dir: %s', stagingDirToDelete);
                }
                if (!isReencode) {
                    try {
                        await r2Storage.deletePrefix(`${video.r2_key}/staging`);
                        logStep('R2', 'Deleted R2 staging (initial upload).');
                    } catch (e) {
                        console.warn('[VideoProcessor] [Task %s] Failed to delete R2 staging:', task.id, e.message);
                    }
                    logStep('DB', 'Updating video storage_path to r2_only...');
                    await db.query('UPDATE videos SET storage_path = $1 WHERE id = $2', ['r2_only', task.video_id]);
                }
            }

            logStep('DB', 'Marking task completed...');
            await db.query(
                `UPDATE video_processing_tasks 
                 SET status = 'completed', processing_stage = NULL, updated_at = NOW() 
                 WHERE id = $1`,
                [task.id]
            );
            const durationSeconds = metadata.format?.duration != null ? Math.round(Number(metadata.format.duration) * 100) / 100 : null;
            const playbackResolutions = targetResolutions.map((r) => r.name);
            await db.query(
                `UPDATE videos SET size_bytes = $1, duration_seconds = COALESCE(duration_seconds, $2),
                 status = $3, playback_resolutions = $4 WHERE id = $5`,
                [totalSize, durationSeconds, 'active', playbackResolutions, task.video_id]
            );
            logStep('DB', 'Video updated: size=%s, duration=%s, status=active, playback=%s', totalSize, durationSeconds ?? 'N/A', playbackResolutions.join(','));

            log('Completed successfully. Duration=%ss', durationSeconds ?? 'N/A');

        } catch (error) {
            console.error(`[VideoProcessor] [Task ${task.id}] FAILED:`, error.message);

            // Always clean up temp workDir on failure to free disk space
            if (workDir) {
                try {
                    if (fs.existsSync(workDir)) {
                        fs.rmSync(workDir, { recursive: true, force: true });
                        log('Cleanup: removed workDir %s after failure', workDir);
                    }
                } catch (cleanupErr) {
                    console.warn('[VideoProcessor] Failed to cleanup workDir:', cleanupErr.message);
                }
            }

            // Log error to DB for admin monitoring
            await errorLogService.logWorkerError(error, {
                taskId: task.id,
                videoId: task.video_id,
                videoTitle: videoTitle || null,
                teacherId: teacherId || task.user_id,
                teacherEmail: teacherEmail || null,
                stage: 'video-processing',
            }).catch(() => {}); // never let logging break anything

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
