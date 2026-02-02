const ffmpeg = require('fluent-ffmpeg');
const db = require('./db');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const TEACHER_EMAIL = 'teacher@gmail.com'; // Adjust if needed, or query one
const PUBLIC_VIDEOS_DIR = path.join(__dirname, 'public/videos');
const KEYS_ROOT_DIR = process.env.KEYS_ROOT_DIR || path.join(__dirname, 'keys');

async function createTestVideo() {
    try {
        // 1. Get Teacher ID
        const userRes = await db.query("SELECT id FROM users WHERE role = 'teacher' LIMIT 1");
        if (userRes.rows.length === 0) {
            console.error("No teacher found. Please create one first.");
            process.exit(1);
        }
        const teacherId = userRes.rows[0].id;

        // 2. Generate Video with Audio
        const videoId = crypto.randomUUID();
        const videoDir = path.join(PUBLIC_VIDEOS_DIR, videoId);
        const keyDir = path.join(KEYS_ROOT_DIR, videoId);

        if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });
        if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });

        const videoPath = path.join(videoDir, 'input.mp4');
        const keyPath = path.join(keyDir, 'enc.key');

        // Create random key
        fs.writeFileSync(keyPath, require('crypto').randomBytes(16));

        console.log("Generating video with audio...");
        
        const { exec } = require('child_process');
        await new Promise((resolve, reject) => {
            exec(`ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i sine=frequency=1000:duration=5 -c:v libx264 -c:a aac -t 5 -pix_fmt yuv420p -y "${videoPath}"`, (error, stdout, stderr) => {
                if (error) {
                    console.error(`exec error: ${error}`);
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        console.log("Video generated at:", videoPath);

        // 3. Insert into DB
        const lessonRes = await db.query("SELECT id FROM lessons LIMIT 1");
        const lessonId = lessonRes.rows.length > 0 ? lessonRes.rows[0].id : null;

        await db.query(
            `INSERT INTO videos (id, title, storage_path, signing_secret, owner_id, lesson_id) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [videoId, 'Test Video With Audio', videoPath, 'secret', teacherId, lessonId]
        );

        // 4. Create Processing Task
        await db.query(
            `INSERT INTO video_processing_tasks (video_id, user_id, codec_preference, resolutions, status)
             VALUES ($1, $2, 'h264', ARRAY['720p'], 'pending')`,
            [videoId, teacherId]
        );

        console.log("Task created for video:", videoId);

    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}

createTestVideo();
