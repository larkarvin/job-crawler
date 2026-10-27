'use strict';
const request      = require('../core/request');
const logger       = require('../core/logger');
const { XMLParser } = require('fast-xml-parser');

const SOURCE = 'weworkremotely';
// Each entry maps a feed URL to the human-readable category label stored in tags.
const RSS_FEEDS = [
  { url: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',      category: 'Programming' },
  { url: 'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',  category: 'DevOps' },
  { url: 'https://weworkremotely.com/categories/remote-design-jobs.rss',           category: 'Design' },
  { url: 'https://weworkremotely.com/categories/remote-product-jobs.rss',          category: 'Product' },
  { url: 'https://weworkremotely.com/categories/remote-customer-support-jobs.rss', category: 'Customer Support' },
  { url: 'https://weworkremotely.com/categories/all-other-remote-jobs.rss',        category: 'Other' },
];

// Keep processEntities: false to avoid entity expansion limits on HTML descriptions.
// We manually decode the description after parsing.
const xmlParser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  processEntities:     false,
});

// Decode the standard XML entities that appear in WWR RSS descriptions
function decodeEntities(str) {
  if (!str) return str;
  return String(str)
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g,  '&');   // must be last
}

// Parse RFC 2822 pubDate ("Thu, 22 Jan 2026 13:45:49 +0000") to ISO string
function parsePubDate(pubDate) {
  if (!pubDate) return null;
  try {
    const d = new Date(pubDate);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

module.exports = {
  name: SOURCE,

  async fetchList() {
    const allJobs = [];

    for (const { url: feedUrl, category } of RSS_FEEDS) {
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

        const guid       = item.guid || item.link;
        const externalId = guid ? String(guid).split('/').filter(Boolean).pop() : null;

        // geo_region comes from <region> in the RSS item
        const geo_region = item.region || item['wwr:region'] || null;

        // Use pubDate as scraped_at so the worker can use it as posted_at fallback
        const pubDate    = parsePubDate(item.pubDate);
        const scraped_at = pubDate || new Date().toISOString();

        return {
          source:      SOURCE,
          external_id: externalId,
          title,
          company,
          location:    geo_region || 'Worldwide',
          geo_region,
          url:         item.link,
          description: decodeEntities(item.description) || '',
          tags:        [category],
          scraped_at,
        };
      }).filter(Boolean);

      logger.info(SOURCE, 'fetch_feed_success', { url: feedUrl, count: jobs.length });
      allJobs.push(...jobs);
    }

    return allJobs;
  },

  async fetchDetail(job) { return job; },
};
