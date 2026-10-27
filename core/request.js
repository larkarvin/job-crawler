'use strict';
const axios           = require('axios');
const { withRetry }   = require('./retry');
const { throttle }    = require('./rateLimiter');
const logger          = require('./logger');

async function get(url, opts = {}) {
  const source = opts.source || 'http';
  const domain = new URL(url).hostname;

  return withRetry(async () => {
    await throttle(domain);
    logger.debug(source, 'http_request', { url });

    const response = await axios.get(url, {
      timeout: 30_000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RemoteJobsCrawler/1.0)',
        'Accept': 'application/json, text/xml, */*',
        ...opts.headers,
      },
      responseType: opts.responseType || 'json',
    });

    logger.info(source, 'http_response', { url, status: response.status });
    return response.data;
  }, source);
}

module.exports = { get };
