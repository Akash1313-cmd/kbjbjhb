/**
 * Browser launcher utilities
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const puppeteer = puppeteerExtra;
const fs = require('fs');
const logger = require('../../utils/scraper-logger');
const { BROWSER_LAUNCH_MIN_DELAY_MS, BROWSER_LAUNCH_MAX_DELAY_MS } = require('../config/browser-constants');
const { BROWSER_CONFIG } = require('../config/config-loader');
const { buildChromeArgs, prepareIgnoreArgs } = require('./config');

// Module-level state
let cachedChromeExecutable;
let chromeExecutableResolved = false;
let browserLaunchChain = Promise.resolve();

/**
 * Resolve headless mode from environment variable
 * @param {boolean} defaultValue - Default headless value
 * @returns {boolean|string} Headless mode ('new', false, or true)
 */
function resolveHeadlessMode(defaultValue = false) {
    const envValue = typeof process.env.PUPPETEER_HEADLESS === 'string'
        ? process.env.PUPPETEER_HEADLESS.trim().toLowerCase()
        : '';

    if (envValue) {
        if (['headfull', 'false', 'off', '0', 'no'].includes(envValue)) {
            return false;
        }
        if (['headless', 'new', 'true', 'on', '1'].includes(envValue)) {
            return 'new';
        }
    }

    return defaultValue ? 'new' : false;
}

/**
 * Resolve Chrome executable path
 * @returns {string|undefined} Path to Chrome executable or undefined
 */
function resolveChromeExecutable() {
    if (chromeExecutableResolved) {
        return cachedChromeExecutable;
    }

    const candidates = [
        process.env.CHROME_EXECUTABLE_PATH,
        process.env.PUPPETEER_EXECUTABLE_PATH
    ]
        .map(value => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean);

    try {
        if (typeof puppeteer.executablePath === 'function') {
            const defaultPath = puppeteer.executablePath();
            if (defaultPath) {
                candidates.push(defaultPath);
            }
        }
    } catch (error) {
        logger.warn('Failed to resolve Puppeteer default executable path', { error: error.message });
    }

    cachedChromeExecutable = candidates.find(candidate => {
        try {
            return candidate && fs.existsSync(candidate);
        } catch (error) {
            return false;
        }
    });

    chromeExecutableResolved = true;

    if (cachedChromeExecutable) {
        logger.info(`Using Chrome executable: ${cachedChromeExecutable}`);
    } else {
        logger.warn('No custom Chrome executable found. Falling back to Puppeteer-managed Chromium.');
    }

    return cachedChromeExecutable;
}

/**
 * Invalidate Chrome executable cache
 */
function invalidateChromeExecutableCache() {
    chromeExecutableResolved = false;
    cachedChromeExecutable = undefined;
}

/**
 * Schedule browser launch with delay to avoid simultaneous startups
 * @param {Function} fn - Launch function to execute
 * @returns {Promise} Browser instance
 */
async function scheduleBrowserLaunch(fn) {
    const launchPromise = browserLaunchChain.then(async () => {
        if (BROWSER_LAUNCH_MAX_DELAY_MS > 0) {
            const range = Math.max(0, BROWSER_LAUNCH_MAX_DELAY_MS - BROWSER_LAUNCH_MIN_DELAY_MS);
            const delay = BROWSER_LAUNCH_MIN_DELAY_MS + (range > 0 ? Math.floor(Math.random() * (range + 1)) : 0);
            if (delay > 0) {
                logger.info(`Delaying browser launch by ${delay}ms to avoid simultaneous startups`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        return fn();
    });

    browserLaunchChain = launchPromise.then(
        () => Promise.resolve(),
        error => {
            logger.warn('Browser launch scheduling error', { error: error.message });
            return Promise.resolve();
        }
    );

    return launchPromise;
}

/**
 * Launch browser with fallback options
 * @param {Object} baseLaunchOptions - Launch options
 * @returns {Promise<Browser>} Browser instance
 */
async function launchBrowserWithFallback(baseLaunchOptions) {
    const preferredExecutable = resolveChromeExecutable();
    const variants = [];

    if (preferredExecutable) {
        variants.push({ ...baseLaunchOptions, executablePath: preferredExecutable });
    }
    variants.push({ ...baseLaunchOptions });

    let lastLaunchError = null;

    for (const options of variants) {
        try {
            return await puppeteer.launch(options);
        } catch (error) {
            lastLaunchError = error;
            if (options.executablePath) {
                logger.error('Failed to launch preferred Chrome executable', { error: error.message });
                invalidateChromeExecutableCache();
            } else {
                logger.error('Failed to launch Puppeteer-managed Chromium', { error: error.message });
            }
        }
    }

    throw lastLaunchError || new Error('Failed to launch Chrome');
}

/**
 * Main browser launcher
 * @param {Object} options - Launch options
 * @returns {Promise<Browser>} Browser instance
 */
async function launchChromium(options = {}) {
    const {
        extraArgs = [],
        headless,
        ignoreDefaultArgs,
        ...rest
    } = options;

    const launchOptions = {
        ...rest,
        headless: typeof headless !== 'undefined' ? headless : resolveHeadlessMode(BROWSER_CONFIG.visibility.headless),
        args: buildChromeArgs(extraArgs),
        ignoreDefaultArgs: prepareIgnoreArgs(ignoreDefaultArgs)
    };

    return scheduleBrowserLaunch(() => launchBrowserWithFallback(launchOptions));
}

module.exports = {
    launchChromium,
    launchBrowserWithFallback,
    scheduleBrowserLaunch,
    resolveChromeExecutable,
    resolveHeadlessMode,
    invalidateChromeExecutableCache
};
