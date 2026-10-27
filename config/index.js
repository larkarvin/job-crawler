'use strict';
require('dotenv').config();

module.exports = {
  storage: {
    type:     process.env.STORAGE_TYPE    || 'mysql',
    mysql: {
      host:             process.env.DB_HOST     || '127.0.0.1',
      port:             parseInt(process.env.DB_PORT || '3306', 10),
      user:             process.env.DB_USER     || 'root',
      password:         process.env.DB_PASSWORD || '',
      database:         process.env.DB_NAME     || 'api.remotejobs',
      waitForConnections: true,
      connectionLimit:  5,
    },
    filePath: process.env.FILE_OUTPUT_PATH || './output/raw_jobs.jsonl',
  },
  rateLimiting: {
    minMs: parseInt(process.env.RATE_LIMIT_MIN_MS || '1000', 10),
    maxMs: parseInt(process.env.RATE_LIMIT_MAX_MS || '3000', 10),
  },
  retry: {
    maxRetries:  parseInt(process.env.MAX_RETRIES          || '3',    10),
    baseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS  || '1000', 10),
  },
  crawl: {
    concurrency: parseInt(process.env.CONCURRENCY || '1',  10),
    maxPages:    parseInt(process.env.MAX_PAGES   || '10', 10),
  },
  playwright: {
    headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    onlinejobs: {
      email:     process.env.ONLINEJOBS_EMAIL     || '',
      password:  process.env.ONLINEJOBS_PASSWORD  || '',
      authState: process.env.ONLINEJOBS_AUTH_STATE || './output/onlinejobs_auth.json',
    },
  },
};
