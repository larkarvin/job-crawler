'use strict';
const { chromium } = require('playwright');
const fs           = require('fs');
const path         = require('path');
const config       = require('../config');
const logger       = require('./logger');

let _browser = null;

async function getBrowser() {
  if (_browser) return _browser;
  logger.info('browser', 'launch', { headless: config.playwright.headless });
  _browser = await chromium.launch({
    headless: config.playwright.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  return _browser;
}

async function closeBrowser() {
  if (_browser) {
    await _browser.close();
    _browser = null;
    logger.info('browser', 'closed');
  }
}

async function newContext(authStatePath = null) {
  const browser     = await getBrowser();
  const contextOpts = {
    userAgent:  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale:     'en-US',
    timezoneId: 'America/New_York',
  };
  if (authStatePath && fs.existsSync(authStatePath)) {
    contextOpts.storageState = authStatePath;
    logger.info('browser', 'load_auth_state', { path: authStatePath });
  }
  return browser.newContext(contextOpts);
}

async function saveContextState(context, authStatePath) {
  const dir = path.dirname(authStatePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  await context.storageState({ path: authStatePath });
  logger.info('browser', 'save_auth_state', { path: authStatePath });
}

module.exports = { getBrowser, closeBrowser, newContext, saveContextState };
