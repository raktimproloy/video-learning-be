/**
 * Compress image buffer without changing resolution.
 * Uses sharp for JPEG/PNG/WebP - reduces file size by optimizing quality.
 */
const sharp = require('sharp');

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

function isImage(filename) {
  const ext = require('path').extname(filename || '').toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

async function compressImage(buffer, originalFilename) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return buffer;
  if (!isImage(originalFilename)) return buffer;

  try {
    const ext = require('path').extname(originalFilename || '').toLowerCase();
    let pipeline = sharp(buffer);

    const metadata = await pipeline.metadata();
    if (!metadata.width || !metadata.height) return buffer;

    const format = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : ext === '.gif' ? 'gif' : 'jpeg';
    let out = sharp(buffer);
    if (format === 'jpeg') out = out.jpeg({ quality: 85, mozjpeg: true });
    else if (format === 'png') out = out.png({ compressionLevel: 8 });
    else if (format === 'webp') out = out.webp({ quality: 85 });
    else if (format === 'gif') out = out.gif();
    else out = out.jpeg({ quality: 85 });

    const compressed = await out.toBuffer();

    return compressed.length < buffer.length ? compressed : buffer;
  } catch (err) {
    console.error('Image compression failed:', err);
    return buffer;
  }
}

module.exports = { isImage, compressImage };
