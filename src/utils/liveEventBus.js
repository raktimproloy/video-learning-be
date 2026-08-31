/**
 * Redis pub/sub bridge: worker publishes live events, API emits Socket.io.
 */
let publisher = null;
let subscriber = null;

async function getPublisher() {
  if (!process.env.REDIS_URL) return null;
  if (publisher) return publisher;
  try {
    const { createClient } = require('redis');
    publisher = createClient({ url: process.env.REDIS_URL });
    publisher.on('error', (err) => console.error('[LiveEventBus] pub error:', err.message));
    await publisher.connect();
    return publisher;
  } catch (err) {
    console.warn('[LiveEventBus] publisher unavailable:', err.message);
    return null;
  }
}

async function publishLiveEvent(payload) {
  const pub = await getPublisher();
  if (!pub) return;
  try {
    await pub.publish('live_events', JSON.stringify(payload));
  } catch (err) {
    console.warn('[LiveEventBus] publish failed:', err.message);
  }
}

async function subscribeLiveEvents(onEvent) {
  if (!process.env.REDIS_URL) return;
  try {
    const { createClient } = require('redis');
    subscriber = createClient({ url: process.env.REDIS_URL });
    subscriber.on('error', (err) => console.error('[LiveEventBus] sub error:', err.message));
    await subscriber.connect();
    await subscriber.subscribe('live_events', (message) => {
      try {
        const payload = JSON.parse(message);
        onEvent(payload);
      } catch (_) {}
    });
    console.log('[LiveEventBus] Subscribed to live_events');
  } catch (err) {
    console.warn('[LiveEventBus] subscribe failed:', err.message);
  }
}

module.exports = { publishLiveEvent, subscribeLiveEvents };
