/**
 * Quick sanity check for live CDN playlist rewrite.
 */
process.env.R2_CDN_PUBLIC_URL = process.env.R2_CDN_PUBLIC_URL || 'https://media.test.com';
process.env.LIVE_CDN_DELIVERY = 'cdn';

const svc = require('../src/services/liveCdnDeliveryService');

async function main() {
  const content = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-MAP:URI="init.mp4"',
    '#EXTINF:1.000,',
    'seg1.m4s',
    '',
  ].join('\n');

  const out = await svc.rewriteLivePlaylistToCdn(
    content,
    'live/sessions/abc',
    '720p/playlist.m3u8',
    'http://api.test/v1/lessons/x/live/playlist',
    'tok'
  );

  if (!out.includes('media.test.com')) {
    throw new Error(`CDN URL missing in output:\n${out}`);
  }
  console.log('✓ CDN rewrite OK');
}

main().catch((e) => {
  console.error('✗', e.message);
  process.exit(1);
});
