# Remote Job Crawler

A Node.js service that crawls four remote job boards and stores raw listings in MySQL or JSONL.

---

## Sources

| Source | Method | Auth |
|---|---|---|
| [Remotive](https://remotive.com) | REST API | None |
| [RemoteOK](https://remoteok.com) | JSON feed | None |
| [We Work Remotely](https://weworkremotely.com) | RSS feeds | None |
| [OnlineJobs.ph](https://www.onlinejobs.ph) | Playwright (headless Chromium) | Required |

---

## Setup

**1. Install dependencies**
```bash
npm install
```

**2. Install Playwright browser**
```bash
npx playwright install chromium
```

**3. Create the database table**
```bash
mysql -h 127.0.0.1 -u root api.remotejobs < setup.sql
```

**4. Configure environment**
```bash
cp .env.example .env
# Edit .env — set ONLINEJOBS_EMAIL and ONLINEJOBS_PASSWORD
```

---

## Usage

```bash
# Full crawl (MySQL storage)
node index.js

# File storage — no MySQL needed
STORAGE_TYPE=file node index.js

# Debug logging
LOG_LEVEL=debug node index.js

# Headed browser — useful for debugging OnlineJobs.ph selectors
PLAYWRIGHT_HEADLESS=false node index.js
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `STORAGE_TYPE` | `mysql` | `mysql` or `file` |
| `DB_HOST` | `127.0.0.1` | MySQL host |
| `DB_PORT` | `3306` | MySQL port |
| `DB_USER` | `root` | MySQL user |
| `DB_PASSWORD` | *(empty)* | MySQL password |
| `DB_NAME` | `api.remotejobs` | MySQL database |
| `FILE_OUTPUT_PATH` | `./output/raw_jobs.jsonl` | Output path for file storage |
| `RATE_LIMIT_MIN_MS` | `1000` | Min delay between requests to same host |
| `RATE_LIMIT_MAX_MS` | `3000` | Max delay (random jitter) |
| `MAX_RETRIES` | `3` | HTTP retry attempts |
| `RETRY_BASE_DELAY_MS` | `1000` | Base delay for exponential backoff |
| `CONCURRENCY` | `1` | `1` = sequential sources, `>1` = parallel |
| `MAX_PAGES` | `10` | Safety cap for paginated sources |
| `ONLINEJOBS_EMAIL` | — | OnlineJobs.ph account email |
| `ONLINEJOBS_PASSWORD` | — | OnlineJobs.ph account password |
| `ONLINEJOBS_AUTH_STATE` | `./output/onlinejobs_auth.json` | Saved session path |
| `PLAYWRIGHT_HEADLESS` | `true` | Set `false` for headed browser |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

---

## Output

Every stored record contains exactly these fields:

```json
{
  "source":      "remotive",
  "external_id": "123456",
  "title":       "Senior Backend Developer",
  "company":     "Acme Corp",
  "location":    "Worldwide",
  "url":         "https://remotive.com/remote-jobs/...",
  "description": "<p>Full job description HTML...</p>",
  "tags":        ["Node.js", "Remote"],
  "scraped_at":  "2026-04-12T10:00:00.000Z",
  "hash":        "a3f1c2..."
}
```

### Verify results

```bash
# File mode
wc -l output/raw_jobs.jsonl
tail -1 output/raw_jobs.jsonl | jq .

# MySQL mode
mysql -h 127.0.0.1 -u root api.remotejobs \
  -e "SELECT source, COUNT(*) AS count FROM raw_jobs GROUP BY source;"
```

### Log output

All logs are JSON on stdout (errors on stderr):

```bash
node index.js 2>/dev/null | jq .
node index.js 2>&1 | jq -r '"\(.timestamp) [\(.level)] \(.source) \(.event)"'
```

End-of-run summary:

```json
{
  "level": "info",
  "source": "orchestrator",
  "event": "crawl_complete",
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

## How It Works

```
[Remotive API]         → HTTP GET (axios)
[RemoteOK JSON feed]   → HTTP GET (axios)
[We Work Remotely RSS] → HTTP GET (axios) + XML parse
[OnlineJobs.ph]        → Playwright headless Chromium
        ↓
  SHA-1 hash check     → skip if already stored
        ↓
  storage layer        → MySQL INSERT IGNORE  OR  JSONL append
```

**Deduplication** runs at two layers: the application checks the hash before fetching job details, and the storage layer enforces uniqueness (MySQL `UNIQUE KEY`, file storage in-memory `Set`). Safe to run multiple times.

**Rate limiting** introduces a random 1–3 second delay between requests to the same hostname. **Retry** uses exponential backoff (1s → 2s → 4s) on HTTP failures. **Error isolation** means a complete failure of one source is logged and skipped — the other three sources continue normally.

**OnlineJobs.ph** saves session cookies to `./output/onlinejobs_auth.json` after the first login so subsequent runs skip the login step. If credentials are not set, the source is skipped without affecting the rest of the crawl.

---

## Project Structure

```
config/
  index.js              Central config (reads from .env)
core/
  logger.js             Structured JSON logger
  retry.js              Exponential backoff retry
  rateLimiter.js        Per-hostname request throttle
  hash.js               SHA-1 dedup hash
  request.js            axios GET with retry + rate limiting
  pagination.js         Page-number and cursor pagination helpers
  browser.js            Playwright singleton + session helpers
sources/
  remotive.js           Remotive REST API adapter
  remoteok.js           RemoteOK JSON feed adapter
  weworkremotely.js     We Work Remotely RSS adapter
  onlinejobsph.js       OnlineJobs.ph Playwright adapter
storage/
  mysqlStorage.js       MySQL backend
  fileStorage.js        JSONL file backend
  storageFactory.js     createStorage() factory
output/                 Runtime output (gitignored)
index.js                Orchestrator entry point
setup.sql               MySQL table DDL
```
