# Crawler System — Self-Contained Implementation Plan

> Hand this file to an AI assistant and say: "Implement this exactly."
> No other context is needed. Everything required to build the system is in this document.

---

## Project Context

- **Working directory:** `/var/www/crawler` (empty, git initialized)
- **Runtime:** Node.js 18+
- **Purpose:** Crawl four remote job sources, store raw unmodified records in MySQL or JSONL
- **Adjacent system:** Laravel API at `/var/www/api.remotejobs` using MySQL
  - Host: `127.0.0.1`, Port: `3306`, User: `root`, Password: *(empty)*, DB: `api.remotejobs`
  - The crawler writes to a NEW table `raw_jobs` in the same database
- **No LLM, no API, no frontend, no normalization — crawling and raw storage only**

---

## Final Folder Structure

Create every file listed below. Do not add extra files.

```
/var/www/crawler/
├── config/
│   └── index.js
├── sources/
│   ├── remotive.js
│   ├── remoteok.js
│   ├── weworkremotely.js
│   └── onlinejobsph.js
├── core/
│   ├── browser.js
│   ├── request.js
│   ├── logger.js
│   ├── retry.js
│   ├── rateLimiter.js
│   ├── pagination.js
│   └── hash.js
├── storage/
│   ├── mysqlStorage.js
│   ├── fileStorage.js
│   └── storageFactory.js
├── output/               ← created at runtime (add to .gitignore)
├── .env.example
├── .gitignore
├── setup.sql
├── package.json
└── index.js
```

---

## package.json

```json
{
  "name": "crawler",
  "version": "1.0.0",
  "description": "Remote job board crawler — raw ingestion only",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "crawl": "node index.js"
  },
  "dependencies": {
    "playwright": "^1.44.0",
    "mysql2": "^3.9.7",
    "axios": "^1.7.2",
    "dotenv": "^16.4.5",
    "fast-xml-parser": "^4.4.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## .gitignore

```
node_modules/
output/
.env
```

---

## .env.example

```dotenv
# Storage backend: "mysql" or "file"
STORAGE_TYPE=mysql

# MySQL — matches adjacent Laravel API database
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=api.remotejobs

# File storage output path (used when STORAGE_TYPE=file)
FILE_OUTPUT_PATH=./output/raw_jobs.jsonl

# Rate limiting between requests (milliseconds)
RATE_LIMIT_MIN_MS=1000
RATE_LIMIT_MAX_MS=3000

# Retry configuration
MAX_RETRIES=3
RETRY_BASE_DELAY_MS=1000

# Crawl behavior
CONCURRENCY=1       # 1 = sequential; >1 = parallel sources
MAX_PAGES=10        # safety cap for paginated sources

# OnlineJobs.ph login credentials (required for that source)
ONLINEJOBS_EMAIL=
ONLINEJOBS_PASSWORD=
ONLINEJOBS_AUTH_STATE=./output/onlinejobs_auth.json

# Playwright browser mode
PLAYWRIGHT_HEADLESS=true

# Log level: debug | info | warn | error
LOG_LEVEL=info
```

---

## setup.sql

```sql
-- Run once: mysql -h 127.0.0.1 -u root api.remotejobs < setup.sql

CREATE TABLE IF NOT EXISTS raw_jobs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source      VARCHAR(100)  NOT NULL,
  external_id VARCHAR(255)  NULL,
  title       VARCHAR(500)  NOT NULL,
  company     VARCHAR(255)  NOT NULL,
  location    VARCHAR(255)  NOT NULL,
  url         TEXT          NOT NULL,
  description LONGTEXT,
  tags        JSON,
  scraped_at  DATETIME      NOT NULL,
  hash        VARCHAR(40)   NOT NULL,
  created_at  TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY  unique_hash    (hash),
  INDEX       idx_source     (source),
  INDEX       idx_scraped_at (scraped_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

---

## Raw Job Contract

Every source adapter MUST return objects with EXACTLY these fields.
No extra fields. No missing fields. Use `null` if data is unavailable.
The `hash` field is added by `index.js` — source adapters do NOT set it.

```js
{
  source:      'string',        // e.g. "remotive"
  external_id: 'string|null',   // source's own job ID; null if unavailable
  title:       'string',
  company:     'string',
  location:    'string',
  url:         'string',
  description: 'string',        // raw HTML or plain text; '' if unavailable
  tags:        [],              // array of strings; [] if none
  scraped_at:  'ISO string',    // new Date().toISOString()
}
```

---

## Source Adapter Interface (ALL sources must implement this)

```js
module.exports = {
  name: 'source_name',
  async fetchList() { return []; },       // returns Job[]
  async fetchDetail(job) { return job; }, // returns Job | null
};
```

Rules:
- Each source file is fully isolated — no imports from other source files
- All shared logic lives in `/core` only
- `fetchDetail()` returns the job as-is if no detail fetch is needed

---

## File-by-File Implementation

### `config/index.js`

```js
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
```

---

### `core/logger.js`

Structured JSON logger. No external dependencies. Info/debug → stdout. Error → stderr.

```js
'use strict';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, source, event, extra = {}) {
  if (LEVELS[level] < CURRENT) return;
  const line = JSON.stringify({
    level, source, event,
    timestamp: new Date().toISOString(),
    ...extra,
  });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  debug: (s, e, x) => log('debug', s, e, x),
  info:  (s, e, x) => log('info',  s, e, x),
  warn:  (s, e, x) => log('warn',  s, e, x),
  error: (s, e, x) => log('error', s, e, x),
};
```

---

### `core/retry.js`

Exponential backoff. Delays: 1s → 2s → 4s (doubles each attempt).

```js
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
```

---

### `core/rateLimiter.js`

Per-hostname throttle with random jitter between minMs and maxMs.

```js
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
```

---

### `core/hash.js`

SHA-1 dedup hash using Node.js built-in `crypto`.

```js
'use strict';
const crypto = require('crypto');

function computeHash(source, externalId, url) {
  const key = externalId
    ? `${source}::id::${externalId}`
    : `${source}::url::${url}`;
  return crypto.createHash('sha1').update(key).digest('hex');
}

module.exports = { computeHash };
```

---

### `core/request.js`

axios GET with retry and per-hostname rate limiting wired in.

```js
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
```

---

### `core/pagination.js`

Two pagination strategies: page-number-based and cursor-based.

```js
'use strict';
const logger = require('./logger');

async function paginateByPage({ fetchPage, source, startPage = 1, maxPages = 10 }) {
  const allItems  = [];
  const seenKeys  = new Set();

  for (let page = startPage; page < startPage + maxPages; page++) {
    logger.info(source, 'fetch_page', { page });

    let items;
    try {
      items = await fetchPage(page);
    } catch (err) {
      logger.error(source, 'fetch_page_error', { page, error: err.message });
      break;
    }

    if (!items || items.length === 0) {
      logger.info(source, 'pagination_done', { reason: 'empty_page', page });
      break;
    }

    // Detect wrap-around (server loops back to page 1)
    const pageKey = JSON.stringify(items.map(j => j.external_id || j.url).sort());
    if (seenKeys.has(pageKey)) {
      logger.info(source, 'pagination_done', { reason: 'repeated_page', page });
      break;
    }
    seenKeys.add(pageKey);

    allItems.push(...items);
    logger.info(source, 'fetch_page_success', { page, count: items.length });
  }

  return allItems;
}

async function paginateByCursor({ fetchPage, source, maxPages = 10 }) {
  const allItems = [];
  let cursor     = null;
  let pageCount  = 0;

  do {
    logger.info(source, 'fetch_cursor_page', { cursor, pageCount });

    let result;
    try {
      result = await fetchPage(cursor);
    } catch (err) {
      logger.error(source, 'fetch_cursor_error', { cursor, error: err.message });
      break;
    }

    const { items, nextCursor } = result;
    if (!items || items.length === 0) break;

    allItems.push(...items);
    cursor = nextCursor;
    pageCount++;
  } while (cursor && pageCount < maxPages);

  return allItems;
}

module.exports = { paginateByPage, paginateByCursor };
```

---

### `core/browser.js`

Playwright singleton. `--no-sandbox` required for root/Docker environments.

```js
'use strict';
const { chromium } = require('playwright');
const fs           = require('fs');
const path         = require('path');
const config       = require('../config');
const logger       = require('./logger');

let _browser = null;

async function getBrowser() {
  if (_browser) return _browser;
  logger.info('browser', 'launch', { headless: config.playwright.headless });
  _browser = await chromium.launch({
    headless: config.playwright.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    logger.info('browser', 'closed');
  }
}

async function newContext(authStatePath = null) {
  const browser     = await getBrowser();
  const contextOpts = {
    userAgent:  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale:     'en-US',
    timezoneId: 'America/New_York',
  };
  if (authStatePath && fs.existsSync(authStatePath)) {
    contextOpts.storageState = authStatePath;
    logger.info('browser', 'load_auth_state', { path: authStatePath });
  }
  return browser.newContext(contextOpts);
}

async function saveContextState(context, authStatePath) {
  const dir = path.dirname(authStatePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await context.storageState({ path: authStatePath });
  logger.info('browser', 'save_auth_state', { path: authStatePath });
}

module.exports = { getBrowser, closeBrowser, newContext, saveContextState };
```

---

### `storage/mysqlStorage.js`

```js
'use strict';
const mysql  = require('mysql2/promise');
const logger = require('../core/logger');

class MySQLStorage {
  constructor(config) {
    this._config = config;
    this._pool   = null;
  }

  async init() {
    this._pool = mysql.createPool(this._config);
    const conn = await this._pool.getConnection();
    conn.release();
    logger.info('storage', 'mysql_connected', { database: this._config.database });
  }

  async exists(hash) {
    const [rows] = await this._pool.execute(
      'SELECT id FROM raw_jobs WHERE hash = ? LIMIT 1', [hash]
    );
    return rows.length > 0;
  }

  async save(job) {
    const sql = `
      INSERT IGNORE INTO raw_jobs
        (source, external_id, title, company, location, url, description, tags, scraped_at, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await this._pool.execute(sql, [
      job.source,
      job.external_id   || null,
      job.title,
      job.company,
      job.location,
      job.url,
      job.description   || null,
      JSON.stringify(job.tags || []),
      job.scraped_at.replace('T', ' ').replace('Z', ''),
      job.hash,
    ]);
    return result.affectedRows > 0;
  }

  async close() {
    if (this._pool) {
      await this._pool.end();
      logger.info('storage', 'mysql_disconnected');
    }
  }
}

module.exports = MySQLStorage;
```

---

### `storage/fileStorage.js`

JSONL append-only. Loads existing hashes on init for cross-run dedup.

```js
'use strict';
const fs     = require('fs');
const path   = require('path');
const logger = require('../core/logger');

class FileStorage {
  constructor(filePath) {
    this._filePath = filePath;
    this._seen     = new Set();
  }

  async init() {
    const dir = path.dirname(this._filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(this._filePath)) {
      const lines = fs.readFileSync(this._filePath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { const obj = JSON.parse(line); if (obj.hash) this._seen.add(obj.hash); }
        catch (_) {}
      }
      logger.info('storage', 'file_loaded', { path: this._filePath, existingCount: this._seen.size });
    }
  }

  async exists(hash) { return this._seen.has(hash); }

  async save(job) {
    if (this._seen.has(job.hash)) return false;
    this._seen.add(job.hash);
    fs.appendFileSync(this._filePath, JSON.stringify(job) + '\n', 'utf8');
    return true;
  }

  async close() {
    logger.info('storage', 'file_closed', { path: this._filePath });
  }
}

module.exports = FileStorage;
```

---

### `storage/storageFactory.js`

```js
'use strict';
const config       = require('../config');
const MySQLStorage = require('./mysqlStorage');
const FileStorage  = require('./fileStorage');

async function createStorage() {
  const type = config.storage.type;
  let storage;
  if (type === 'mysql')      storage = new MySQLStorage(config.storage.mysql);
  else if (type === 'file')  storage = new FileStorage(config.storage.filePath);
  else throw new Error(`Unknown STORAGE_TYPE: "${type}". Must be "mysql" or "file".`);
  await storage.init();
  return storage;
}

module.exports = { createStorage };
```

---

### `sources/remotive.js`

- Endpoint: `https://remotive.com/api/remote-jobs?category={slug}`
- 6 category slugs iterated sequentially
- No pagination — single flat response per category
- `external_id` = String(job.id)
- Description is full HTML already present in list response → `fetchDetail` is a passthrough

```js
'use strict';
const request = require('../core/request');
const logger  = require('../core/logger');

const SOURCE     = 'remotive';
const BASE_URL   = 'https://remotive.com/api/remote-jobs';
const CATEGORIES = ['software-dev', 'devops', 'product', 'design', 'data', 'qa'];

module.exports = {
  name: SOURCE,

  async fetchList() {
    const allJobs = [];

    for (const category of CATEGORIES) {
      const url = `${BASE_URL}?category=${category}`;
      logger.info(SOURCE, 'fetch_category', { url, category });

      let data;
      try {
        data = await request.get(url, { source: SOURCE });
      } catch (err) {
        logger.error(SOURCE, 'fetch_category_error', { category, error: err.message });
        continue;
      }

      const jobs = (data.jobs || []).map(j => ({
        source:      SOURCE,
        external_id: String(j.id),
        title:       j.title             || '',
        company:     j.company_name      || '',
        location:    j.candidate_required_location || 'Worldwide',
        url:         j.url,
        description: j.description       || '',
        tags:        Array.isArray(j.tags) ? j.tags : [],
        scraped_at:  new Date().toISOString(),
      }));

      logger.info(SOURCE, 'fetch_category_success', { category, count: jobs.length });
      allJobs.push(...jobs);
    }

    return allJobs;
  },

  async fetchDetail(job) { return job; },
};
```

---

### `sources/remoteok.js`

- Endpoint: `https://remoteok.com/api`
- Single GET returns JSON array; index 0 is metadata — skip with `.slice(1)`
- `external_id` = String(job.id)
- Description is full HTML in feed → `fetchDetail` is a passthrough

```js
'use strict';
const request = require('../core/request');
const logger  = require('../core/logger');

const SOURCE   = 'remoteok';
const FEED_URL = 'https://remoteok.com/api';

module.exports = {
  name: SOURCE,

  async fetchList() {
    logger.info(SOURCE, 'fetch_feed', { url: FEED_URL });

    let raw;
    try {
      raw = await request.get(FEED_URL, {
        source:  SOURCE,
        headers: { 'Accept': 'application/json' },
      });
    } catch (err) {
      logger.error(SOURCE, 'fetch_feed_error', { error: err.message });
      return [];
    }

    const jobs = Array.isArray(raw)
      ? raw.slice(1).filter(item => item && item.id).map(j => ({
          source:      SOURCE,
          external_id: String(j.id),
          title:       j.position    || '',
          company:     j.company     || '',
          location:    j.location    || 'Worldwide',
          url:         j.url         || `https://remoteok.com/remote-jobs/${j.slug}`,
          description: j.description || '',
          tags:        Array.isArray(j.tags) ? j.tags : [],
          scraped_at:  new Date().toISOString(),
        }))
      : [];

    logger.info(SOURCE, 'fetch_feed_success', { count: jobs.length });
    return jobs;
  },

  async fetchDetail(job) { return job; },
};
```

---

### `sources/weworkremotely.js`

**IMPORTANT:** WeWorkRemotely blocks HTML scraping (HTTP 403). Use RSS feeds instead.
RSS provides full HTML descriptions and is their publicly supported access method.
Playwright is NOT used for this source.

- 6 RSS feed URLs (one per category)
- Parse XML with `fast-xml-parser`
- Title format: `"CompanyName: Job Title"` — split on first colon
- `external_id` = last path segment of `<guid>`
- Location from `<wwr:region>` + `<wwr:country>` custom elements
- `fetchDetail` is a passthrough (full description in RSS)

```js
'use strict';
const request      = require('../core/request');
const logger       = require('../core/logger');
const { XMLParser } = require('fast-xml-parser');

const SOURCE = 'weworkremotely';
const RSS_FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
  'https://weworkremotely.com/categories/remote-design-jobs.rss',
  'https://weworkremotely.com/categories/remote-product-jobs.rss',
  'https://weworkremotely.com/categories/remote-finance-legal-jobs.rss',
  'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
];

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

module.exports = {
  name: SOURCE,

  async fetchList() {
    const allJobs = [];

    for (const feedUrl of RSS_FEEDS) {
      logger.info(SOURCE, 'fetch_feed', { url: feedUrl });

      let xml;
      try {
        xml = await request.get(feedUrl, {
          source:       SOURCE,
          responseType: 'text',
          headers:      { 'Accept': 'application/rss+xml, application/xml, text/xml' },
        });
      } catch (err) {
        logger.error(SOURCE, 'fetch_feed_error', { url: feedUrl, error: err.message });
        continue;
      }

      let parsed;
      try {
        parsed = xmlParser.parse(xml);
      } catch (err) {
        logger.error(SOURCE, 'parse_xml_error', { url: feedUrl, error: err.message });
        continue;
      }

      const items = parsed?.rss?.channel?.item;
      if (!items) continue;

      const itemArray = Array.isArray(items) ? items : [items];
      const jobs = itemArray.map(item => {
        if (!item || !item.link) return null;

        const rawTitle  = item.title || '';
        const colonIdx  = rawTitle.indexOf(':');
        const company   = colonIdx > -1 ? rawTitle.substring(0, colonIdx).trim() : '';
        const title     = colonIdx > -1 ? rawTitle.substring(colonIdx + 1).trim() : rawTitle.trim();

        const guid      = item.guid || item.link;
        const externalId = guid ? String(guid).split('/').filter(Boolean).pop() : null;

        const region    = item['wwr:region']  || item.region  || '';
        const country   = item['wwr:country'] || item.country || '';
        const location  = [region, country].filter(Boolean).join(', ') || 'Worldwide';

        return {
          source:      SOURCE,
          external_id: externalId,
          title,
          company,
          location,
          url:         item.link,
          description: item.description || '',
          tags:        [],
          scraped_at:  new Date().toISOString(),
        };
      }).filter(Boolean);

      logger.info(SOURCE, 'fetch_feed_success', { url: feedUrl, count: jobs.length });
      allJobs.push(...jobs);
    }

    return allJobs;
  },

  async fetchDetail(job) { return job; },
};
```

---

### `sources/onlinejobsph.js`

**IMPORTANT:** This source requires Playwright and valid credentials in `.env`.
If `ONLINEJOBS_EMAIL` or `ONLINEJOBS_PASSWORD` are empty, the source logs a warning and
returns an empty array — the rest of the crawl continues normally.

**Session strategy:**
- First run: login → `saveContextState()` persists cookies to `./output/onlinejobs_auth.json`
- Subsequent runs: `newContext(authStatePath)` loads saved cookies → no login needed
- If session expires (redirected to login page): re-authenticates and re-saves

**DOM selectors below are best-guesses based on common Bootstrap-era PHP job board patterns.
If `fetchList()` returns 0 jobs, inspect the live DOM with `PLAYWRIGHT_HEADLESS=false` and
update the `SELECTORS` object accordingly.**

```js
'use strict';
const { newContext, saveContextState } = require('../core/browser');
const { throttle }    = require('../core/rateLimiter');
const logger          = require('../core/logger');
const config          = require('../config');
const fs              = require('fs');

const SOURCE   = 'onlinejobsph';
const BASE_URL = 'https://www.onlinejobs.ph';

const SELECTORS = {
  loginEmail:     '#email',
  loginPassword:  '#password',
  loginSubmit:    'button[type="submit"]',
  loginSuccess:   '.navbar-nav',
  jobCard:        '.jobpost-brief',
  jobTitle:       '.job-title',
  jobCompany:     '.employer-name',
  jobLocation:    '.job-location',
  jobLink:        'a[href*="/jobseekers/job/"]',
  noJobsMarker:   '.no-results',
  detailDesc:     '#job-description',
  detailTags:     '.tag, .skill-tag',
};

module.exports = {
  name: SOURCE,

  async fetchList() {
    const cfg = config.playwright.onlinejobs;

    if (!cfg.email || !cfg.password) {
      logger.warn(SOURCE, 'skip_no_credentials', {
        message: 'ONLINEJOBS_EMAIL/ONLINEJOBS_PASSWORD not set — skipping source',
      });
      return [];
    }

    const context = await newContext(cfg.authState);
    const page    = await context.newPage();
    const allJobs = [];

    try {
      await ensureLoggedIn(page, cfg, context);

      for (let pageNum = 1; pageNum <= config.crawl.maxPages; pageNum++) {
        const url = `${BASE_URL}/jobseekers/joblist/${pageNum}`;
        logger.info(SOURCE, 'fetch_page', { url, page: pageNum });

        await throttle('onlinejobs.ph');
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

        const isEmpty = await page.$(SELECTORS.noJobsMarker);
        if (isEmpty) {
          logger.info(SOURCE, 'pagination_done', { reason: 'no_results_marker', page: pageNum });
          break;
        }

        const cards = await page.$$(SELECTORS.jobCard);
        if (cards.length === 0) {
          logger.info(SOURCE, 'pagination_done', { reason: 'empty_page', page: pageNum });
          break;
        }

        logger.info(SOURCE, 'fetch_page_success', { page: pageNum, cards: cards.length });

        for (const card of cards) {
          const job = await extractCard(card);
          if (job) allJobs.push(job);
        }
      }
    } catch (err) {
      logger.error(SOURCE, 'fetch_list_error', { error: err.message });
    } finally {
      await page.close();
      await context.close();
    }

    return allJobs;
  },

  async fetchDetail(job) {
    if (job.description) return job;

    const cfg     = config.playwright.onlinejobs;
    const context = await newContext(cfg.authState);
    const page    = await context.newPage();

    try {
      await throttle('onlinejobs.ph');
      await page.goto(job.url, { waitUntil: 'networkidle', timeout: 30_000 });

      const description = await page.$eval(SELECTORS.detailDesc, el => el.innerHTML).catch(() => '');
      const tags        = await page.$$eval(SELECTORS.detailTags, els => els.map(el => el.textContent.trim()).filter(Boolean)).catch(() => []);

      logger.info(SOURCE, 'fetch_detail_success', { url: job.url });
      return { ...job, description, tags };
    } catch (err) {
      logger.error(SOURCE, 'fetch_detail_error', { url: job.url, error: err.message });
      return job;
    } finally {
      await page.close();
      await context.close();
    }
  },
};

async function ensureLoggedIn(page, cfg, context) {
  await page.goto(`${BASE_URL}/jobseekers/joblist/1`, { waitUntil: 'networkidle', timeout: 30_000 });

  const needsLogin = page.url().includes('/login') || !!(await page.$(SELECTORS.loginEmail));
  if (!needsLogin) return;

  logger.info(SOURCE, 'login_start');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.fill(SELECTORS.loginEmail,    cfg.email);
  await page.fill(SELECTORS.loginPassword, cfg.password);
  await page.click(SELECTORS.loginSubmit);
  await page.waitForSelector(SELECTORS.loginSuccess, { timeout: 15_000 });
  await saveContextState(context, cfg.authState);
  logger.info(SOURCE, 'login_success');
}

async function extractCard(card) {
  try {
    const title    = await card.$eval(SELECTORS.jobTitle,    el => el.textContent.trim()).catch(() => '');
    const company  = await card.$eval(SELECTORS.jobCompany,  el => el.textContent.trim()).catch(() => '');
    const location = await card.$eval(SELECTORS.jobLocation, el => el.textContent.trim()).catch(() => 'Philippines');
    const linkEl   = await card.$(SELECTORS.jobLink);
    const href     = linkEl ? await linkEl.getAttribute('href') : null;
    if (!href) return null;

    const url        = href.startsWith('http') ? href : `${BASE_URL}${href}`;
    const externalId = url.split('/').pop()?.split('-').pop() || null;

    return {
      source: SOURCE, external_id: externalId,
      title, company, location, url,
      description: '', tags: [],
      scraped_at: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn(SOURCE, 'extract_card_error', { error: err.message });
    return null;
  }
}
```

---

### `index.js`

```js
'use strict';
require('dotenv').config();

const config             = require('./config');
const logger             = require('./core/logger');
const { computeHash }    = require('./core/hash');
const { closeBrowser }   = require('./core/browser');
const { createStorage }  = require('./storage/storageFactory');

const remotive       = require('./sources/remotive');
const remoteok       = require('./sources/remoteok');
const weworkremotely = require('./sources/weworkremotely');
const onlinejobsph   = require('./sources/onlinejobsph');

const ALL_SOURCES = [remotive, remoteok, weworkremotely, onlinejobsph];

async function runSource(source, storage) {
  const stats = { source: source.name, fetched: 0, stored: 0, skipped: 0, errors: 0 };
  logger.info(source.name, 'source_start');

  let jobs = [];
  try {
    jobs = await source.fetchList();
    stats.fetched = jobs.length;
    logger.info(source.name, 'fetch_list_complete', { count: jobs.length });
  } catch (err) {
    stats.errors++;
    logger.error(source.name, 'fetch_list_failed', { error: err.message });
    return stats;
  }

  for (const job of jobs) {
    try {
      job.hash = computeHash(source.name, job.external_id, job.url);

      if (await storage.exists(job.hash)) {
        stats.skipped++;
        logger.debug(source.name, 'skip_duplicate', { hash: job.hash });
        continue;
      }

      let finalJob = job;
      if (!job.description) {
        try {
          finalJob      = await source.fetchDetail(job);
          finalJob.hash = job.hash;
        } catch (err) {
          stats.errors++;
          logger.error(source.name, 'fetch_detail_error', { url: job.url, error: err.message });
          finalJob = job;
        }
      }

      const stored = await storage.save(finalJob);
      if (stored) {
        stats.stored++;
        logger.debug(source.name, 'job_stored', { hash: finalJob.hash });
      } else {
        stats.skipped++;
      }
    } catch (err) {
      stats.errors++;
      logger.error(source.name, 'process_job_error', { error: err.message });
    }
  }

  logger.info(source.name, 'source_complete', stats);
  return stats;
}

async function main() {
  logger.info('orchestrator', 'crawl_start', {
    sources:     ALL_SOURCES.map(s => s.name),
    storageType: config.storage.type,
    concurrency: config.crawl.concurrency,
  });

  let storage;
  try {
    storage = await createStorage();
  } catch (err) {
    logger.error('orchestrator', 'storage_init_failed', { error: err.message });
    process.exit(1);
  }

  const allStats = [];

  if (config.crawl.concurrency === 1) {
    for (const source of ALL_SOURCES) {
      allStats.push(await runSource(source, storage));
    }
  } else {
    const results = await Promise.allSettled(
      ALL_SOURCES.map(source => runSource(source, storage))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') allStats.push(r.value);
    }
  }

  const summary = {
    totalFetched: allStats.reduce((a, s) => a + s.fetched,  0),
    totalStored:  allStats.reduce((a, s) => a + s.stored,   0),
    totalSkipped: allStats.reduce((a, s) => a + s.skipped,  0),
    totalErrors:  allStats.reduce((a, s) => a + s.errors,   0),
    bySource:     allStats,
  };

  logger.info('orchestrator', 'crawl_complete', summary);

  await storage.close();
  await closeBrowser();

  process.exit(summary.totalErrors > 0 ? 1 : 0);
}

main().catch(err => {
  logger.error('orchestrator', 'unhandled_error', { error: err.message, stack: err.stack });
  process.exit(1);
});
```

---

## Implementation Order

Write files in this exact order (dependencies must exist before dependents):

1. `package.json`
2. `.gitignore`
3. `.env.example`
4. `setup.sql`
5. `config/index.js`
6. `core/logger.js`
7. `core/retry.js`
8. `core/rateLimiter.js`
9. `core/hash.js`
10. `core/request.js`
11. `core/pagination.js`
12. `core/browser.js`
13. `storage/mysqlStorage.js`
14. `storage/fileStorage.js`
15. `storage/storageFactory.js`
16. `sources/remotive.js`
17. `sources/remoteok.js`
18. `sources/weworkremotely.js`
19. `sources/onlinejobsph.js`
20. `index.js`

---

## Verification Steps

After all files are written:

```bash
# Install dependencies
cd /var/www/crawler && npm install

# Install Playwright Chromium binary
npx playwright install chromium

# Create MySQL table
mysql -h 127.0.0.1 -u root api.remotejobs < setup.sql

# Copy and configure environment
cp .env.example .env
# Set ONLINEJOBS_EMAIL and ONLINEJOBS_PASSWORD in .env

# Smoke test with file storage (no MySQL needed)
STORAGE_TYPE=file node index.js

# Full run with MySQL
STORAGE_TYPE=mysql node index.js

# Verify file output
wc -l output/raw_jobs.jsonl

# Verify MySQL output
mysql -h 127.0.0.1 -u root api.remotejobs \
  -e "SELECT source, COUNT(*) AS count FROM raw_jobs GROUP BY source;"
```

---

## Critical Rules (Do Not Violate)

- NO normalization, enrichment, or transformation of job data
- NO LLM calls, external APIs, or frontend code
- Source files MUST NOT import from other source files
- All shared logic MUST live in `/core`
- Every stored record MUST have all contract fields (null is OK, missing is not)
- Storage writes MUST be idempotent (running the crawler twice must not create duplicates)
- A failure in one source MUST NOT crash or abort the other sources
