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
