'use strict';
const mysql  = require('mysql2/promise');
const logger = require('../core/logger');

class MySQLStorage {
  constructor(config) {
    this._config = config;
    this._pool   = null;
  }

  async init() {
    this._pool = mysql.createPool(this._config);
    const conn = await this._pool.getConnection();
    conn.release();
    logger.info('storage', 'mysql_connected', { database: this._config.database });
  }

  async exists(hash) {
    const [rows] = await this._pool.execute(
      'SELECT id FROM raw_jobs WHERE hash = ? LIMIT 1', [hash]
    );
    return rows.length > 0;
  }

  // Update only the tags column for an existing row (used to back-fill
  // API-provided metadata like salary/job_type without re-inserting).
  async updateTags(hash, tags) {
    await this._pool.execute(
      'UPDATE raw_jobs SET tags = ? WHERE hash = ?',
      [JSON.stringify(tags), hash]
    );
  }

  async save(job) {
    const sql = `
      INSERT INTO raw_jobs
        (source, external_id, title, company, location, geo_region, url, description, tags, scraped_at, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE tags = VALUES(tags)
    `;
    const [result] = await this._pool.execute(sql, [
      job.source,
      job.external_id   || null,
      job.title,
      job.company,
      job.location,
      job.geo_region    || null,
      job.url,
      job.description   || null,
      JSON.stringify(job.tags || []),
      job.scraped_at.replace('T', ' ').replace('Z', ''),
      job.hash,
    ]);
    return result.affectedRows > 0;
  }

  async close() {
    if (this._pool) {
      await this._pool.end();
      logger.info('storage', 'mysql_disconnected');
    }
  }
}

module.exports = MySQLStorage;
