'use strict';
const request = require('../core/request');
const logger  = require('../core/logger');

const SOURCE   = 'greenhouse_remotecom';
const API_URL  = 'https://boards-api.greenhouse.io/v1/boards/remotecom/jobs?content=true';
const COMPANY  = 'Remote';

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

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

    const jobs = (data.jobs || []).map(j => ({
      source:      SOURCE,
      external_id: String(j.id),
      title:       j.title                          || '',
      company:     j.company_name                   || COMPANY,
      location:    j.location?.name                 || 'Worldwide',
      url:         j.absolute_url                   || '',
      description: decodeHtmlEntities(j.content     || ''),
      tags:        (j.departments || []).map(d => d.name).filter(Boolean),
      scraped_at:  new Date().toISOString(),
    }));

    logger.info(SOURCE, 'fetch_feed_success', { count: jobs.length });
    return jobs;
  },

  async fetchDetail(job) { return job; },
};
