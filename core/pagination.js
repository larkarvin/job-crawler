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
