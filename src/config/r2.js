/**
 * Cloudflare R2 configuration.
 * Uses S3-compatible API; credentials from env.
 */
require('dotenv').config();

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucketName = process.env.R2_BUCKET_NAME || 'encrypted-videos';
const publicBucketUrl = process.env.R2_PUBLIC_URL; // Optional: custom domain for public bucket

const endpoint = accountId
  ? `https://${accountId}.r2.cloudflarestorage.com`
  : null;

const isConfigured = !!(accountId && accessKeyId && secretAccessKey);

function parsePositiveInt(value, fallback, { min = 1, max = 64 } = {}) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Parallel PUT uploads during video HLS storing (worker only). */
const uploadConcurrency = parsePositiveInt(process.env.R2_UPLOAD_CONCURRENCY, 12, { min: 1, max: 32 });

/** Parallel server-side CopyObject during HLS promote (worker only). */
const copyConcurrency = parsePositiveInt(process.env.R2_COPY_CONCURRENCY, 12, { min: 1, max: 32 });

/** @aws-sdk/lib-storage multipart queue size for large files (original source, etc.). */
const uploadQueueSize = parsePositiveInt(process.env.R2_UPLOAD_QUEUE_SIZE, 4, { min: 1, max: 16 });

/** Multipart part size in MB for stream uploads. */
const uploadPartSizeMb = parsePositiveInt(process.env.R2_UPLOAD_PART_SIZE_MB, 10, { min: 5, max: 64 });

module.exports = {
  accountId,
  accessKeyId,
  secretAccessKey,
  bucketName,
  endpoint,
  publicBucketUrl,
  isConfigured,
  uploadConcurrency,
  copyConcurrency,
  uploadQueueSize,
  uploadPartSizeMb,
};
