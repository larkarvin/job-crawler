'use strict';
const crypto = require('crypto');

function computeHash(source, externalId, url) {
  const key = externalId
    ? `${source}::id::${externalId}`
    : `${source}::url::${url}`;
  return crypto.createHash('sha1').update(key).digest('hex');
}

module.exports = { computeHash };
