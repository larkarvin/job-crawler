'use strict';
require('dotenv').config();

const config             = require('./config');
const logger             = require('./core/logger');
const { computeHash }    = require('./core/hash');
const { closeBrowser }   = require('./core/browser');
const { createStorage }  = require('./storage/storageFactory');

const remotive             = require('./sources/remotive');
const remoteok             = require('./sources/remoteok');
const weworkremotely       = require('./sources/weworkremotely');
const greenhouse_remotecom = require('./sources/greenhouse_remotecom');
const lever_outsourcedstaff = require('./sources/lever_outsourcedstaff');

const ALL_SOURCES = [remotive, remoteok, weworkremotely, greenhouse_remotecom, lever_outsourcedstaff];

const sourceFilter = process.env.SOURCES
  ? process.env.SOURCES.split(',').map(s => s.trim().toLowerCase())
  : null;

const SOURCES = sourceFilter
  ? ALL_SOURCES.filter(s => sourceFilter.includes(s.name))
  : ALL_SOURCES;

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
        // Still update tags so API-provided metadata (salary, job_type, etc.)
        // stays current even when the description hasn't changed.
        if (job.tags && job.tags.length > 0) {
          await storage.updateTags(job.hash, job.tags).catch(() => {});
        }
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
    sources:     SOURCES.map(s => s.name),
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
    for (const source of SOURCES) {
      allStats.push(await runSource(source, storage));
    }
  } else {
    const results = await Promise.allSettled(
      SOURCES.map(source => runSource(source, storage))
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
