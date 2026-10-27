'use strict';
const fs     = require('fs');
const path   = require('path');
const logger = require('../core/logger');

class FileStorage {
  constructor(filePath) {
    this._filePath = filePath;
    this._seen     = new Set();
  }

  async init() {
    const dir = path.dirname(this._filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    if (fs.existsSync(this._filePath)) {
      const lines = fs.readFileSync(this._filePath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { const obj = JSON.parse(line); if (obj.hash) this._seen.add(obj.hash); }
        catch (_) {}
      }
      logger.info('storage', 'file_loaded', { path: this._filePath, existingCount: this._seen.size });
    }
  }

  async exists(hash) { return this._seen.has(hash); }

  async save(job) {
    if (this._seen.has(job.hash)) return false;
    this._seen.add(job.hash);
    fs.appendFileSync(this._filePath, JSON.stringify(job) + '\n', 'utf8');
    return true;
  }

  async close() {
    logger.info('storage', 'file_closed', { path: this._filePath });
  }
}

module.exports = FileStorage;
