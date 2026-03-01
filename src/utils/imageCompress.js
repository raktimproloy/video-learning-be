/**
 * Compress image buffer. Optionally resize and use stronger compression for notes/assignments (R2).
 * Uses sharp for JPEG/PNG/WebP - reduces file size by optimizing quality.
 */
const sharp = require('sharp');
const path = require('path');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const MAX_DIMENSION_NOTE_ASSIGNMENT = 1920; // max width/height for note/assignment images (smaller stored size)
const QUALITY_DEFAULT = 85;
const QUALITY_AGGRESSIVE = 78; // stronger compression for note/assignment uploads to R2

function isImage(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * @param {Buffer} buffer - image buffer
 * @param {string} originalFilename - original file name (for format)
 * @param {boolean} [aggressive=false] - if true, resize large images and use lower quality (for notes/assignments R2)
 */
async function compressImage(buffer, originalFilename, aggressive = false) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return buffer;
  if (!isImage(originalFilename)) return buffer;

  try {
    const ext = path.extname(originalFilename || '').toLowerCase();
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) return buffer;

    const quality = aggressive ? QUALITY_AGGRESSIVE : QUALITY_DEFAULT;
    let out = sharp(buffer);

    if (aggressive && (metadata.width > MAX_DIMENSION_NOTE_ASSIGNMENT || metadata.height > MAX_DIMENSION_NOTE_ASSIGNMENT)) {
      out = out.resize(MAX_DIMENSION_NOTE_ASSIGNMENT, MAX_DIMENSION_NOTE_ASSIGNMENT, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const format = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : ext === '.gif' ? 'gif' : 'jpeg';
    if (format === 'jpeg') out = out.jpeg({ quality, mozjpeg: true });
    else if (format === 'png') out = out.png({ compressionLevel: aggressive ? 9 : 8 });
    else if (format === 'webp') out = out.webp({ quality });
    else if (format === 'gif') out = out.gif();
    else out = out.jpeg({ quality, mozjpeg: true });

    const compressed = await out.toBuffer();

    return compressed.length < buffer.length ? compressed : buffer;
  } catch (err) {
    console.error('Image compression failed:', err);
    return buffer;
  }
}

module.exports = { isImage, compressImage };
