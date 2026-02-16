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
} = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const stream = require('stream');
const r2Config = require('../config/r2');

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
 * R2 key prefix for lesson notes and assignments.
 */
function getLessonMediaKeyPrefix(teacherId, courseId, lessonId, type) {
  return `teachers/${teacherId}/courses/${courseId}/lessons/${lessonId}/${type}`;
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
  });
  await upload.done();
  return key;
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
  const client = getClient();
  for (const key of keys) {
    await client.send(
      new DeleteObjectCommand({
        Bucket: r2Config.bucketName,
        Key: key,
      })
    );
  }
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

module.exports = {
  getClient,
  getVideoKeyPrefix,
  getRecordingKeyPrefix,
  getCourseMediaKeyPrefix,
  getLessonMediaKeyPrefix,
  uploadLessonMedia,
  uploadFile,
  uploadStream,
  uploadFromPath,
  uploadCourseMedia,
  getObjectStream,
  objectExists,
  listObjects,
  deleteObject,
  deletePrefix,
  getPublicUrl,
  getPresignedGetUrl,
  isConfigured: r2Config.isConfigured,
  bucketName: r2Config.bucketName,
};
