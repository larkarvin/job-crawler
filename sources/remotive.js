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

      const jobs = (data.jobs || []).map(j => {
        // Carry API-provided structured fields as prefixed tags so parsers
        // can use them without schema changes.
        const extraTags = [];
        if (j.salary)    extraTags.push(`salary:${j.salary}`);
        if (j.job_type)  extraTags.push(`job_type:${j.job_type}`);

        // Use the API publication_date as scraped_at for accurate posted_at
        let scraped_at = new Date().toISOString();
        if (j.publication_date) {
          const d = new Date(j.publication_date);
          if (!isNaN(d)) scraped_at = d.toISOString();
        }

        return {
          source:      SOURCE,
          external_id: String(j.id),
          title:       j.title             || '',
          company:     j.company_name      || '',
          location:    j.candidate_required_location || 'Worldwide',
          url:         j.url,
          description: j.description       || '',
          tags:        [...(Array.isArray(j.tags) ? j.tags : []), ...extraTags],
          scraped_at,
        };
      });

      logger.info(SOURCE, 'fetch_category_success', { category, count: jobs.length });
      allJobs.push(...jobs);
    }

    return allJobs;
  },

  async fetchDetail(job) { return job; },
};
