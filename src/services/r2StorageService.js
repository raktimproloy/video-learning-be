/**
 * Cloudflare R2 storage service.
 * Organized paths: teachers/{teacherId}/courses/{courseId}/lessons/{lessonId}/videos/{videoId}/
 * and for live recordings: teachers/{teacherId}/lessons/{lessonId}/recordings/
 */
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  CopyObjectCommand,
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const stream = require('stream');
const fs = require('fs');
const path = require('path');
const r2Config = require('../config/r2');
const { asyncPool, withRetry } = require('../utils/asyncPool');

let s3Client = null;

function getClient() {
  if (!r2Config.isConfigured) {
    throw new Error('R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY.');
  }
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: r2Config.endpoint,
      credentials: {
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: r2Config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return s3Client;
}

/**
 * R2 key prefix for a VOD video (uploaded + processed).
 * Example: teachers/uuid/courses/uuid/lessons/uuid/videos/uuid
 */
function getVideoKeyPrefix(teacherId, courseId, lessonId, videoId) {
  return `teachers/${teacherId}/courses/${courseId}/lessons/${lessonId}/videos/${videoId}`;
}

/**
 * R2 key prefix for a live recording (lesson VOD).
 * Example: teachers/uuid/lessons/uuid/recordings
 */
function getRecordingKeyPrefix(teacherId, lessonId) {
  return `teachers/${teacherId}/lessons/${lessonId}/recordings`;
}

/**
 * R2 key prefix for course media (thumbnails and intro videos).
 * Example: teachers/uuid/courses/uuid/thumbnail.jpg
 * Example: teachers/uuid/courses/uuid/intro-video.mp4
 */
function getCourseMediaKeyPrefix(teacherId, courseId, type = 'thumbnail') {
  return `teachers/${teacherId}/courses/${courseId}/${type}`;
}

/**
 * R2 key prefix for institute branding media (logo / cover).
 * Example: teachers/uuid/institutes/logo-123.jpg
 */
function getInstituteMediaKeyPrefix(teacherId) {
  return `teachers/${teacherId}/institutes`;
}

/**
 * Upload institute logo or cover image to R2.
 * @param {string} teacherId
 * @param {Buffer} fileBuffer
 * @param {string} originalFilename
 * @param {'logo'|'cover'} type
 * @returns {Promise<string>} R2 key
 */
async function uploadInstituteMedia(teacherId, fileBuffer, originalFilename, type = 'logo') {
  if (!r2Config.isConfigured) {
    throw new Error('R2 is not configured');
  }
  const timestamp = Date.now();
  const ext = require('path').extname(originalFilename) || '.jpg';
  const filename = `${type}-${timestamp}${ext}`;
  const key = `${getInstituteMediaKeyPrefix(teacherId)}/${filename}`;

  let contentType = 'image/jpeg';
  const extLower = ext.toLowerCase();
  if (extLower === '.png') contentType = 'image/png';
  else if (extLower === '.gif') contentType = 'image/gif';
  else if (extLower === '.webp') contentType = 'image/webp';
  else if (extLower === '.jpg' || extLower === '.jpeg') contentType = 'image/jpeg';

  await uploadFile(key, fileBuffer, contentType);
  return key;
}

/**
 * R2 key prefix for lesson notes and assignments.
 */
function getLessonMediaKeyPrefix(teacherId, courseId, lessonId, type) {
  return `teachers/${teacherId}/courses/${courseId}/lessons/${lessonId}/${type}`;
}

/**
 * R2 key prefix for video notes and assignments.
 */
function getVideoMediaKeyPrefix(teacherId, courseId, lessonId, videoId, type) {
  return `teachers/${teacherId}/courses/${courseId}/lessons/${lessonId}/videos/${videoId}/${type}`;
}

/**
 * Upload course thumbnail or intro video DIRECTLY to R2.
 * No transcoding, no resolution/bitrate processing, no encryption.
 * Files are stored as-is for fast upload and immediate playback.
 * @param {string} teacherId - Teacher user ID
 * @param {string} courseId - Course ID (can be null for new courses)
 * @param {Buffer|Stream} fileBuffer - File buffer or stream
 * @param {string} originalFilename - Original filename with extension
 * @param {string} type - 'thumbnail' or 'introVideo'
 * @returns {Promise<string>} R2 key path
 */
async function uploadCourseMedia(teacherId, courseId, fileBuffer, originalFilename, type = 'thumbnail') {
  if (!r2Config.isConfigured) {
    throw new Error('R2 is not configured');
  }
  
  const timestamp = Date.now();
  const ext = require('path').extname(originalFilename);
  const filename = `${type}-${timestamp}${ext}`;
  const key = getCourseMediaKeyPrefix(teacherId, courseId || 'temp', type) + '/' + filename;
  
  // Determine content type
  let contentType = 'application/octet-stream';
  if (type === 'thumbnail') {
    const extLower = ext.toLowerCase();
    if (extLower === '.jpg' || extLower === '.jpeg') contentType = 'image/jpeg';
    else if (extLower === '.png') contentType = 'image/png';
    else if (extLower === '.gif') contentType = 'image/gif';
    else if (extLower === '.webp') contentType = 'image/webp';
  } else if (type === 'introVideo') {
    const extLower = ext.toLowerCase();
    if (extLower === '.mp4') contentType = 'video/mp4';
    else if (extLower === '.mov') contentType = 'video/quicktime';
    else if (extLower === '.avi') contentType = 'video/x-msvideo';
    else if (extLower === '.webm') contentType = 'video/webm';
  }
  
  await uploadFile(key, fileBuffer, contentType);
  return key;
}

/**
 * Upload lesson note or assignment file to R2.
 */
async function uploadLessonMedia(teacherId, courseId, lessonId, fileBuffer, originalFilename, type = 'notes') {
  if (!r2Config.isConfigured) {
    throw new Error('R2 is not configured');
  }
  const timestamp = Date.now();
  const ext = require('path').extname(originalFilename);
  const filename = `${type}-${timestamp}${ext}`;
  const key = getLessonMediaKeyPrefix(teacherId, courseId, lessonId, type) + '/' + filename;
  let contentType = 'application/octet-stream';
  const extLower = ext.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].some((e) => extLower === e)) {
    contentType = extLower === '.png' ? 'image/png' : extLower === '.gif' ? 'image/gif' : extLower === '.webp' ? 'image/webp' : 'image/jpeg';
  } else if (['.pdf'].includes(extLower)) contentType = 'application/pdf';
  else if (['.txt'].includes(extLower)) contentType = 'text/plain';
  await uploadFile(key, fileBuffer, contentType);
  return key;
}

/**
 * Upload video note or assignment file to R2.
 */
async function uploadVideoMedia(teacherId, courseId, lessonId, videoId, fileBuffer, originalFilename, type = 'notes') {
  if (!r2Config.isConfigured) {
    throw new Error('R2 is not configured');
  }
  const timestamp = Date.now();
  const ext = require('path').extname(originalFilename);
  const filename = `${type}-${timestamp}${ext}`;
  const key = getVideoMediaKeyPrefix(teacherId, courseId, lessonId, videoId, type) + '/' + filename;
  let contentType = 'application/octet-stream';
  const extLower = ext.toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].some((e) => extLower === e)) {
    contentType = extLower === '.png' ? 'image/png' : extLower === '.gif' ? 'image/gif' : extLower === '.webp' ? 'image/webp' : 'image/jpeg';
  } else if (['.pdf'].includes(extLower)) contentType = 'application/pdf';
  else if (['.txt'].includes(extLower)) contentType = 'text/plain';
  await uploadFile(key, fileBuffer, contentType);
  return key;
}

/**
 * R2 key prefix for exam media (question/passage/option/solution images, uploaded templates).
 */
function getExamMediaKeyPrefix(teacherId, courseId, examId, type) {
  return `teachers/${teacherId}/courses/${courseId}/exams/${examId}/${type}`;
}

/**
 * R2 key prefix for course book master PDF and page images.
 * Example: teachers/{teacherId}/courses/{courseId}/books/{bookId}
 */
function getBookKeyPrefix(teacherId, courseId, bookId) {
  return `teachers/${teacherId}/courses/${courseId}/books/${bookId}`;
}

/**
 * Upload an exam image (question/passage/option/solution) to R2.
 */
async function uploadExamMedia(teacherId, courseId, examId, fileBuffer, originalFilename, type = 'images') {
  if (!r2Config.isConfigured) {
    throw new Error('R2 is not configured');
  }
  const timestamp = Date.now();
  const ext = require('path').extname(originalFilename) || '.jpg';
  const filename = `${type}-${timestamp}${ext}`;
  const key = getExamMediaKeyPrefix(teacherId, courseId, examId, type) + '/' + filename;
  const extLower = ext.toLowerCase();
  let contentType = 'image/jpeg';
  if (extLower === '.png') contentType = 'image/png';
  else if (extLower === '.gif') contentType = 'image/gif';
  else if (extLower === '.webp') contentType = 'image/webp';
  await uploadFile(key, fileBuffer, contentType);
  return key;
}

/**
 * Upload a file from buffer or path (stream).
 */
async function uploadFile(key, body, contentType = 'application/octet-stream') {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: r2Config.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
  return key;
}

/**
 * Upload from a readable stream (e.g. file stream).
 */
async function uploadStream(key, readStream, contentType = 'application/octet-stream') {
  const client = getClient();
  const upload = new Upload({
    client,
    params: {
      Bucket: r2Config.bucketName,
      Key: key,
      Body: readStream,
      ContentType: contentType,
    },
    queueSize: r2Config.uploadQueueSize,
    partSize: r2Config.uploadPartSizeMb * 1024 * 1024,
    leavePartsOnError: false,
  });
  await upload.done();
  return key;
}

function contentTypeForExt(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.m3u8') return 'application/vnd.apple.mpegurl';
  if (ext === '.ts') return 'video/mp2t';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  return 'application/octet-stream';
}

function collectLocalFiles(localDir, r2KeyPrefix) {
  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const localPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(localPath);
        continue;
      }
      const relativePath = path.relative(localDir, localPath).split(path.sep).join('/');
      const r2Key = r2KeyPrefix ? `${r2KeyPrefix}/${relativePath}` : relativePath;
      files.push({
        localPath,
        r2Key,
        contentType: contentTypeForExt(entry.name),
      });
    }
  }

  walk(localDir);
  return files;
}

/**
 * Upload a local directory tree to R2 with bounded parallel PUTs.
 */
async function uploadDirectory(localDir, r2KeyPrefix, options = {}) {
  if (!fs.existsSync(localDir)) {
    throw new Error(`Upload directory not found: ${localDir}`);
  }

  const files = collectLocalFiles(localDir, r2KeyPrefix);
  if (files.length === 0) {
    throw new Error(`Upload directory is empty: ${localDir}`);
  }

  const concurrency = options.concurrency ?? r2Config.uploadConcurrency;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  let uploaded = 0;

  await asyncPool(concurrency, files, async (file) => {
    await withRetry(() => uploadFromPath(file.localPath, file.r2Key, file.contentType));
    uploaded += 1;
    if (onProgress) {
      onProgress({ uploaded, total: files.length, r2Key: file.r2Key });
    }
  });

  return { fileCount: files.length };
}

/**
 * Upload from local file path (for worker: upload processed segments).
 */
async function uploadFromPath(localPath, key, contentType) {
  const fs = require('fs');
  const body = fs.createReadStream(localPath);
  return uploadStream(key, body, contentType || 'application/octet-stream');
}

/**
 * Download R2 object to a local file path.
 */
async function downloadToPath(key, localPath) {
  const fs = require('fs');
  const { pipeline } = require('stream/promises');
  const stream = await getObjectStream(key);
  const dir = require('path').dirname(localPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const writeStream = fs.createWriteStream(localPath);
  await pipeline(stream, writeStream);
  return localPath;
}

/**
 * Get object as stream (for proxying to client).
 */
async function getObjectStream(key) {
  const client = getClient();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: r2Config.bucketName,
      Key: key,
    })
  );
  return response.Body;
}

/**
 * Check if object exists.
 */
async function objectExists(key) {
  try {
    const client = getClient();
    await client.send(
      new HeadObjectCommand({
        Bucket: r2Config.bucketName,
        Key: key,
      })
    );
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/**
 * List objects under a prefix (for deletion).
 */
async function listObjects(prefix) {
  const client = getClient();
  const keys = [];
  let continuationToken;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: r2Config.bucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );
    if (response.Contents) {
      response.Contents.forEach((o) => keys.push(o.Key));
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

/**
 * Delete a single object.
 */
async function deleteObject(key) {
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: r2Config.bucketName,
      Key: key,
    })
  );
}

/**
 * Delete all objects under a prefix.
 */
async function deletePrefix(prefix) {
  const keys = await listObjects(prefix);
  if (keys.length === 0) return;
  const client = getClient();
  const concurrency = Math.max(1, Math.min(8, parseInt(process.env.R2_DELETE_CONCURRENCY || '4', 10)));
  for (let i = 0; i < keys.length; i += concurrency) {
    const batch = keys.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (key) => {
        try {
          await client.send(
            new DeleteObjectCommand({
              Bucket: r2Config.bucketName,
              Key: key,
            })
          );
        } catch (_) {
          /* best-effort cleanup */
        }
      })
    );
  }
}

/**
 * Copy an object within the same bucket (used for atomic HLS promote).
 */
async function copyObject(sourceKey, destKey) {
  const client = getClient();
  await client.send(
    new CopyObjectCommand({
      Bucket: r2Config.bucketName,
      CopySource: `${r2Config.bucketName}/${sourceKey}`,
      Key: destKey,
    })
  );
}

/**
 * Promote a processing prefix to live HLS paths (atomic swap).
 * Copies run in parallel; processing prefix is deleted only after all copies succeed.
 */
async function promoteProcessingPrefix(processingPrefix, livePrefix, variantDirNames) {
  const keys = await listObjects(processingPrefix);
  if (keys.length === 0) {
    throw new Error('Processing upload is empty — aborting promote');
  }

  const dirsToClear = new Set(['360p', '720p', '1080p', 'original', ...variantDirNames]);
  for (const dir of dirsToClear) {
    try {
      await deletePrefix(`${livePrefix}/${dir}`);
    } catch (e) {
      console.warn('[R2] promote: failed to clear old prefix', dir, e.message);
    }
  }

  try {
    await deleteObject(`${livePrefix}/master.m3u8`);
  } catch (_) {
    /* ignore */
  }

  const copyJobs = keys
    .map((key) => {
      const relative = key.slice(processingPrefix.length + 1);
      if (!relative) return null;
      return { sourceKey: key, destKey: `${livePrefix}/${relative}` };
    })
    .filter(Boolean);

  try {
    await asyncPool(r2Config.copyConcurrency, copyJobs, async ({ sourceKey, destKey }) => {
      await withRetry(() => copyObject(sourceKey, destKey));
    });
    await deletePrefix(processingPrefix);
  } catch (err) {
    throw new Error(`HLS promote failed: ${err.message}`);
  }
}

/**
 * Verify promoted HLS assets exist before marking video active.
 */
async function verifyHlsAtPrefix(livePrefix, variantDirNames = []) {
  const masterKey = `${livePrefix}/master.m3u8`;
  if (!(await objectExists(masterKey))) {
    throw new Error('HLS verification failed: master.m3u8 is missing after promote');
  }

  const dirsToCheck = variantDirNames.length > 0
    ? variantDirNames
    : ['360p', '720p', '1080p', 'original'];

  for (const dir of dirsToCheck) {
    const playlistKey = `${livePrefix}/${dir}/playlist.m3u8`;
    if (await objectExists(playlistKey)) {
      return { masterKey, variantPlaylistKey: playlistKey };
    }
  }

  throw new Error('HLS verification failed: no variant playlist found after promote');
}

/**
 * Get public URL for a key (when R2_PUBLIC_URL is configured with custom domain).
 * Returns null if not configured.
 */
function getPublicUrl(key) {
  if (!r2Config.publicBucketUrl || !key) return null;
  const base = r2Config.publicBucketUrl.replace(/\/$/, '');
  return `${base}/${key}`;
}

/**
 * Generate presigned GET URL (for time-limited access without auth).
 */
async function getPresignedGetUrl(key, expiresIn = 3600) {
  const client = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: r2Config.bucketName,
      Key: key,
    }),
    { expiresIn }
  );
}

/**
 * Start multipart upload and return uploadId.
 */
async function createMultipartUpload(key, contentType = 'application/octet-stream') {
  const client = getClient();
  const res = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: r2Config.bucketName,
      Key: key,
      ContentType: contentType,
    })
  );
  return res.UploadId;
}

/**
 * Presigned URL for uploading one part.
 */
async function getPresignedUploadPartUrl(key, uploadId, partNumber, expiresIn = 3600) {
  const client = getClient();
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: r2Config.bucketName,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn }
  );
}

/**
 * Complete multipart upload with ETags from client.
 */
async function completeMultipartUpload(key, uploadId, parts) {
  const client = getClient();
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: r2Config.bucketName,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .filter((p) => p && p.ETag && p.PartNumber)
          .map((p) => ({ ETag: p.ETag, PartNumber: p.PartNumber })),
      },
    })
  );
  return key;
}

/**
 * Abort multipart upload on failure/cancel.
 */
async function abortMultipartUpload(key, uploadId) {
  const client = getClient();
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: r2Config.bucketName,
      Key: key,
      UploadId: uploadId,
    })
  );
}

module.exports = {
  getClient,
  getVideoKeyPrefix,
  getRecordingKeyPrefix,
  getCourseMediaKeyPrefix,
  getInstituteMediaKeyPrefix,
  getLessonMediaKeyPrefix,
  getVideoMediaKeyPrefix,
  getExamMediaKeyPrefix,
  getBookKeyPrefix,
  uploadLessonMedia,
  uploadVideoMedia,
  uploadExamMedia,
  uploadFile,
  uploadStream,
  uploadFromPath,
  uploadDirectory,
  downloadToPath,
  uploadCourseMedia,
  uploadInstituteMedia,
  getObjectStream,
  objectExists,
  listObjects,
  deleteObject,
  deletePrefix,
  copyObject,
  promoteProcessingPrefix,
  verifyHlsAtPrefix,
  getPublicUrl,
  getPresignedGetUrl,
  createMultipartUpload,
  getPresignedUploadPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  isConfigured: r2Config.isConfigured,
  bucketName: r2Config.bucketName,
};
