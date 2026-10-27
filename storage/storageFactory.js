'use strict';
const config       = require('../config');
const MySQLStorage = require('./mysqlStorage');
const FileStorage  = require('./fileStorage');

async function createStorage() {
  const type = config.storage.type;
  let storage;
  if (type === 'mysql')      storage = new MySQLStorage(config.storage.mysql);
  else if (type === 'file')  storage = new FileStorage(config.storage.filePath);
  else throw new Error(`Unknown STORAGE_TYPE: "${type}". Must be "mysql" or "file".`);
  await storage.init();
  return storage;
}

module.exports = { createStorage };
