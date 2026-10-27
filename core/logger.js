'use strict';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function log(level, source, event, extra = {}) {
  if (LEVELS[level] < CURRENT) return;
  const line = JSON.stringify({
    level, source, event,
    timestamp: new Date().toISOString(),
    ...extra,
  });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  debug: (s, e, x) => log('debug', s, e, x),
  info:  (s, e, x) => log('info',  s, e, x),
  warn:  (s, e, x) => log('warn',  s, e, x),
  error: (s, e, x) => log('error', s, e, x),
};
