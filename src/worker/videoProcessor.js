const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const db = require('../../db');

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

class VideoProcessor {
    async processTask(task) {
        console.log(`Starting task ${task.id} for video ${task.video_id}`);
        
        try {
            // 1. Fetch video details
            const videoRes = await db.query('SELECT * FROM videos WHERE id = $1', [task.video_id]);
            if (videoRes.rows.length === 0) {
                throw new Error('Video not found');
            }
            const video = videoRes.rows[0];
            let sourcePath = video.storage_path;

            if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory()) {
                sourcePath = path.join(sourcePath, 'input.mp4');
            }

            if (!fs.existsSync(sourcePath)) {
                throw new Error(`Source file not found at ${sourcePath}`);
            }

            // 2. Prepare Output Directory
            // We'll create a folder for the video, and subfolders for each resolution if needed
            // If sourcePath was a directory, outputDir is effectively that directory.
            // If sourcePath was a file, outputDir is the directory containing it.
            // But wait, if sourcePath is .../uuid/input.mp4, path.dirname is .../uuid.
            // If sourcePath is .../uuid, outputDir logic below needs care.
            
            const outputDir = path.dirname(sourcePath);
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
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

            // 4. Determine Compression Settings
            // Default to H.264 for web compatibility unless strictly overridden
            // Although H.265 is better for size, many browsers (Chrome/Firefox) do not support it in MSE without flags/hardware.
            // Safe bet: H.264
            let codec = 'libx264'; 
            // If the user *really* wants h265 and we know the risks:
            if (task.codec_preference === 'h265_forced') { 
                codec = 'libx265';
            }
            
            // Default CRFs: H.264 -> 23, H.265 -> 28
            let crf = task.crf;
            if (!crf) {
                crf = codec === 'libx265' ? 28 : 23;
            }
            
            const preset = 'slow'; 
            
            // 5. Determine Resolutions
            // Parse resolutions or default to source-like
            let resolutions = task.resolutions || ['720p'];
            // Normalize resolutions to [{w, h, name}]
            const resolutionMap = {
                '1080p': { w: 1920, h: 1080, name: '1080p', bandwidth: 5000000 },
                '720p': { w: 1280, h: 720, name: '720p', bandwidth: 2800000 },
                '480p': { w: 854, h: 480, name: '480p', bandwidth: 1400000 },
                '360p': { w: 640, h: 360, name: '360p', bandwidth: 800000 }
            };

            const targetResolutions = [];
            for (const res of resolutions) {
                if (resolutionMap[res]) {
                    targetResolutions.push(resolutionMap[res]);
                }
            }
            if (targetResolutions.length === 0) {
                targetResolutions.push(resolutionMap['720p']);
            }

            // 6. Process each resolution
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
                    let command = ffmpeg(sourcePath)
                        .videoCodec(codec)
                        .audioCodec('aac')
                        .size(`${res.w}x${res.h}`)
                        .outputOptions([
                            `-crf ${crf}`,
                            `-preset ${preset}`,
                            '-hls_time 6',
                            '-hls_playlist_type vod',
                            `-hls_key_info_file ${keyInfoPath}`,
                            '-hls_segment_filename', path.join(resDir, 'segment_%03d.ts')
                        ]);
                    
                    // Add specific params for x265 if needed
                    if (codec === 'libx265') {
                        command.outputOptions('-tag:v hvc1'); // Help Apple devices recognize HEVC
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

                variants.push({
                    bandwidth: res.bandwidth,
                    resolution: `${res.w}x${res.h}`,
                    path: `${res.name}/${playlistName}`, // Relative path for master playlist
                    codecs: codec === 'libx265' ? 'hvc1.1.4.L93.B0' : 'avc1.4d401f' // Rough estimate for High/Main profile
                });
            }

            // 7. Create Master Playlist
            const masterPlaylistPath = path.join(outputDir, 'master.m3u8');
            let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n';
            
            for (const variant of variants) {
                masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution},CODECS="${variant.codecs}"\n`;
                masterContent += `${variant.path}\n`;
            }

            fs.writeFileSync(masterPlaylistPath, masterContent);
            console.log('Master playlist created at:', masterPlaylistPath);

            // 8. Update DB (completed)
            const totalSize = getDirSize(outputDir);
            await db.query(
                `UPDATE video_processing_tasks 
                 SET status = 'completed', updated_at = NOW() 
                 WHERE id = $1`,
                [task.id]
            );

            // Update video size and master playlist path (if we were storing the playlist path, currently we store source path)
            // But we might want to update storage_path to point to the master playlist folder or file?
            // The original code kept storage_path as the source file usually, but for streaming we usually serve the master.m3u8.
            // Let's assume the frontend knows how to find it or we update a field.
            // The user asked "then everyting do what created in backend after teacher upload a video".
            
            // Let's update the video size at least.
            await db.query('UPDATE videos SET size_bytes = $1 WHERE id = $2', [totalSize, task.video_id]);

            console.log(`Task ${task.id} completed successfully.`);

        } catch (error) {
            console.error(`Task ${task.id} failed:`, error);
            await db.query(
                `UPDATE video_processing_tasks 
                 SET status = 'failed', error_message = $1, updated_at = NOW() 
                 WHERE id = $2`,
                [error.message, task.id]
            );
        }
    }
}

module.exports = new VideoProcessor();
