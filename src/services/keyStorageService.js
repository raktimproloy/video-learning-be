/**
 * Key Storage Service
 * Stores and retrieves video encryption keys.
 * Uses R2 when configured; falls back to local filesystem otherwise.
 * R2 path: keys/<videoId>/enc.key
 */
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const r2Storage = require('./r2StorageService');

const KEYS_ROOT_DIR = process.env.KEYS_ROOT_DIR || path.join(__dirname, '../../keys');
const R2_KEYS_PREFIX = 'keys';

/**
 * Get R2 key path for a video's encryption key.
 */
function getR2KeyPath(videoId) {
    return `${R2_KEYS_PREFIX}/${videoId}/enc.key`;
}

/**
 * Save encryption key for a video.
 * When R2 is configured: uploads to R2.
 * Otherwise: writes to local filesystem.
 * @param {string} videoId - Video UUID
 * @param {Buffer} keyBuffer - 16-byte encryption key
 */
async function saveKey(videoId, keyBuffer) {
    if (r2Storage.isConfigured) {
        await r2Storage.uploadFile(getR2KeyPath(videoId), keyBuffer, 'application/octet-stream');
    } else {
        const keyDir = path.join(KEYS_ROOT_DIR, videoId);
        if (!fs.existsSync(keyDir)) {
            fs.mkdirSync(keyDir, { recursive: true });
        }
        const keyPath = path.join(keyDir, 'enc.key');
        fs.writeFileSync(keyPath, keyBuffer);
    }
}

/**
 * Get encryption key for a video.
 * @param {string} videoId - Video UUID
 * @returns {Promise<Buffer>}
 */
async function getKey(videoId) {
    if (r2Storage.isConfigured) {
        try {
            const stream = await r2Storage.getObjectStream(getR2KeyPath(videoId));
            const chunks = [];
            return new Promise((resolve, reject) => {
                stream.on('data', (chunk) => chunks.push(chunk));
                stream.on('end', () => resolve(Buffer.concat(chunks)));
                stream.on('error', reject);
            });
        } catch (err) {
            const code = err.name || err.Code;
            const status = err.$metadata?.httpStatusCode;
            if (code === 'NoSuchKey' || status === 404) {
                throw new Error('Key file not found');
            }
            throw err;
        }
    }
    const keyPath = path.join(KEYS_ROOT_DIR, videoId, 'enc.key');
    if (!fs.existsSync(keyPath)) {
        throw new Error('Key file not found');
    }
    return fs.readFileSync(keyPath);
}

/**
 * Get a local file path for the encryption key (for FFmpeg key_info).
 * When R2: downloads to targetDir and returns path.
 * Otherwise: returns existing local path.
 * @param {string} videoId - Video UUID
 * @param {string} targetDir - Directory to download to (for R2); used for cleanup
 * @returns {Promise<string>} Absolute path to enc.key
 */
async function getKeyLocalPath(videoId, targetDir) {
    const keyPath = path.join(targetDir, 'enc.key');
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    if (r2Storage.isConfigured) {
        const r2KeyPath = getR2KeyPath(videoId);
        const existsInR2 = await r2Storage.objectExists(r2KeyPath);

        if (existsInR2) {
            // Happy path: key already in R2 — download it
            const stream = await r2Storage.getObjectStream(r2KeyPath);
            const writeStream = fs.createWriteStream(keyPath);
            await pipeline(stream, writeStream);
            return path.resolve(keyPath);
        }

        // Key not in R2 — check local filesystem (video may have been created before R2 was configured)
        const localKeyPath = path.join(KEYS_ROOT_DIR, videoId, 'enc.key');
        if (fs.existsSync(localKeyPath)) {
            console.log(`[KeyStorage] Key for ${videoId} not in R2; found locally. Migrating to R2...`);
            const keyBuffer = fs.readFileSync(localKeyPath);
            // Migrate to R2 so future fetches succeed
            await r2Storage.uploadFile(r2KeyPath, keyBuffer, 'application/octet-stream');
            fs.writeFileSync(keyPath, keyBuffer);
            return path.resolve(keyPath);
        }

        // Key exists nowhere — generate a fresh one (re-encryption of existing video)
        console.warn(`[KeyStorage] No encryption key found for video ${videoId}. Generating a new one...`);
        const crypto = require('crypto');
        const newKey = crypto.randomBytes(16);
        await r2Storage.uploadFile(r2KeyPath, newKey, 'application/octet-stream');
        fs.writeFileSync(keyPath, newKey);
        return path.resolve(keyPath);
    }

    // Local-only mode
    const localKeyPath = path.join(KEYS_ROOT_DIR, videoId, 'enc.key');
    if (fs.existsSync(localKeyPath)) {
        // Copy to work dir so FFmpeg can access it
        fs.copyFileSync(localKeyPath, keyPath);
        return path.resolve(keyPath);
    }

    // Generate fresh key for local mode
    console.warn(`[KeyStorage] No local encryption key found for video ${videoId}. Generating a new one...`);
    const crypto = require('crypto');
    const newKey = crypto.randomBytes(16);
    const keyDir = path.join(KEYS_ROOT_DIR, videoId);
    if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(localKeyPath, newKey);
    fs.writeFileSync(keyPath, newKey);
    return path.resolve(keyPath);
}


/**
 * Check if a key exists.
 * @param {string} videoId - Video UUID
 * @returns {Promise<boolean>}
 */
async function keyExists(videoId) {
    if (r2Storage.isConfigured) {
        return r2Storage.objectExists(getR2KeyPath(videoId));
    }
    const keyPath = path.join(KEYS_ROOT_DIR, videoId, 'enc.key');
    return fs.existsSync(keyPath);
}

/**
 * Delete encryption key for a video.
 * @param {string} videoId - Video UUID
 */
async function deleteKey(videoId) {
    if (r2Storage.isConfigured) {
        try {
            await r2Storage.deleteObject(getR2KeyPath(videoId));
        } catch (err) {
            if (err.name !== 'NoSuchKey' && err.$metadata?.httpStatusCode !== 404) {
                throw err;
            }
        }
    } else {
        const keyDir = path.join(KEYS_ROOT_DIR, videoId);
        if (fs.existsSync(keyDir)) {
            fs.rmSync(keyDir, { recursive: true, force: true });
        }
    }
}

module.exports = {
    saveKey,
    getKey,
    getKeyLocalPath,
    keyExists,
    deleteKey,
};
