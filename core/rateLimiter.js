'use strict';
const config       = require('../config');
const { sleep }    = require('./retry');

const lastRequestAt = new Map();

async function throttle(domain) {
  const { minMs, maxMs } = config.rateLimiting;
  const jitter   = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  const last      = lastRequestAt.get(domain) || 0;
  const elapsed   = Date.now() - last;
  const remaining = jitter - elapsed;
  if (remaining > 0) await sleep(remaining);
  lastRequestAt.set(domain, Date.now());
}

module.exports = { throttle };
