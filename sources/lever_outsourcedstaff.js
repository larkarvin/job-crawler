'use strict';
const request = require('../core/request');
const logger  = require('../core/logger');

const SOURCE   = 'lever_outsourcedstaff';
const API_URL  = 'https://api.lever.co/v0/postings/outsourcedstaff?mode=json';
const COMPANY  = 'Outsourced Staff';

module.exports = {
  name: SOURCE,

  async fetchList() {
    logger.info(SOURCE, 'fetch_feed', { url: API_URL });

    let data;
    try {
      data = await request.get(API_URL, { source: SOURCE });
    } catch (err) {
      logger.error(SOURCE, 'fetch_feed_error', { error: err.message });
      return [];
    }

    const jobs = (Array.isArray(data) ? data : []).map(j => ({
      source:      SOURCE,
      external_id: j.id                               || null,
      title:       j.text                             || '',
      company:     COMPANY,
      location:    j.categories?.location             || j.categories?.allLocations?.[0] || 'Worldwide',
      url:         j.hostedUrl                        || '',
      description: j.description                      || '',
      tags:        [j.categories?.team, j.categories?.commitment].filter(Boolean),
      scraped_at:  new Date().toISOString(),
    }));

    logger.info(SOURCE, 'fetch_feed_success', { count: jobs.length });
    return jobs;
  },

  async fetchDetail(job) { return job; },
};
