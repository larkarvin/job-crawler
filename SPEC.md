# Crawler System — Technical Specification

**Version:** 1.0  
**Date:** 2026-04-12  
**Stack:** Node.js 18+ · Playwright · mysql2 · axios  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Directory Structure](#2-directory-structure)
3. [Raw Job Contract](#3-raw-job-contract)
4. [Configuration](#4-configuration)
5. [Core Utilities](#5-core-utilities)
   - 5.1 Logger
   - 5.2 Retry
   - 5.3 Rate Limiter
   - 5.4 Pagination
   - 5.5 Hash
   - 5.6 HTTP Request
   - 5.7 Browser
6. [Source Adapters](#6-source-adapters)
   - 6.1 Remotive
   - 6.2 RemoteOK
   - 6.3 We Work Remotely
   - 6.4 OnlineJobs.ph
7. [Storage Layer](#7-storage-layer)
   - 7.1 MySQL Storage
   - 7.2 File Storage
   - 7.3 Storage Factory
8. [MySQL Schema](#8-mysql-schema)
9. [Deduplication Strategy](#9-deduplication-strategy)
10. [Entry Point Orchestration](#10-entry-point-orchestration)
11. [Environment Variables](#11-environment-variables)
12. [Installation & Run](#12-installation--run)
13. [Logging Reference](#13-logging-reference)
14. [Constraints & Non-Goals](#14-constraints--non-goals)

---

## 1. Overview

A standalone Node.js service that crawls four remote job sources, collects raw job listings, and
stores them without modification into either a MySQL table or a local JSONL file.

**Data flow:**

```
[Remotive API]         → HTTP GET (axios)
[RemoteOK JSON feed]   → HTTP GET (axios)
[We Work Remotely RSS] → HTTP GET (axios) + XML parse
[OnlineJobs.ph]        → Playwright (headless Chromium)
        ↓
  core/hash.js         → sha1 dedup check
        ↓
  storage layer        → MySQL INSERT IGNORE  OR  JSONL append
```

No enrichment, normalization, or LLM processing occurs at any stage.

---

## 2. Directory Structure

```
/var/www/crawler/
├── config/
│   └── index.js              ← central config, reads from .env
├── sources/
│   ├── remotive.js           ← Remotive REST API adapter
│   ├── remoteok.js           ← RemoteOK JSON feed adapter
│   ├── weworkremotely.js     ← WeWorkRemotely RSS adapter
│   └── onlinejobsph.js       ← OnlineJobs.ph Playwright adapter
├── core/
│   ├── browser.js            ← Playwright singleton + storageState helpers
│   ├── request.js            ← axios GET with retry + rate-limit wired in
│   ├── logger.js             ← structured JSON logger (stdout/stderr)
│   ├── retry.js              ← withRetry(fn, source) exponential backoff
│   ├── rateLimiter.js        ← per-hostname delay + random jitter
│   ├── pagination.js         ← paginateByPage() + paginateByCursor()
│   └── hash.js               ← computeHash(source, externalId, url)
├── storage/
│   ├── mysqlStorage.js       ← mysql2/promise backend
│   ├── fileStorage.js        ← JSONL append-only backend
│   └── storageFactory.js     ← createStorage() factory
├── output/                   ← runtime output dir (gitignored)
├── .env                      ← local secrets (gitignored)
├── .env.example
├── setup.sql                 ← MySQL DDL
├── package.json
└── index.js                  ← orchestrator entry point
```

---

## 3. Raw Job Contract

Every source adapter MUST return objects that exactly match this shape. No extra fields. No
missing fields (use `null` when data is unavailable).

```json
{
  "source":      "string",        // source identifier: "remotive" | "remoteok" | etc.
  "external_id": "string | null", // source's own ID for the job; null if unavailable
  "title":       "string",        // job title
  "company":     "string",        // company name
  "location":    "string",        // location string as-is from source
  "url":         "string",        // canonical job URL
  "description": "string",        // raw HTML or plain text; empty string if unavailable
  "tags":        [],              // array of strings; empty array if none
  "scraped_at":  "ISO string"     // new Date().toISOString() at extraction time
}
```

The `hash` field is added by the orchestrator (`index.js`) — source adapters do NOT compute it.

---

## 4. Configuration

**File:** `config/index.js`

Reads all values from `process.env` (loaded by `dotenv` in `index.js`). Exports a single frozen
config object used across the entire codebase.

```js
module.exports = {
  storage: {
    type:     process.env.STORAGE_TYPE || 'mysql',    // "mysql" | "file"
    mysql:    { host, port, user, password, database, connectionLimit: 5 },
    filePath: process.env.FILE_OUTPUT_PATH || './output/raw_jobs.jsonl',
  },
  rateLimiting: {
    minMs: 1000,   // minimum delay between requests to the same hostname
    maxMs: 3000,   // maximum delay (random jitter fills between min and max)
  },
  retry: {
    maxRetries:  3,
    baseDelayMs: 1000,  // delay doubles each attempt: 1s → 2s → 4s
  },
  crawl: {
    concurrency: 1,    // 1 = sequential; >1 = parallel source execution
    maxPages:    10,   // safety cap on paginated sources
  },
  playwright: {
    headless: true,
    onlinejobs: {
      email:     process.env.ONLINEJOBS_EMAIL,
      password:  process.env.ONLINEJOBS_PASSWORD,
      authState: process.env.ONLINEJOBS_AUTH_STATE || './output/onlinejobs_auth.json',
    },
  },
};
```

---

## 5. Core Utilities

### 5.1 `core/logger.js`

Structured JSON logger. Writes to `stdout` (info/debug) and `stderr` (error). No external
dependencies.

**Interface:**
```js
logger.debug(source, event, extra?)
logger.info(source, event, extra?)
logger.warn(source, event, extra?)
logger.error(source, event, extra?)
```

**Log shape:**
```json
{
  "level":     "info",
  "source":    "weworkremotely",
  "event":     "fetch_page",
  "timestamp": "2026-04-12T10:00:00.000Z",
  "url":       "https://...",
  "status":    "success"
}
```

**Mandatory log events:**

| Event | Level | When |
|---|---|---|
| `http_request` | debug | Before every HTTP GET |
| `http_response` | info | After successful HTTP response |
| `retry_attempt` | warn | On each retry before max |
| `retry_exhausted` | error | After all retries fail |
| `fetch_page` | info | Before fetching each paginated page |
| `fetch_page_success` | info | After page fetched successfully |
| `pagination_done` | info | When pagination stops (with reason) |
| `skip_duplicate` | debug | When hash already exists in storage |
| `job_stored` | debug | After successful storage write |
| `source_start` | info | Before source begins |
| `source_complete` | info | After source finishes (with stats) |
| `crawl_start` | info | Orchestrator begins |
| `crawl_complete` | info | Orchestrator summary |

---

### 5.2 `core/retry.js`

**Interface:**
```js
withRetry(fn: async Function, source: string, opts?: object): Promise<any>
sleep(ms: number): Promise<void>
```

**Behavior:**
- Calls `fn()` up to `maxRetries + 1` times (first attempt + N retries)
- Delay between attempts: `baseDelayMs * 2^attempt` (1s, 2s, 4s with defaults)
- Logs `retry_attempt` (warn) on each retry with attempt number, delay, error message
- Logs `retry_exhausted` (error) after final failure
- Re-throws the last error — callers must handle or catch

**Example timing:**

| Attempt | Delay before attempt |
|---|---|
| 1st (attempt 0) | 0ms |
| 2nd (attempt 1) | 1000ms |
| 3rd (attempt 2) | 2000ms |
| 4th (attempt 3) | 4000ms → throws |

---

### 5.3 `core/rateLimiter.js`

**Interface:**
```js
throttle(domain: string): Promise<void>
```

**Behavior:**
- Maintains a `Map<domain, lastRequestTimestamp>`
- On each call: computes `jitter = random(minMs, maxMs)`, waits `max(0, jitter - elapsed)`
- Updates the timestamp after wait
- Domain key is `new URL(url).hostname` — so `remoteok.com` and `www.remoteok.com` are
  treated as the same domain by callers that normalize the key

---

### 5.4 `core/pagination.js`

**Interface:**
```js
paginateByPage({ fetchPage, source, startPage?, maxPages? }): Promise<Job[]>
paginateByCursor({ fetchPage, source, maxPages? }): Promise<Job[]>
```

**`paginateByPage`:**
- Calls `fetchPage(pageNumber)` starting at `startPage` (default 1)
- Stops when:
  - `fetchPage()` returns empty array or null
  - `fetchPage()` throws (logs error, breaks)
  - Page content fingerprint matches a previously seen page (wrap-around detection)
  - `maxPages` cap reached
- Fingerprint = `JSON.stringify(items.map(j => j.external_id || j.url).sort())`

**`paginateByCursor`:**
- Calls `fetchPage(cursor)` where cursor starts as `null`
- `fetchPage` must return `{ items: Job[], nextCursor: any }`
- Stops when `nextCursor` is null/undefined, items is empty, or `maxPages` cap reached

---

### 5.5 `core/hash.js`

**Interface:**
```js
computeHash(source: string, externalId: string|null, url: string): string
```

**Algorithm:**
```
if externalId:
  key = "{source}::id::{externalId}"
else:
  key = "{source}::url::{url}"

hash = sha1(key).hex()   // 40-char hex string
```

Uses Node.js built-in `crypto.createHash('sha1')`. No external dependency.

---

### 5.6 `core/request.js`

**Interface:**
```js
get(url: string, opts?: { source, headers, responseType }): Promise<any>
```

**Behavior:**
- Wraps `axios.get()` inside `withRetry()`
- Calls `throttle(hostname)` before each attempt (inside the retry loop so each retry also waits)
- Default timeout: 30 seconds
- Default User-Agent: `Mozilla/5.0 (compatible; RemoteJobsCrawler/1.0)`
- Returns `response.data` directly

---

### 5.7 `core/browser.js`

Manages a single Playwright Chromium instance shared across all sources that need it.

**Interface:**
```js
getBrowser(): Promise<Browser>
closeBrowser(): Promise<void>
newContext(authStatePath?: string): Promise<BrowserContext>
saveContextState(context: BrowserContext, authStatePath: string): Promise<void>
```

**Behavior:**
- `getBrowser()` launches on first call, returns cached instance thereafter
- Browser args include `--no-sandbox` (required in root/Docker environments)
- `newContext()` creates a fresh context with a realistic User-Agent and locale
- If `authStatePath` is provided and the file exists, loads saved cookies/localStorage
- `saveContextState()` persists cookies to disk for cross-run session reuse

---

## 6. Source Adapters

Each source MUST implement:
```js
{
  name: string,
  fetchList(): Promise<Job[]>,
  fetchDetail(job: Job): Promise<Job | null>
}
```

Source adapters are completely isolated. No shared scraping logic inside source files.
All shared logic lives in `/core`.

---

### 6.1 `sources/remotive.js`

| Property | Value |
|---|---|
| name | `"remotive"` |
| Access method | HTTP GET (axios via `core/request`) |
| Base URL | `https://remotive.com/api/remote-jobs` |
| Pagination | None — single response contains all active jobs |

**Fetch strategy:**
- Iterates 6 category slugs: `software-dev`, `devops`, `product`, `design`, `data`, `qa`
- Makes one GET per category: `?category={slug}`
- Response shape: `{ "job-count": N, "jobs": [...] }`
- Each job: `{ id, url, title, company_name, tags[], description (HTML), candidate_required_location, publication_date }`

**Field mapping:**

| Contract field | Source field |
|---|---|
| external_id | String(job.id) |
| title | job.title |
| company | job.company_name |
| location | job.candidate_required_location \|\| "Worldwide" |
| url | job.url |
| description | job.description (HTML) |
| tags | job.tags[] |

`fetchDetail()` returns the job as-is (description already included in list response).

---

### 6.2 `sources/remoteok.js`

| Property | Value |
|---|---|
| name | `"remoteok"` |
| Access method | HTTP GET (axios via `core/request`) |
| Endpoint | `https://remoteok.com/api` |
| Pagination | None — single flat array |

**Fetch strategy:**
- Single GET to `https://remoteok.com/api`
- Response: JSON array where index 0 is metadata `{ last_updated, legal }` — skip it
- Each job: `{ id, slug, position, company, tags[], description (HTML), location, url, date }`

**Field mapping:**

| Contract field | Source field |
|---|---|
| external_id | String(job.id) |
| title | job.position |
| company | job.company |
| location | job.location \|\| "Worldwide" |
| url | job.url |
| description | job.description (HTML) |
| tags | job.tags[] |

`fetchDetail()` returns the job as-is.

---

### 6.3 `sources/weworkremotely.js`

| Property | Value |
|---|---|
| name | `"weworkremotely"` |
| Access method | HTTP GET + XML parse (`fast-xml-parser`) |
| Playwright needed | No |

**Why RSS instead of HTML scraping:**  
Direct HTML requests to weworkremotely.com return HTTP 403. The RSS feeds are publicly
accessible, return full HTML job descriptions, and are more stable than DOM selectors.

**RSS Feed URLs (6 categories):**
```
https://weworkremotely.com/categories/remote-programming-jobs.rss
https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss
https://weworkremotely.com/categories/remote-design-jobs.rss
https://weworkremotely.com/categories/remote-product-jobs.rss
https://weworkremotely.com/categories/remote-finance-legal-jobs.rss
https://weworkremotely.com/categories/remote-customer-support-jobs.rss
```

**Title parsing:**  
RSS `<title>` format is `"CompanyName: Job Title"` — split on the first colon:
```js
const colonIdx = rawTitle.indexOf(':');
company = rawTitle.substring(0, colonIdx).trim();
title   = rawTitle.substring(colonIdx + 1).trim();
```

**Field mapping:**

| Contract field | Source field |
|---|---|
| external_id | Last path segment of `<guid>` (the job URL) |
| title | Parsed from `<title>` after colon |
| company | Parsed from `<title>` before colon |
| location | `<wwr:region>` + `<wwr:country>` joined, or "Worldwide" |
| url | `<link>` |
| description | `<description>` CDATA (full HTML) |
| tags | `[]` (RSS has no tags element) |

`fetchDetail()` returns the job as-is.

---

### 6.4 `sources/onlinejobsph.js`

| Property | Value |
|---|---|
| name | `"onlinejobsph"` |
| Access method | Playwright (headless Chromium) |
| Requires credentials | Yes — `ONLINEJOBS_EMAIL` + `ONLINEJOBS_PASSWORD` |
| Auth persistence | `storageState` saved to `./output/onlinejobs_auth.json` |

**Authentication flow:**
1. On first run: navigate to login page → fill credentials → submit → wait for nav element
2. Call `saveContextState()` to persist cookies to disk
3. On subsequent runs: `newContext(authStatePath)` loads saved state, bypasses login
4. If session has expired (redirected back to login): re-authenticate and re-save

**Pagination:**
- URL pattern: `https://www.onlinejobs.ph/jobseekers/joblist/{page}`
- Iterate pages 1 → `maxPages` (default 10)
- Stop when `.no-results` marker appears OR page returns 0 job cards

**DOM Selectors** (validated against live site — adjust if site redesigns):

| Data | Selector | Fallback |
|---|---|---|
| Job card wrapper | `.jobpost-brief` | `article.job-listing` |
| Job title | `.job-title a` | `h3 a` |
| Company name | `.employer-name` | `.company` |
| Location | `.job-location` | `.location` |
| Job link | `a[href*="/jobseekers/job/"]` | `a.job-link` |
| No results marker | `.no-results` | — |
| Detail description | `#job-description` | `.job-description` |
| Detail tags | `.tag, .skill-tag` | — |

**`fetchList()` behavior:**
- Extracts title, company, location, URL from each card on the list page
- Description is left empty (`""`) — populated by `fetchDetail()`

**`fetchDetail()` behavior:**
- Skips if `job.description` is already populated
- Opens job detail URL in a new page
- Extracts `innerHTML` of the description container
- Extracts tag text content from tag elements

**`external_id` derivation:**
- Extracted from the job URL: `url.split('/').pop()` gives the slug/id segment

---

## 7. Storage Layer

### 7.1 `storage/mysqlStorage.js`

**Interface:**
```js
class MySQLStorage {
  async init(): Promise<void>
  async exists(hash: string): Promise<boolean>
  async save(job: Job): Promise<boolean>   // true = inserted, false = duplicate
  async close(): Promise<void>
}
```

**Implementation notes:**
- Uses `mysql2/promise` connection pool (connectionLimit: 5)
- `init()` creates the pool and verifies connectivity with a test connection
- `exists()` runs `SELECT id FROM raw_jobs WHERE hash = ? LIMIT 1`
- `save()` runs `INSERT IGNORE INTO raw_jobs (...) VALUES (...)` — returns `affectedRows > 0`
- `scraped_at` converted from ISO string to MySQL DATETIME format before insert

---

### 7.2 `storage/fileStorage.js`

**Interface:** Same as MySQLStorage above.

**Implementation notes:**
- Creates `output/` directory if it doesn't exist
- On `init()`: reads existing JSONL file line-by-line and loads all `hash` values into a
  `Set<string>` for O(1) dedup lookups
- `exists()`: checks the in-memory Set
- `save()`: appends `JSON.stringify(job) + '\n'` to the file; adds hash to Set
- Cross-run dedup: the hash Set is rebuilt from the file on each `init()` call

---

### 7.3 `storage/storageFactory.js`

```js
async function createStorage(): Promise<MySQLStorage | FileStorage>
```

Reads `config.storage.type` and instantiates + initializes the correct backend. Throws if
type is not `"mysql"` or `"file"`.

---

## 8. MySQL Schema

**File:** `setup.sql`  
**Run once:** `mysql -h 127.0.0.1 -u root api.remotejobs < setup.sql`

```sql
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

**Field notes:**
- `hash` UNIQUE constraint enforces dedup at the DB level (backup to application-level check)
- `tags` stored as JSON column for future querying without parsing
- `description` is LONGTEXT to accommodate full HTML content (up to 4GB per row)
- `external_id` is nullable — some sources (e.g., WWR) derive IDs from URLs

---

## 9. Deduplication Strategy

Dedup occurs at two layers:

**Layer 1 — Application (before fetchDetail):**
```js
const hash = computeHash(source, externalId, url);
const duplicate = await storage.exists(hash);
if (duplicate) { skip fetchDetail(); skip save(); }
```

This is the primary check. It avoids unnecessary HTTP requests for already-known jobs.

**Layer 2 — Storage (INSERT IGNORE / Set check):**
- MySQL: `INSERT IGNORE` silently discards rows that violate the `UNIQUE KEY unique_hash`
- File: The in-memory `Set` prevents duplicate appends within and across runs

**Hash key format:**
```
with external_id:  "{source}::id::{external_id}"
without:           "{source}::url::{url}"
```

The `external_id`-based key is preferred because URLs can change (redirects, canonical URL
updates) while source IDs are stable.

---

## 10. Entry Point Orchestration

**File:** `index.js`

```
1. require('dotenv').config()
2. createStorage()  →  connect/initialize backend
3. For each source in [remotive, remoteok, weworkremotely, onlinejobsph]:
   a. source.fetchList()  →  raw Job[]
   b. For each job:
      i.   job.hash = computeHash(source.name, job.external_id, job.url)
      ii.  if storage.exists(job.hash) → log skip_duplicate, continue
      iii. if !job.description → job = await source.fetchDetail(job)
      iv.  storage.save(job)
   c. Accumulate stats: { fetched, stored, skipped, errors }
4. Log crawl_complete summary
5. storage.close()
6. closeBrowser()
7. process.exit(0)  or  process.exit(1) if errors > 0
```

**Error isolation:** Each source runs inside a `try/catch`. A total failure of one source
(network down, auth expired, 0 results) logs the error and continues to the next source
without crashing the process.

**Concurrency:**
- `CONCURRENCY=1` (default): sources run sequentially in the array order above
- `CONCURRENCY>1`: sources run via `Promise.allSettled()` — rate limiting still applies
  per-hostname so parallel sources hitting the same domain will queue naturally

---

## 11. Environment Variables

**File:** `.env.example`

```dotenv
# Storage backend
STORAGE_TYPE=mysql                            # "mysql" | "file"

# MySQL (matches existing Laravel API db)
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=api.remotejobs

# File storage
FILE_OUTPUT_PATH=./output/raw_jobs.jsonl

# Rate limiting
RATE_LIMIT_MIN_MS=1000
RATE_LIMIT_MAX_MS=3000

# Retry
MAX_RETRIES=3
RETRY_BASE_DELAY_MS=1000

# Crawl behavior
CONCURRENCY=1
MAX_PAGES=10

# OnlineJobs.ph credentials (required for that source)
ONLINEJOBS_EMAIL=
ONLINEJOBS_PASSWORD=
ONLINEJOBS_AUTH_STATE=./output/onlinejobs_auth.json

# Playwright
PLAYWRIGHT_HEADLESS=true

# Logging
LOG_LEVEL=info                                # debug | info | warn | error
```

---

## 12. Installation & Run

```bash
# 1. Navigate to project
cd /var/www/crawler

# 2. Install dependencies
npm install

# 3. Install Playwright browser (Chromium only)
npx playwright install chromium

# 4. Create MySQL table
mysql -h 127.0.0.1 -u root api.remotejobs < setup.sql

# 5. Configure environment
cp .env.example .env
# Edit .env — set ONLINEJOBS_EMAIL and ONLINEJOBS_PASSWORD

# 6. Run
node index.js

# Run with file storage (no MySQL needed)
STORAGE_TYPE=file node index.js

# Run with debug logging
LOG_LEVEL=debug node index.js

# Run with headed browser (useful for debugging OnlineJobs.ph selectors)
PLAYWRIGHT_HEADLESS=false node index.js
```

**Verify results:**

```bash
# File mode
wc -l output/raw_jobs.jsonl
tail -1 output/raw_jobs.jsonl | jq .

# MySQL mode
mysql -h 127.0.0.1 -u root api.remotejobs \
  -e "SELECT source, COUNT(*) as count FROM raw_jobs GROUP BY source;"
```

---

## 13. Logging Reference

All logs are JSON. Pipe to `jq` for pretty output:

```bash
node index.js 2>/dev/null | jq .
node index.js 2>&1 | jq -r '. | "\(.timestamp) [\(.level)] \(.source) \(.event)"'
```

**Summary log shape (emitted at end of run):**
```json
{
  "level": "info",
  "source": "orchestrator",
  "event": "crawl_complete",
  "timestamp": "...",
  "totalFetched": 450,
  "totalStored": 112,
  "totalSkipped": 338,
  "totalErrors": 0,
  "bySource": [
    { "source": "remotive",       "fetched": 120, "stored": 30, "skipped": 90,  "errors": 0 },
    { "source": "remoteok",       "fetched": 200, "stored": 50, "skipped": 150, "errors": 0 },
    { "source": "weworkremotely", "fetched": 80,  "stored": 20, "skipped": 60,  "errors": 0 },
    { "source": "onlinejobsph",   "fetched": 50,  "stored": 12, "skipped": 38,  "errors": 0 }
  ]
}
```

---

## 14. Constraints & Non-Goals

**This system does NOT:**
- Normalize, enrich, or transform job data in any way
- Call any LLM or AI service
- Expose any HTTP API or web interface
- Push data to any external system
- Handle job expiry, deletion, or deactivation
- Deduplicate across sources (a job on both Remotive and RemoteOK is stored twice)

**Strict constraints:**
- All job fields must be present in every stored record (null is acceptable, missing is not)
- Source adapters must not import from each other
- All shared logic must live in `/core`, not inside source files
- Storage writes must be idempotent (safe to run the crawler multiple times)
