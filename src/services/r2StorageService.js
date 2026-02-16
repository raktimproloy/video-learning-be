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
 * Generate presigned GET URL (optional; we use proxy for auth instead).
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
  uploadFile,
  uploadStream,
  uploadFromPath,
  getObjectStream,
  objectExists,
  listObjects,
  deleteObject,
  deletePrefix,
  getPresignedGetUrl,
  isConfigured: r2Config.isConfigured,
  bucketName: r2Config.bucketName,
};
