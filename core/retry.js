'use strict';
const logger = require('./logger');
const config = require('../config');

async function withRetry(fn, source, opts = {}) {
  const maxRetries  = opts.maxRetries  ?? config.retry.maxRetries;
  const baseDelayMs = opts.baseDelayMs ?? config.retry.baseDelayMs;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      logger.warn(source, 'retry_attempt', { attempt: attempt + 1, maxRetries, delayMs, error: err.message });
      await sleep(delayMs);
    }
  }

  logger.error(source, 'retry_exhausted', { error: lastError.message });
  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { withRetry, sleep };
