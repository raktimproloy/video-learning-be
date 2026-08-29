/**
 * Video HLS delivery feature flags (default: legacy API-proxy behavior).
 */
require('dotenv').config();

const mode = (process.env.CDN_SEGMENT_DELIVERY || 'off').toLowerCase();

module.exports = {
  /** off | presign | cdn */
  cdnSegmentDelivery: ['off', 'presign', 'cdn'].includes(mode) ? mode : 'off',
  r2CdnPublicUrl: (process.env.R2_CDN_PUBLIC_URL || process.env.R2_PUBLIC_URL || '').replace(/\/$/, ''),
  hlsSegmentPresignTtl: Math.max(30, parseInt(process.env.HLS_SEGMENT_PRESIGN_TTL || '120', 10)),
  hlsLadderEnabled: process.env.HLS_LADDER_ENABLED !== 'false',
  hlsSegmentSeconds: Math.max(2, parseInt(process.env.HLS_SEGMENT_SECONDS || '2', 10)),
};
