# Remote Job Crawler — Project Requirements

**Project:** Remote Job Data Ingestion System  
**Date:** April 12, 2026  
**Status:** Approved for Development  

---

## What Are We Building?

A background service that automatically visits remote job websites, collects job listings,
and saves them to our database — ready to be used by other parts of our platform.

Think of it as a scheduled data collector that runs quietly in the background, gathers raw
job data from multiple sources, and stores everything in one place.

---

## Why Do We Need This?

To power our remote jobs platform, we need a reliable, up-to-date feed of remote job listings
from across the internet. Manually copying job data is not scalable. This system automates
the entire collection process so that our database always has fresh, real job listings without
any human effort after the initial setup.

---

## What It Does (In Plain Terms)

1. **Visits four remote job websites** automatically
2. **Reads job listings** — title, company, location, description, and other details
3. **Saves everything to our database** exactly as found, without editing or interpreting it
4. **Skips jobs it already has** — so we never store the same job twice
5. **Keeps a log** of everything it does — what was collected, what was skipped, and any errors

---

## The Four Data Sources

| Source | How We Access It | Notes |
|---|---|---|
| **Remotive** | Official public API | Clean, structured data. No login needed. |
| **RemoteOK** | Public JSON feed | Clean, structured data. No login needed. |
| **We Work Remotely** | Public RSS feed | No login needed. Full job descriptions included. |
| **OnlineJobs.ph** | Web browser automation | Requires an account login. Focuses on Philippine remote work. |

---

## What Data We Collect

For every job listing, we collect and store exactly these fields:

| Field | Description | Example |
|---|---|---|
| Source | Which website the job came from | `"remotive"` |
| Job ID | The website's own ID for the job | `"123456"` |
| Title | Job title | `"Senior Backend Developer"` |
| Company | Company name | `"Acme Corp"` |
| Location | Location as listed | `"Worldwide"` or `"Philippines"` |
| URL | Direct link to the job posting | `https://...` |
| Description | Full job description (raw) | HTML or plain text |
| Tags | Skills or categories tagged | `["Node.js", "Remote", "Full-time"]` |
| Collected At | When we collected this listing | `2026-04-12T10:00:00Z` |

---

## What It Does NOT Do

This system is strictly a **data collector**. It does not:

- Edit, rewrite, or summarize job descriptions
- Use AI or language models of any kind
- Rank, score, or recommend jobs
- Show any user interface or dashboard
- Send emails or notifications
- Delete or expire old listings

Any processing of the collected data happens in a separate system.

---

## Key System Behaviors

### Runs Without Human Intervention
Once set up, the crawler runs with a single command and handles everything automatically —
visiting each source, collecting data, skipping duplicates, and saving results.

### Never Stores Duplicates
Before saving any job, the system checks if it already exists in our database. If it does,
the job is skipped. This keeps our data clean and prevents redundant records.

### Handles Failures Gracefully
If one source is temporarily unavailable (e.g., a website is down), the system logs the
issue and continues collecting from the other sources. A single failure does not stop
the entire run.

### Respectful of Source Websites
The system intentionally introduces small random delays between requests to avoid
overloading the source websites. This follows standard web crawling etiquette and reduces
the risk of being blocked.

### Retries on Temporary Errors
If a request fails due to a temporary network issue, the system automatically retries
up to 3 times before giving up and moving on.

### Full Activity Log
Every action is logged — pages visited, jobs saved, duplicates skipped, and errors
encountered. At the end of each run, a summary report shows total results per source.

---

## Storage Options

The system supports two ways to store collected data:

| Mode | Description | Best For |
|---|---|---|
| **MySQL** | Saves directly to our shared database | Production use |
| **File** | Saves to a local text file (one job per line) | Testing or backup |

The storage mode is set in the configuration file and can be switched at any time.

---

## Where the Data Lives (MySQL)

All collected jobs are stored in a database table called `raw_jobs` in our existing MySQL
database (`api.remotejobs`). This table is shared infrastructure — other parts of the
platform can read from it directly.

---

## System Requirements

| Requirement | Detail |
|---|---|
| Runtime | Node.js 18 or higher |
| Browser engine | Chromium (managed automatically by Playwright) |
| Database | MySQL 8+ (existing shared instance) |
| Operating system | Linux (Ubuntu/Debian recommended) |
| Internet access | Required (crawler must reach external websites) |

---

## Setup Overview

Setting up the system requires:

1. Installing Node.js dependencies (`npm install`)
2. Installing the Chromium browser engine (one command, automatic)
3. Running the database setup script to create the `raw_jobs` table
4. Filling in the configuration file (`.env`) with database credentials and the
   OnlineJobs.ph account login
5. Running `node index.js` to start a crawl

After initial setup, subsequent runs require only step 5.

---

## Running the Crawler

```
node index.js
```

That's the only command needed for a full crawl across all four sources.

---

## Example Summary Output

At the end of each run, the system prints a summary like this:

```
Crawl complete
  Total collected : 450 jobs
  New saved       : 112 jobs
  Already existed : 338 jobs (skipped)
  Errors          : 0

  By source:
    remotive        → 30 new  (120 collected)
    remoteok        → 50 new  (200 collected)
    weworkremotely  → 20 new  (80 collected)
    onlinejobsph    → 12 new  (50 collected)
```

---

## Assumptions & Dependencies

- The OnlineJobs.ph source requires a valid account. Credentials must be provided in the
  configuration file before the first run.
- The crawler does not create or manage the MySQL database — it only writes to an existing
  instance that is already running.
- We Work Remotely is accessed via their RSS feed (not the website directly), which is their
  publicly supported access method.

---

## Out of Scope

The following are explicitly outside the scope of this project:

- Processing, enriching, or categorizing collected job data
- Building any user-facing interface
- Scheduling or automation (cron setup is handled separately by the infrastructure team)
- Monitoring or alerting integrations
- Multi-region or distributed crawling
