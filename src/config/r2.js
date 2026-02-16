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

module.exports = {
  accountId,
  accessKeyId,
  secretAccessKey,
  bucketName,
  endpoint,
  publicBucketUrl,
  isConfigured,
};
