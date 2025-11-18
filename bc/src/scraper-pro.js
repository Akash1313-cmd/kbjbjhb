const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const puppeteer = puppeteerExtra;
const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('./utils/scraper-logger');
const CONSTANTS = require('./utils/constants');
const phoneValidator = require('./utils/phone-validator');

/**
 * Atomically write JSON data to a file to prevent corruption
 * @param {string} filePath - Target file path
 * @param {any} data - Data to write (will be JSON stringified)
 */
function atomicWriteJSON(filePath, data) {
    const tmpPath = `${filePath}.${Date.now()}.tmp`;
    try {
        // Write to temporary file
        const jsonString = JSON.stringify(data, null, 2);
        fs.writeFileSync(tmpPath, jsonString, 'utf8');
        
        // Ensure data is written to disk (important for crash safety)
        const fd = fs.openSync(tmpPath, 'r+');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        
        // Atomically rename temp file to target (this is atomic on all platforms)
        fs.renameSync(tmpPath, filePath);
        
        return true;
    } catch (err) {
        // Clean up temp file if it exists
        try {
            if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
            }
        } catch (cleanupErr) {
            // Ignore cleanup errors
        }
        throw err;
    }
}
let cachedChromeExecutable;
let chromeExecutableResolved = false;
const BASE_CHROME_ARGS = [
    // Core stability args
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-features=AudioServiceOutOfProcess',
    '--disable-features=RendererCodeIntegrity',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-notifications',
    '--disable-offer-store-unmasked-wallet-cards',
    '--disable-popup-blocking',
    '--disable-print-preview',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-speech-api',
    '--disable-sync',
    '--disable-blink-features=AutomationControlled',
    '--disable-automation',
    '--hide-scrollbars',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-pings',
    '--no-sandbox',
    '--password-store=basic',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--disable-setuid-sandbox',
    '--disable-features=TranslateUI',
    
    // Production memory optimization
    '--memory-pressure-off',
    '--max-old-space-size=1024',  // Increased for stability
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor',
    
    // Production performance flags
    '--aggressive-cache-discard',
    '--disable-background-mode',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-accessibility',
    '--disable-features=CalculateNativeWinOcclusion',
    '--force-color-profile=srgb',
    
    // Additional production flags
    '--no-first-run',
    '--disable-features=Translate',
    '--disable-features=BlinkGenPropertyTrees'
];

const BROWSER_LAUNCH_MIN_DELAY_MS = Math.max(0, parseInt(process.env.BROWSER_LAUNCH_MIN_DELAY_MS || '0', 10));
const BROWSER_LAUNCH_MAX_DELAY_MS = Math.max(
    BROWSER_LAUNCH_MIN_DELAY_MS,
    parseInt(process.env.BROWSER_LAUNCH_MAX_DELAY_MS || process.env.BROWSER_LAUNCH_MIN_DELAY_MS || '0', 10)
);
let browserLaunchChain = Promise.resolve();

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

function invalidateChromeExecutableCache() {
    chromeExecutableResolved = false;
    cachedChromeExecutable = undefined;
}

function buildChromeArgs(extraArgs = []) {
    const merged = [...BASE_CHROME_ARGS, ...extraArgs.filter(Boolean)];
    return Array.from(new Set(merged));
}

function prepareIgnoreArgs(ignoreArgs) {
    const list = Array.isArray(ignoreArgs) ? [...ignoreArgs] : [];
    if (!list.includes('--enable-automation')) {
        list.push('--enable-automation');
    }
    return list;
}

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

// ==============================================================================
// Browser Data Cleaner - Clear Cache, Cookies, History, LocalStorage
// ==============================================================================
/**
 * Clear all browser data using Chrome DevTools Protocol (CDP)
 * @param {Object} browser - Puppeteer browser instance
 * @param {string} mode - 'light' (cookies only) or 'full' (everything)
 */
async function clearBrowserData(browser, mode = 'full') {
    try {
        const pages = await browser.pages();
        if (pages.length === 0) return;
        
        // Get first page to access CDP
        const page = pages[0];
        const client = await page.target().createCDPSession();
        
        if (mode === 'full') {
            // Clear ALL data: cache, cookies, storage
            await client.send('Network.clearBrowserCache');
            await client.send('Network.clearBrowserCookies');
            
            // Clear storage for all origins
            try {
                await client.send('Storage.clearDataForOrigin', {
                    origin: '*',
                    storageTypes: 'all'
                });
            } catch (err) {
                // Fallback: Clear for each page individually
                for (const p of pages) {
                    try {
                        await p.evaluate(() => {
                            localStorage.clear();
                            sessionStorage.clear();
                            indexedDB.databases().then(dbs => {
                                dbs.forEach(db => indexedDB.deleteDatabase(db.name));
                            });
                        });
                    } catch (e) {}
                }
            }
            
            logger.debug('Full browser clean: Cache + Cookies + Storage cleared');
        } else if (mode === 'light') {
            // Only clear cookies (faster)
            await client.send('Network.clearBrowserCookies');
            logger.debug('Light clean: Cookies cleared');
        }
        
        await client.detach();
    } catch (err) {
        logger.warn(`Browser clean failed: ${err.message}`);
    }
}

/**
 * Clear page-specific data (localStorage, sessionStorage)
 * @param {Object} page - Puppeteer page instance
 */
async function clearPageData(page) {
    try {
        await page.evaluate(() => {
            // Clear localStorage
            localStorage.clear();
            // Clear sessionStorage
            sessionStorage.clear();
            // Clear cookies via document
            document.cookie.split(";").forEach((c) => {
                document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
            });
        });
    } catch (err) {
        // Ignore errors - page might not support storage
    }
}

/**
 * NUCLEAR OPTION: Clear absolutely everything
 * Use this when you want to completely wipe browser data
 */
async function clearEverything(browser) {
    try {
        const pages = await browser.pages();
        if (pages.length === 0) return;
        
        const page = pages[0];
        const client = await page.target().createCDPSession();
        
        // Clear using working CDP commands
        await client.send('Network.clearBrowserCache');
        await client.send('Network.clearBrowserCookies');
        
        // Clear all page-level storage
        for (const p of pages) {
            try {
                await p.evaluate(() => {
                    // Clear all storage types
                    localStorage.clear();
                    sessionStorage.clear();
                    
                    // Clear IndexedDB
                    indexedDB.databases().then(dbs => {
                        dbs.forEach(db => indexedDB.deleteDatabase(db.name));
                    });
                    
                    // Clear cookies
                    document.cookie.split(";").forEach(c => {
                        document.cookie = c.replace(/^ +/, "")
                            .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
                    });
                });
            } catch (e) {}
        }
        
        await client.detach();
        logger.debug('NUCLEAR CLEAN: Cache + Cookies + Storage wiped');
    } catch (err) {
        logger.warn(`Nuclear clean failed: ${err.message}`);
    }
}

/**
 * Close default about:blank tabs so only worker tabs stay visible.
 */
async function closeDefaultPages(browser) {
    try {
        const pages = await browser.pages();
        if (!pages || pages.length === 0) return;
        // Keep at least one tab alive; closing the last window can exit Chrome
        if (pages.length <= 1) {
            return;
        }
        let keptOne = false;
        for (const page of pages) {
            const isBlank = page.url() === 'about:blank';
            if (isBlank && !keptOne) {
                keptOne = true;
                continue;
            }
            if (isBlank) {
                try { await page.close(); } catch (_) {}
            }
        }
    } catch (error) {
        console.log(`   2s?,?  Failed to close default pages: ${error.message}`);
    }
}

// ==============================================================================
// Load Browser Configuration from browser-config.json
// ==============================================================================
function loadBrowserConfig() {
    const defaultBrowserConfig = {
        visibility: { headless: false },
        windowSettings: {
            startMaximized: true,
            windowWidth: 1200,
            windowHeight: 900,
            windowPositionX: 100,
            windowPositionY: 50
        },
        dualBrowserMode: {
            enabled: true,
            browser1: { windowWidth: 800, windowHeight: 900, windowPositionX: 100, windowPositionY: 50 },
            browser2: { windowWidth: 800, windowHeight: 900, windowPositionX: 700, windowPositionY: 50 }
        },
        workers: { parallelWorkers: 100, maxWorkers: 100, minWorkers: 1 },
        performance: { blockImages: true, blockMedia: true },
        scrolling: { idleTimeout: 10, scrollDelay: { min: 1000, max: 2000 }, checkEndOfList: true },
        devtools: { enabled: false }
    };

    try {
        const browserConfigPath = path.join(__dirname, '../config/browser-config.json');
        if (fs.existsSync(browserConfigPath)) {
            const userBrowserConfig = JSON.parse(fs.readFileSync(browserConfigPath, 'utf-8'));
            return { ...defaultBrowserConfig, ...userBrowserConfig };
        }
    } catch (error) {
        logger.warn('Failed to load browser-config.json, using defaults', { error: error.message });
    }
    
    return defaultBrowserConfig;
}

/**
 * Close all about:blank tabs except provided keepPages (if any).
 * If there are only blank tabs and keepPages is empty, keeps one alive.
 */
async function closeBlankTabsExcept(browser, keepPages = []) {
    try {
        const keepSet = new Set(keepPages);
        const pages = await browser.pages();
        if (!pages || pages.length === 0) return;
        const hasKeep = keepSet.size > 0;
        const hasNonBlank = pages.some(p => p.url() !== "about:blank");
        let keptOne = false;
        for (const page of pages) {
            const isBlank = page.url() === "about:blank";
            if (!isBlank) continue;
            if (keepSet.has(page)) continue;
            if (!hasKeep && !hasNonBlank && !keptOne) { keptOne = true; continue; }
            try { await page.close(); } catch (_) {}
        }
    } catch (error) {
        console.log(`   Failed to close blank tabs: ${error.message}`);
    }
}

const BROWSER_CONFIG = loadBrowserConfig();

// ==============================================================================
// Load Configuration from config.json or use defaults
// ==============================================================================
function loadConfig() {
    const defaultConfig = {
        headless: false,
        scrollTimeout: CONSTANTS.MAX_SCROLL_IDLE_TIME_SECONDS * 1000,
        parallelWorkers: 'auto',  // 'auto' or number
        maxWorkers: CONSTANTS.MAX_WORKERS,
        minWorkers: CONSTANTS.MIN_WORKERS,
        browserRestartInterval: CONSTANTS.BROWSER_RESTART_INTERVAL,
        outputDir: path.join(__dirname, '..', 'results'),
        phonePattern: CONSTANTS.PHONE_PATTERN,
        smartScrolling: false,
        retryAttempts: CONSTANTS.DEFAULT_RETRY_ATTEMPTS,
        retryDelay: CONSTANTS.RETRY_BASE_DELAY,
        enableErrorLogging: true,
        enableResume: true
    };

    try {
        if (fs.existsSync(path.join(__dirname, '../config/config.json'))) {
            const userConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/config.json'), 'utf-8'));
            
            // Handle auto workers
            if (userConfig.parallelWorkers === 'auto') {
                const cpuCount = os.cpus().length;
                userConfig.parallelWorkers = Math.min(userConfig.maxWorkers || 4, Math.max(userConfig.minWorkers || 2, Math.floor(cpuCount / 2)));
            }
            
            // Expand tilde in outputDir
            if (userConfig.outputDir && userConfig.outputDir.startsWith('~')) {
                userConfig.outputDir = userConfig.outputDir.replace('~', os.homedir());
            }
            
            // Merge with browser config
            const merged = { ...defaultConfig, ...userConfig };
            merged.parallelWorkers = BROWSER_CONFIG.workers.parallelWorkers || merged.parallelWorkers;
            merged.parallelPipeline = BROWSER_CONFIG.dualBrowserMode.enabled !== undefined ? BROWSER_CONFIG.dualBrowserMode.enabled : merged.parallelPipeline;
            
            return merged;
        }
    } catch (error) {
        logger.warn('Failed to load config, using defaults', { error: error.message });
    }
    
    // Merge defaults with browser config
    const merged = { ...defaultConfig };
    merged.parallelWorkers = BROWSER_CONFIG.workers.parallelWorkers || defaultConfig.parallelWorkers;
    merged.parallelPipeline = BROWSER_CONFIG.dualBrowserMode.enabled;
    
    return merged;
}

const CONFIG = loadConfig();

// ==============================================================================
// Progress & Error Management
// ==============================================================================
class ProgressManager {
    constructor() {
        this.progressFile = 'scraper-progress.json';
        this.errorLogFile = 'scraper-errors.log';
    }

    loadProgress() {
        try {
            if (CONFIG.enableResume && fs.existsSync(this.progressFile)) {
                const progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf-8'));
                logger.success(`Resuming from previous session (${progress.completedKeywords.length} completed)`);
                return progress;
            }
        } catch (error) {
            logger.error('Failed to load progress', { error: error.message });
        }
        return { completedKeywords: [], failedPlaces: [] };
    }

    saveProgress(data) {
        try {
            const saveLocalFiles = process.env.SAVE_LOCAL_FILES !== 'false';
            if (CONFIG.enableResume && saveLocalFiles) {
                atomicWriteJSON(this.progressFile, data);
            }
        } catch (error) {
            logger.error('Failed to save progress', { error: error.message });
        }
    }

    logError(error, context) {
        if (!CONFIG.enableErrorLogging) return;
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] ${context}: ${error.message}\n`;
        try {
            fs.appendFileSync(this.errorLogFile, logEntry);
        } catch (err) {}
    }

    clearProgress() {
        try {
            if (fs.existsSync(this.progressFile)) fs.unlinkSync(this.progressFile);
        } catch (error) {
            logger.error('Failed to clear progress', { error: error.message });
        }
    }
}

const progressManager = new ProgressManager();

// CAPTCHA Detector
class CaptchaDetector {
    constructor() {
        this.detectionCount = 0;
        this.lastDetection = null;
    }

    async detect(page) {
        try {
            const html = await page.content();
            return this.checkForCaptcha(html);
        } catch (error) {
            return false;
        }
    }
    
    async detectCaptcha(page) {
        return this.detect(page);
    }
    
    checkForCaptcha(html) {
        if (!html) return false;
        
        const captchaIndicators = [
            'recaptcha',
            'g-recaptcha',
            'captcha',
            'challenge-form',
            'Are you a robot',
            'not a robot',
            'verify you are human'
        ];
        
        const htmlLower = html.toLowerCase();
        const detected = captchaIndicators.some(indicator => htmlLower.includes(indicator));
        
        if (detected) {
            this.detectionCount++;
            this.lastDetection = new Date();
        }
        
        return detected;
    }
    
    shouldStopScraping() {
        return this.detectionCount > 3;
    }
    
    showHelp() {
        logger.warn('CAPTCHA detected! Please manually solve it in the browser window.');
    }

    getCount() {
        return this.detectionCount;
    }

    reset() {
        this.detectionCount = 0;
        this.lastDetection = null;
    }
}

const captchaDetector = new CaptchaDetector();

// Emergency data storage (REMOVED)

// ==============================================================================
// Configuration (Python's CONFIG equivalent)
// ==============================================================================

// ==============================================================================
// Utility Functions
// ==============================================================================

/**
 * Random delay between min and max milliseconds
 */
function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Get device screen dimensions (cached)
 */
let DEVICE_SCREEN = null;
function getDeviceScreenDimensions() {
    if (DEVICE_SCREEN) return DEVICE_SCREEN;
    
    try {
        // Try to get actual screen dimensions using PowerShell (Windows)
        const { execSync } = require('child_process');
        const cmd = 'powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds | Select-Object Width, Height | ConvertTo-Json"';
        const result = execSync(cmd, { encoding: 'utf8', timeout: 2000 });
        const parsed = JSON.parse(result);
        DEVICE_SCREEN = {
            width: parsed.Width || 1920,
            height: parsed.Height || 1080
        };
        logger.debug(`Detected screen: ${DEVICE_SCREEN.width}x${DEVICE_SCREEN.height}`);
    } catch (error) {
        // Fallback to common resolution
        DEVICE_SCREEN = { width: 1920, height: 1080 };
        logger.debug(`Using default screen: ${DEVICE_SCREEN.width}x${DEVICE_SCREEN.height}`);
    }
    
    return DEVICE_SCREEN;
}

/**
 * Calculate browser dimensions based on device screen
 */
function calculateBrowserDimensions(config, browserNumber = 1) {
    const screen = getDeviceScreenDimensions();
    const MINIMAL_WIDTH = 400;
    const TASKBAR_HEIGHT = 40;
    
    let width = config.windowWidth;
    let height = config.windowHeight;
    let posX = config.windowPositionX;
    
    // Auto-detect: use minimal width and max height
    if (width === 'auto') {
        width = config.useMinimalWidth ? MINIMAL_WIDTH : Math.floor(screen.width / 2);
    }
    
    if (height === 'auto') {
        // Use full screen height minus taskbar
        height = screen.height - TASKBAR_HEIGHT;
    }
    
    // Auto position for browser 2 (next to browser 1)
    if (posX === 'auto' && browserNumber === 2) {
        posX = parseInt(width) + 10; // 10px gap
    }
    
    return {
        width: parseInt(width),
        height: parseInt(height),
        x: parseInt(posX),
        y: parseInt(config.windowPositionY)
    };
}

/**
 * Setup request interception based on browser-config.json
 */
async function setupRequestInterception(page) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        const resourceType = request.resourceType();
        const shouldBlock = (
            (BROWSER_CONFIG.performance.blockImages && resourceType === 'image') ||
            (BROWSER_CONFIG.performance.blockMedia && resourceType === 'media')
        );
        
        if (shouldBlock) {
            request.abort();
        } else {
            request.continue();
        }
    });
}

/**
 * Extract phone numbers from text with international support
 */
function extractPhoneNumbers(text, country = 'IN') {
    // Use the new international phone validator
    const phones = phoneValidator.extractPhoneNumbers(text, country);
    
    // Fallback to old pattern if no phones found
    if (phones.length === 0 && CONFIG.phonePattern) {
        const matches = text.matchAll(CONFIG.phonePattern);
        const seen = new Set();
        
        for (const match of matches) {
            let clean = match[0].replace(/[\s-]/g, '');
            if (clean.startsWith('0')) clean = clean.substring(1);
            if (!seen.has(clean) && clean.length === 10) {
                seen.add(clean);
                phones.push(clean);
            }
        }
    }
    
    return phones;
}

/**
 * Extract ONLY business phone number from specific elements (not entire page)
 */
async function extractBusinessPhone(page) {
    try {
        const phones = await page.evaluate(() => {
            const phoneNumbers = [];
            
            // Method 1: Phone button with aria-label
            const phoneButtons = document.querySelectorAll('button[data-item-id*="phone"], button[aria-label*="Phone"], button[aria-label*="phone"]');
            for (const btn of phoneButtons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const text = btn.textContent || '';
                const combined = ariaLabel + ' ' + text;
                
                // Extract only phone-like patterns
                const phonePattern = /(?:\+?\d{1,4}[\s-]?)?(?:\(?\d{1,4}\)?[\s-]?)?[\d\s-]{8,15}/g;
                const matches = combined.match(phonePattern);
                if (matches) {
                    phoneNumbers.push(...matches);
                }
            }
            
            // Method 2: Specific phone containers
            const phoneContainers = document.querySelectorAll('[data-tooltip*="phone"], [class*="phone"], .rogA2c');
            for (const container of phoneContainers) {
                const text = container.textContent || '';
                const phonePattern = /(?:\+?\d{1,4}[\s-]?)?(?:\(?\d{1,4}\)?[\s-]?)?[\d\s-]{8,15}/g;
                const matches = text.match(phonePattern);
                if (matches) {
                    phoneNumbers.push(...matches);
                }
            }
            
            // Return unique phone numbers (first 3 max)
            const unique = [...new Set(phoneNumbers)];
            return unique.slice(0, 3); // Limit to 3 phone numbers max
        });
        
        // Clean and validate extracted phones
        const cleanedPhones = [];
        const seenPhones = new Set(); // Track duplicates after cleaning
        
        for (const phone of phones) {
            let cleaned = phone.replace(/[^0-9+]/g, '');
            
            // Remove leading 0 from phone numbers (except if it's international format with +)
            if (cleaned.startsWith('0') && !cleaned.startsWith('+')) {
                cleaned = cleaned.substring(1);
            }
            
            // Only accept if length is reasonable (8-15 digits) and not duplicate
            if (cleaned.length >= 8 && cleaned.length <= 15 && !seenPhones.has(cleaned)) {
                cleanedPhones.push(cleaned);
                seenPhones.add(cleaned);
            }
        }
        
        return cleanedPhones;
    } catch (error) {
        return [];
    }
}

/**
 * Extract outlet details (Python's extract_outlet_details)
 */
async function extractOutletDetails(page) {
    return await page.evaluate(() => {
        const details = {};
        
        // Name - Updated selectors for current Google Maps structure
        const nameSelectors = [
            'h1.DUwDvf.lfPIob',
            'h1.DUwDvf',
            'h1[class*="DUwDvf"]',
            'div[role="heading"][aria-level="1"]',
            'h1.fontHeadlineLarge'
        ];
        
        let name = 'Not found';
        for (const selector of nameSelectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent && el.textContent.trim()) {
                name = el.textContent.trim();
                break;
            }
        }
        details.name = name;
        
        // Rating
        let rating = 'Not found';
        const spans = document.querySelectorAll('span[aria-hidden="true"]');
        for (const span of spans) {
            const txt = span.textContent.trim();
            if (/^\d\.\d$/.test(txt)) {
                rating = txt;
                break;
            }
        }
        details.rating = rating;
        
        // Reviews
        const reviewEl = document.querySelector('span[aria-label*="review"]');
        if (reviewEl) {
            const reviewText = reviewEl.getAttribute('aria-label');
            const match = reviewText.match(/([\d,]+)\s*review/i);
            details.reviews = match ? match[1] : 'Not found';
        } else {
            details.reviews = 'Not found';
        }
        
        // Category (with hotel star rating support)
        let category = 'Not found';
        
        // Try regular category button first
        const catEl = document.querySelector('button[jsaction*="category"]');
        if (catEl) {
            category = catEl.textContent.trim();
        }
        
        // If not found, try hotel star rating (e.g., "3-star hotel")
        if (category === 'Not found') {
            const starSelectors = [
                'span:has-text("star hotel")', // CSS4 selector
                'div.LBgpqf span', // Hotel star rating container
                'div.lMbq3e span' // Alternative container
            ];
            
            // Check all spans for star rating pattern
            const allSpans = document.querySelectorAll('span');
            for (const span of allSpans) {
                const text = span.textContent.trim();
                if (text.match(/^\d-star hotel$/i) || text.match(/^\d\.\d-star hotel$/i)) {
                    category = text;
                    break;
                }
            }
        }
        
        details.category = category;
        
        // Address - find div with pincode
        const addressEl = document.querySelector('div.Io6YTe.fontBodyMedium.kR99db.fdkmkc');
        details.address = addressEl ? addressEl.textContent.trim() : 'Not found';
        
        // Website - find URL pattern
        const urlDivs = document.querySelectorAll('div.Io6YTe.fontBodyMedium.kR99db.fdkmkc');
        let website = 'Not found';
        for (const div of urlDivs) {
            const txt = div.textContent.trim();
            if (/^(?:http[s]?:\/\/)?(?:www\.)?[\w.-]+\.[A-Za-z]{2,}$/.test(txt)) {
                website = txt;
                break;
            }
        }
        details.website = website;
        
        return details;
    });
}

/**
 * Smart scroll detection - Updated for 2024 Google Maps
 */
async function findScrollElement(page) {
    let scroll_el = null;
    
    // Wait for page to settle
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
        // Modern CSS selectors (try these first)
        const cssSelectors = [
            'div[role="feed"]',  // Most reliable
            'div.m6QErb',        // Google Maps feed container
            'div.m6QErb[aria-label]',
            '[aria-label*="Results"]',
            'div[tabindex="-1"][role="region"]',
            'div.e07Vkf', // Scrollable list
            '#QA0Szd > div > div > div.w6VYqd > div.bJzME.tTVLSc > div > div.e07Vkf.kA9KIf'  // Full path
        ];
        
        for (const selector of cssSelectors) {
            const element = await page.$(selector);
            if (element) {
                scroll_el = element;
                logger.debug(`Found scroll area: ${selector}`);
                break;
            }
        }
        
        // Fallback: Try XPath selectors (old method)
        if (!scroll_el) {
            const xpathSelectors = [
                CONSTANTS.XPATH_SCROLLER_2,
                CONSTANTS.XPATH_SCROLLER_1,
                '//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[2]',
                '//div[@role="feed"]',
                '//div[contains(@class, "m6QErb")]'
            ];
            
            for (const xpath of xpathSelectors) {
                try {
                    const scrollers = await page.$x(xpath);
                    if (scrollers.length > 0) {
                        scroll_el = scrollers[0];
                        logger.debug(`Found scroll area via XPath`);
                        break;
                    }
                } catch (e) {}
            }
        }
        
    } catch (error) {
        logger.error(`Error finding scroll area:`, { message: error.message });
    }
    
    if (!scroll_el) {
        logger.warn(`Could not find scroll area - Google Maps layout may have changed`);
    }
    
    return scroll_el;
}

/**
 * Streaming link extraction - yields links as found (for parallel pipeline)
 */
async function extractPlaceLinksStreaming(page, keyword, onLinksFound, triggerProgress = null) {
    logger.info(`Searching for "${keyword}"`);
    
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(keyword)}`;
    logger.debug(`Navigating to ${searchUrl}`);
    
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    logger.debug('Page loaded');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const scrollElement = await findScrollElement(page);
    if (!scrollElement) {
        console.log(`❌ Could not find scroll area`);
        return 0;
    }
    
    const seen = new Set();
    let last_scroll_time = Date.now();
    let scrollCount = 0;
    let consecutiveNoNewLinks = 0;
    const maxConsecutiveNoNew = CONFIG.smartScrolling ? 3 : 999;
    
    // Idle timeout from browser-config.json
    const idleTimeout = BROWSER_CONFIG.scrolling.idleTimeout;
    while ((Date.now() - last_scroll_time) / 1000 < idleTimeout && consecutiveNoNewLinks < maxConsecutiveNoNew) {
        scrollCount++;
        try {
            // Smooth scroll for better map loading and more places
            await page.evaluate((el) => {
                el.scrollBy({ top: 5000, behavior: 'smooth' });
            }, scrollElement);
            
            // Random delay from browser-config.json for proper map loading
            const delay = randomDelay(BROWSER_CONFIG.scrolling.scrollDelay.min, BROWSER_CONFIG.scrolling.scrollDelay.max);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            const links = await page.$$eval('a[href*="/maps/place/"]', els => 
                els.map(e => e.href)
                   .filter(href => href.includes('/maps/place/'))
                   .filter(href => !href.includes('about?'))
                   .filter(href => !href.includes('/about'))
                   .filter(href => !href.includes('about:blank'))
                   .filter(href => href.startsWith('http'))
            );
            
            const newLinks = [];
            for (const link of links) {
                if (!seen.has(link)) {
                    seen.add(link);
                    newLinks.push(link);
                }
            }
            
            // Stream new links immediately to workers
            if (newLinks.length > 0) {
                last_scroll_time = Date.now();
                consecutiveNoNewLinks = 0;
                onLinksFound(newLinks); // Stream to workers!
                
                // Emit real-time link count update
                if (triggerProgress) {
                    triggerProgress(keyword, 'extracting_links', Math.min(100, (seen.size / 110) * 100), seen.size);
                }
            } else {
                consecutiveNoNewLinks++;
            }
            
            logger.progress(`Scrolling... ${seen.size} places found (scroll ${scrollCount})`);
            
            // Check for "end of list" message (if enabled in browser-config.json)
            if (BROWSER_CONFIG.scrolling.checkEndOfList) {
                const endOfList = await page.evaluate(() => {
                    const endSpan = document.querySelector('span.HlvSq');
                    return endSpan && endSpan.textContent.includes("You've reached the end of the list");
                });
                
                if (endOfList) {
                    logger.info(`End of list detected!`);
                    break;
                }
            }
        } catch (error) {
            progressManager.logError(error, `Scroll error at ${scrollCount}`);
            // Continue scrolling despite errors
        }
    }
    
    logger.success(`Collected ${seen.size} place links`);
    return seen.size;
}

/**
 * Link extraction with scrolling (SEQUENTIAL MODE)
 * Extracts ALL URLs first, then processes them
 */
async function extractPlaceLinks(browser, page, keyword) {
    logger.info(`Searching: "${keyword}"`);
    
    // Navigate to Google Maps search
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Wait for results
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Find scroll element
    const scrollElement = await findScrollElement(page);
    if (!scrollElement) {
        logger.warn(`Could not find scroll area`);
        return [];
    }
    
    // Track seen links and timing
    const seen = new Set();
    let last_scroll_time = Date.now();
    let scrollCount = 0;
    let consecutiveNoNewLinks = 0;
    
    // Smart scrolling: Stop early if no new links for 3 consecutive scrolls
    const maxConsecutiveNoNew = CONFIG.smartScrolling ? 3 : 999;
    
    // INFINITE LOOP with random delays - breaks when timeout OR smart detection
    // Idle timeout from browser-config.json
    const idleTimeout = BROWSER_CONFIG.scrolling.idleTimeout;
    while ((Date.now() - last_scroll_time) / 1000 < idleTimeout && consecutiveNoNewLinks < maxConsecutiveNoNew) {
        scrollCount++;
        try {
            // Smooth scroll for better map loading and more places
            await page.evaluate((el) => {
                el.scrollBy({ top: 5000, behavior: 'smooth' });
            }, scrollElement);
            
            // Random delay from browser-config.json for proper map loading
            const delay = randomDelay(BROWSER_CONFIG.scrolling.scrollDelay.min, BROWSER_CONFIG.scrolling.scrollDelay.max);
            await new Promise(resolve => setTimeout(resolve, delay));
            
            // Get all current links (skip About pages and blank)
            const links = await page.$$eval('a[href*="/maps/place/"]', els => 
                els.map(e => e.href)
                   .filter(href => href.includes('/maps/place/'))
                   .filter(href => !href.includes('about?'))
                   .filter(href => !href.includes('/about'))
                   .filter(href => !href.includes('about:blank'))
                   .filter(href => href.startsWith('http'))
            );
            
            // Find new links
            const newLinks = [];
            const previousCount = seen.size;
            
            for (const link of links) {
                if (!seen.has(link)) {
                    seen.add(link);
                    newLinks.push(link);
                }
            }
            
            // Track new links (no immediate processing)
            if (newLinks.length > 0) {
                last_scroll_time = Date.now();
                consecutiveNoNewLinks = 0;  // Reset counter
            } else {
                consecutiveNoNewLinks++;  // Increment no-new counter
            }
            
            logger.progress(`Scrolling... ${seen.size} places found (scroll ${scrollCount})`);
            
            // Check for "end of list" message (if enabled in browser-config.json)
            if (BROWSER_CONFIG.scrolling.checkEndOfList) {
                const endOfList = await page.evaluate(() => {
                    const endSpan = document.querySelector('span.HlvSq');
                    return endSpan && endSpan.textContent.includes("You've reached the end of the list");
                });
                
                if (endOfList) {
                    logger.info(`End of list detected!`);
                    break;
                }
            }
            
        } catch (error) {
            logger.debug('Scroll error (continuing)', { error: error.message });
        }
    }
    
    logger.success(`Collected ${seen.size} place links`);
    return Array.from(seen);
}

/**
 * Data scraping worker (Python's data_scraping_worker)
 * Each runs in a separate browser tab
 * Can accept browser or browserContext for isolation
 */
async function scrapePlace(browserOrContext, link, index, total) {
    let page = null;
    
    try {
        page = await browserOrContext.newPage();
        
        // Enable request interception from browser-config.json
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
        // Wait for a key element to ensure the page content is loaded
        await page.waitForSelector('h1.DUwDvf.lfPIob', { timeout: 10000 }); // Wait for the main business name heading
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // 🛡️ Check for CAPTCHA / Bot Detection
        const captchaDetected = await captchaDetector.detectCaptcha(page);
        if (captchaDetected) {
            captchaDetector.showHelp();
            
            if (captchaDetector.shouldStopScraping()) {
                throw new Error('🚨 GOOGLE BOT DETECTION - Scraping stopped automatically. Please wait and retry with lower workers.');
            }
            
            // Skip this place but continue
            return null;
        }
        
        // Check if it's an About page or blank and skip
        const currentUrl = page.url();
        if (currentUrl.includes('/about') || currentUrl.includes('about?') || currentUrl.includes('about:blank') || !currentUrl.includes('maps/place')) {
            await page.close();
            return null;
        }
        
        // Extract details
        const details = await extractOutletDetails(page);
        
        // Extract phone numbers from specific elements only (not entire page)
        const phones = await extractBusinessPhone(page);
        
        // Extract coordinates from URL
        const coordMatch = link.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        const coordinates = coordMatch ? {
            latitude: parseFloat(coordMatch[1]),
            longitude: parseFloat(coordMatch[2])
        } : null;
        
        // Extract plus code
        const plusCodeEl = await page.$('button[data-item-id="oloc"]');
        const plusCode = plusCodeEl ? await page.evaluate(el => el.getAttribute('aria-label'), plusCodeEl) : null;
        
        // Extract opening hours
        const hoursButton = await page.$('button[data-item-id*="hours"]');
        const hours = hoursButton ? await page.evaluate(el => el.getAttribute('aria-label'), hoursButton) : null;
        
        // Extract business status (open/closed)
        const statusEl = await page.$('[class*="fontBodyMedium"][jsaction*="pane.rating"]');
        const businessStatus = statusEl ? await page.evaluate(el => el.textContent, statusEl) : null;
        
        // Extract price level
        const priceEl = await page.$('[aria-label*="Price"]');
        const priceLevel = priceEl ? await page.evaluate(el => el.getAttribute('aria-label'), priceEl) : null;
        
        const result = {
            name: details.name,
            phone: phones.length > 0 ? [...new Set(phones)].join(', ') : 'Not found',
            rating: details.rating,
            reviews: details.reviews,
            category: details.category,
            address: details.address,
            website: details.website,
            coordinates: coordinates,
            plusCode: plusCode ? plusCode.replace('Plus code: ', '') : 'Not found',
            openingHours: hours ? hours.replace(/Hours:\s*/i, '') : 'Not found',
            businessStatus: businessStatus || 'Not found',
            priceLevel: priceLevel || 'Not found',
            link: link
        };
        
    } catch (error) {
        return { error: 'SCRAPE_FAILED', message: error.message };
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (e) {
                // Page already closed
            }
        }
    }
}

/**
 * Data scraping in existing tab (NO NEW TAB - reuses same tab)
 * Processes URL in provided page - no popups!
 */
async function scrapePlaceInTab(page, link, index, total, browser = null, retryCount = 0) {
    try {
        // Navigate to link in SAME tab (no new tab = no popup!)
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 45000 });
        // Wait for a key element to ensure the page content is loaded
        await page.waitForSelector('h1.DUwDvf.lfPIob', { timeout: 10000 }); // Wait for the main business name heading
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // 🛡️ CAPTCHA Detection
        const isCaptcha = await captchaDetector.detect(page);
        if (isCaptcha) {
            // Just throw error - worker will handle restart
            throw new Error('CAPTCHA_BROWSER_RESTART_NEEDED');
        }
        
        // Check if it's an About page or blank and skip
        const currentUrl = page.url();
        if (currentUrl.includes('/about') || currentUrl.includes('about?') || currentUrl.includes('about:blank') || !currentUrl.includes('maps/place')) {
            return { error: 'INVALID_URL' };
        }
        
        // Extract details
        const details = await extractOutletDetails(page);
        
        // Extract phone numbers from specific elements only (not entire page)
        const phones = await extractBusinessPhone(page);
        
        // Extract coordinates from URL
        const coordMatch = link.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
        const coordinates = coordMatch ? {
            latitude: parseFloat(coordMatch[1]),
            longitude: parseFloat(coordMatch[2])
        } : null;
        
        // Extract plus code
        const plusCodeEl = await page.$('button[data-item-id="oloc"]');
        const plusCode = plusCodeEl ? await page.evaluate(el => el.getAttribute('aria-label'), plusCodeEl) : null;
        
        // Extract opening hours with accurate CSS selector (user provided)
        let hours = null;
        let holidayNotice = null;
        
        try {
            // Check for holiday/special hours notice first
            const holidaySelectors = [
                'div.zaf2le.ITx4Ud', // Holiday notice class
                'div[class*="zaf2le"]',
                '[class*="holiday"]'
            ];
            
            for (const selector of holidaySelectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        const notice = await page.evaluate(el => el.textContent, element);
                        if (notice && notice.trim()) {
                            holidayNotice = notice.trim();
                            break;
                        }
                    }
                } catch (e) {}
            }
            
            // Primary: User-provided CSS selector for opening hours (accurate!)
            const hoursSelectors = [
                'span.ZDu9vd', // Most accurate - contains status + hours
                '#QA0Szd > div > div > div.w6VYqd > div.bJzME.tTVLSc > div > div.e07Vkf.kA9KIf > div > div > div:nth-child(11) > div.OqCZI.fontBodyMedium.tekgWe.WVXvdc > div.OMl5r.hH0dDd > div.MkV9 > div.o0Svhf > span.ZDu9vd',
                'div.o0Svhf > span.ZDu9vd', // Simplified with parent
                'div.MkV9 span', // Container div
                'div.OMl5r.hH0dDd span', // Specific div class
                'button[data-item-id*="hours"]', // Button method fallback
                'div.fontBodyMedium.WVXvdc span' // General pattern
            ];
            
            for (const selector of hoursSelectors) {
                try {
                    const element = await page.$(selector);
                    if (element) {
                        const text = await page.evaluate(el => el.textContent, element);
                        if (text && text.trim() && !text.includes('Hours') && !text.includes('aria-label')) {
                            hours = text.trim();
                            break;
                        }
                    }
                } catch (e) {}
            }
            
            // Additional fallback: aria-label extraction
            if (!hours) {
                const hoursButton = await page.$('button[aria-label*="Hours"]');
                if (hoursButton) {
                    hours = await page.evaluate(el => el.getAttribute('aria-label'), hoursButton);
                }
            }
            
            // If still no hours found, check for hotel check-in/check-out times
            if (!hours) {
                try {
                    const checkInSelectors = [
                        'span[style*="font-weight: 400"]:has-text("Check-in")',
                        'div.Io6YTe.fontBodyMedium.kR99db.fdkmkc span'
                    ];
                    
                    let checkInTime = null;
                    let checkOutTime = null;
                    
                    // Search all spans for check-in/check-out
                    const allSpans = await page.$$('span');
                    for (const span of allSpans) {
                        const text = await page.evaluate(el => el.textContent, span);
                        if (text && text.includes('Check-in time:')) {
                            checkInTime = text.trim();
                        }
                        if (text && text.includes('Check-out time:')) {
                            checkOutTime = text.trim();
                        }
                    }
                    
                    // Combine check-in and check-out
                    if (checkInTime && checkOutTime) {
                        hours = `${checkInTime} | ${checkOutTime}`;
                    } else if (checkInTime) {
                        hours = checkInTime;
                    } else if (checkOutTime) {
                        hours = checkOutTime;
                    }
                } catch (e) {}
            }
            
            // Combine hours with holiday notice if present
            if (holidayNotice && hours) {
                hours = `${hours} (${holidayNotice})`;
            } else if (holidayNotice && !hours) {
                hours = holidayNotice;
            }
        } catch (e) {}
        
        // Extract business status (Open/Closed) from the same element
        let businessStatus = null;
        try {
            // Extract from the hours text if it contains status
            if (hours && (hours.includes('Open') || hours.includes('Closed'))) {
                // Parse status from hours text
                if (hours.includes('Open')) {
                    businessStatus = 'Open';
                } else if (hours.includes('Closed')) {
                    businessStatus = 'Closed';
                }
                if (hours.includes('Permanently closed')) {
                    businessStatus = 'Permanently closed';
                } else if (hours.includes('Temporarily closed')) {
                    businessStatus = 'Temporarily closed';
                }
            }
            
            // If not found in hours, try dedicated status selectors
            if (!businessStatus) {
                const statusSelectors = [
                    'span[style*="color: rgba(25,134,57"]', // Green = Open
                    'span[style*="color: rgba(212,49,38"]', // Red = Closed
                    'span.ZDu9vd span:first-child', // First span in hours element
                    '[aria-label*="Open"]',
                    '[aria-label*="Closed"]'
                ];
                
                for (const selector of statusSelectors) {
                    const statusEl = await page.$(selector);
                    if (statusEl) {
                        const text = await page.evaluate(el => el.textContent, statusEl);
                        if (text && (text.includes('Open') || text.includes('Closed'))) {
                            businessStatus = text.trim();
                            break;
                        }
                    }
                }
            }
        } catch (e) {}
        
        // Extract price level
        let priceLevel = null;
        try {
            const priceSelectors = [
                '[aria-label*="Price"]',
                'span[aria-label*="₹"]',
                '[aria-label*="Expensive"]',
                '[aria-label*="Moderate"]'
            ];
            for (const selector of priceSelectors) {
                const priceEl = await page.$(selector);
                if (priceEl) {
                    priceLevel = await page.evaluate(el => el.getAttribute('aria-label'), priceEl);
                    if (priceLevel) break;
                }
            }
        } catch (e) {}
        
        return {
            name: details.name,
            phone: phones.length > 0 ? [...new Set(phones)].join(', ') : 'Not found',
            rating: details.rating,
            reviews: details.reviews,
            category: details.category,
            address: details.address,
            website: details.website,
            coordinates: coordinates,
            plusCode: plusCode ? plusCode.replace('Plus code: ', '') : 'Not found',
            openingHours: hours ? hours.replace(/Hours:\s*/i, '') : 'Not found',
            businessStatus: businessStatus || 'Not found',
            priceLevel: priceLevel || 'Not found',
            link: link
        };
    } catch (error) {
        return { error: 'SCRAPE_FAILED', message: error.message };
    }
}

/**
 * Concurrent link processor - processes links as they arrive
 * No waiting for all links - immediate extraction
 */
class ConcurrentProcessor {
    constructor(browser, maxWorkers) {
        this.browser = browser;
        this.maxWorkers = maxWorkers;
        this.queue = [];
        this.results = [];
        this.activeWorkers = 0;
        this.totalProcessed = 0;
        this.totalLinks = 0;
    }
    
    // Add new links to queue and process immediately
    async addLinks(links) {
        this.queue.push(...links);
        this.totalLinks += links.length;
        this.processQueue();
    }
    
    // Process queue with worker limit
    async processQueue() {
        while (this.queue.length > 0 && this.activeWorkers < this.maxWorkers) {
            const link = this.queue.shift();
            this.activeWorkers++;
            
            // Process link without waiting
            this.processLink(link).then(result => {
                this.activeWorkers--;
                if (result) {
                    this.results.push(result);
                }
                this.totalProcessed++;
                // Show combined progress: scroll + extraction
                const progressMessage = `Extracting: ${this.totalProcessed}/${this.totalLinks} places | Active workers: ${this.activeWorkers}`;
                logger.progress(progressMessage);
                
                // Continue processing
                this.processQueue();
            });
        }
    }
    
    // Process single link
    async processLink(link) {
        try {
            return await scrapePlace(this.browser, link, this.totalProcessed, this.totalLinks);
        } catch (error) {
            return null;
        }
    }
    
    // Wait for all processing to complete
    async waitForCompletion() {
        while (this.activeWorkers > 0 || this.queue.length > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        logger.success(`Complete: ${this.results.length}/${this.totalLinks} places extracted`);
        return this.results;
    }
}

/**
 * Save to JSON - Use temp file, then rename when complete
 * Can be disabled via SAVE_LOCAL_FILES=false in .env
 */
function saveToJSON(data, keyword, outputDir, isComplete = false) {
    // Check if local file saving is disabled
    const saveLocalFiles = process.env.SAVE_LOCAL_FILES !== 'false';
    if (!saveLocalFiles) {
        // Even if not saving, we need to provide a predictable path for other parts of the system
        const sanitized = keyword.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, '_').substring(0, 50);
        const finalFilename = path.join(outputDir, `${sanitized}.json`);
        logger.warn(`Local file saving disabled - data will be handled in-memory or via database only.`);
        return { jsonFile: finalFilename };
    }

    // Create sanitized filename
    const sanitized = keyword.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, '_').substring(0, 50);
    const finalFilename = path.join(outputDir, `${sanitized}.json`);
    const tempFilename = path.join(outputDir, `${sanitized}.temp.json`);

    if (isComplete) {
        // On completion, atomically write the final data to the main .json file
        try {
            atomicWriteJSON(finalFilename, data);
            // Clean up the temp file if it exists
            if (fs.existsSync(tempFilename)) {
                fs.unlinkSync(tempFilename);
            }
            logger.success(`Final results saved to ${finalFilename}`);
        } catch (error) {
            logger.error(`Failed to write final JSON for ${keyword}`, { error });
        }
        return { jsonFile: finalFilename };
    } else {
        // During scraping, only write to the temporary file
        try {
            // This is not atomic, but it's for temporary progress updates
            const jsonData = JSON.stringify(data, null, 2);
            fs.writeFileSync(tempFilename, jsonData, 'utf8');
        } catch (error) {
            logger.error(`Failed to write temporary JSON for ${keyword}`, { error });
        }
        // We return the final filename so the UI knows what to eventually expect
        return { jsonFile: finalFilename };
    }
}

/**
 * Retry wrapper with exponential backoff
 */
async function retryOperation(operation, context, maxAttempts = CONFIG.retryAttempts) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await operation();
        } catch (error) {
            // CAPTCHA errors should NOT be retried - throw immediately
            if (error.message && error.message.includes('CAPTCHA_BROWSER_RESTART_NEEDED')) {
                throw error;
            }
            
            if (attempt === maxAttempts) {
                progressManager.logError(error, context);
                throw error;
            }
            const delay = CONFIG.retryDelay * attempt; // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Main task manager (Python's task_manager)
 */
async function processKeywords(keywords, customWorkers = null, customLinkWorkers = null, callbacks = {}) {
    // Use custom workers from API, fallback to config
    const numWorkersToUse = customWorkers || CONFIG.parallelWorkers;
    const numLinkWorkersToUse = customLinkWorkers || 1; // Default 1 for sequential (backward compatible)
    
    // ✅ CLEAR previous results when starting new scraping
    allResultsData = {};
    logger.info('Cleared previous results data');
    logger.header(`🗺️  GMap Miner - Professional Scraper v2.0 | ${keywords.length} keyword(s) | 🔗 ${numLinkWorkersToUse} link workers | ⚙️ ${numWorkersToUse} data workers`);
    
    // Create output directory
    if (!fs.existsSync(CONFIG.outputDir)) {
        fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    }
    
    // Load previous progress
    const progress = progressManager.loadProgress();
    const completedSet = new Set(progress.completedKeywords || []);
    
    // Store all results to return
    const allResults = {};
    const totalKeywords = keywords.length;
    const reportedKeywords = new Set();

    const triggerKeywordStart = (keyword) => {
        if (!callbacks?.onKeywordStart) return;
        const index = keywords.indexOf(keyword);
        callbacks.onKeywordStart({
            keyword,
            index: index >= 0 ? index + 1 : reportedKeywords.size + 1,
            total: totalKeywords
        });
    };
    
    const triggerProgress = (keyword, phase, progress, linksFound = null, extractedCount = null) => {
        if (!callbacks?.onProgress) return;
        const index = keywords.indexOf(keyword);
        callbacks.onProgress({
            keyword,
            index: index >= 0 ? index : reportedKeywords.size,
            total: totalKeywords,
            phase,
            progress,
            linksFound,  // Total URLs/links found
            extractedCount  // URLs extracted so far
        });
    };

    const triggerKeywordComplete = (keyword, resultsCount, error = null, results = null) => {
        if (reportedKeywords.has(keyword)) {
            return;
        }
        reportedKeywords.add(keyword);
        if (callbacks?.onKeywordComplete) {
            callbacks.onKeywordComplete({
                keyword,
                index: reportedKeywords.size - 1,  // 0-based index (size-1 because we just added it)
                total: totalKeywords,
                resultsCount,
                results: results || null,  // ✅ NEW: Pass actual results data
                error: error ? (error.message || error) : null
            });
        }
    };
    
    let browser = null;
    let dataBrowser = null;
    let workerPages = [];
    let linkWorkerPages = []; // Browser 1 workers for parallel link extraction
    let mainPage = null; // Browser 1 page - reuse across all keywords
    let prefetchedLinks = null; // Store prefetched links for next keyword
    const startTime = Date.now();
    
    // Custom temp directories for guaranteed cleanup
    const browser1TempDir = path.join(os.tmpdir(), `chrome-b1-${Date.now()}`);
    const browser2TempDir = path.join(os.tmpdir(), `chrome-b2-${Date.now()}`);
    const tempDirsToCleanup = [browser1TempDir, browser2TempDir];
    
    try {
    // Launch Browser 1 (Link extraction) first
    const ws = BROWSER_CONFIG.windowSettings;
    browser = await launchChromium({
        devtools: BROWSER_CONFIG.devtools.enabled,
        defaultViewport: null,
        userDataDir: browser1TempDir,
        extraArgs: [
            ws.startMaximized ? '--start-maximized' : '',
            `--window-size=${ws.windowWidth},${ws.windowHeight}`,
            `--window-position=${ws.windowPositionX},${ws.windowPositionY}`,
            '--no-first-run',
            '--no-default-browser-check'
        ]
    });
    
    logger.success(`Browser 1 launched (temp dir: ${browser1TempDir})`);
    logger.info(`Using Chrome: ${await browser.version()}`);
    
    // Close all default pages and create fresh one
    const defaultPages = await browser.pages();
    if (defaultPages.length > 0) {
        mainPage = defaultPages[0]; // Reuse first page
        await setupRequestInterception(mainPage);
        logger.success('Browser 1 main page ready');
        await closeBlankTabsExcept(browser, [mainPage]);
    } else {
        mainPage = await browser.newPage();
        await setupRequestInterception(mainPage);
        logger.success('Browser 1 main page created');
        await closeBlankTabsExcept(browser, [mainPage]);
    }
    
    // ============ START LINK EXTRACTION IMMEDIATELY (PARALLEL WITH BROWSER 2 SETUP) ============
    const firstKeywordLinks = [];
    let firstKeywordLinkCount = 0;
    const remainingKeywords = keywords.filter(kw => !completedSet.has(kw));
    const firstKeyword = remainingKeywords[0];
    
    let linkExtractionPromise = Promise.resolve();
    if (firstKeyword && mainPage) {
        logger.info(`Starting immediate link extraction for "${firstKeyword}"`);
        
        // Start link extraction in background immediately
        linkExtractionPromise = (async () => {
            try {
                mainPage.setDefaultNavigationTimeout(CONSTANTS.DEFAULT_TIMEOUT);
                mainPage.setDefaultTimeout(CONSTANTS.DEFAULT_TIMEOUT);
                
                firstKeywordLinkCount = await extractPlaceLinksStreaming(mainPage, firstKeyword, (newLinks) => {
                    firstKeywordLinks.push(...newLinks);
                }, triggerProgress);
                logger.success(`Browser 1: DONE! Extracted ${firstKeywordLinkCount} links for "${firstKeyword}"`);
            } catch (err) {
                logger.warn(`Browser 1 link extraction error: ${err.message}`);
            }
        })();
    }
    
    // Launch Browser 2 (Data extraction) second - runs in parallel with Browser 1 link extraction
    const b2 = BROWSER_CONFIG.dualBrowserMode.browser2;
    const dims2 = calculateBrowserDimensions(b2, 2);
    const numWorkers = numWorkersToUse;
    
    dataBrowser = await launchChromium({
        devtools: BROWSER_CONFIG.devtools.enabled,
        defaultViewport: null,
        userDataDir: browser2TempDir,
        extraArgs: [
            `--window-size=${dims2.width},${dims2.height}`,
            `--window-position=${dims2.x},${dims2.y}`
        ]
    });

    logger.success(`Browser 2 launched with temp dir: ${browser2TempDir}`);
    
    // Create worker pages (blank for faster setup)
    for (let w = 0; w < numWorkers; w++) {
        let workerPage = null;
        try { workerPage = await dataBrowser.newPage(); } catch (e) { await new Promise(r=>setTimeout(r,300)); workerPage = await dataBrowser.newPage(); }
        try { await workerPage.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 5000 }); } catch (_) {}
        await setupRequestInterception(workerPage);
        workerPages.push(workerPage);
    }
    
    await closeBlankTabsExcept(dataBrowser, workerPages);
    logger.info(`Browser 2 is ready with ${numWorkers} workers.`);
    
    // Process keywords in batches if using parallel link extraction
    const keywordBatchSize = numLinkWorkersToUse;
    
    logger.info('Processing Strategy:');
    if (numLinkWorkersToUse > 1) {
        logger.info(`- Parallel Link Extraction: ${numLinkWorkersToUse} keywords at once`);
        logger.info(`- Parallel Data Scraping: ${numWorkersToUse} places at once`);
        logger.info(`- Total Batches: ${Math.ceil(remainingKeywords.length / keywordBatchSize)}`);
    } else {
        logger.info(`- Sequential Link Extraction: 1 keyword at a time`);
        logger.info(`- Parallel Data Scraping: ${numWorkersToUse} places at once`);
    }
    
    for (let batchStart = 0; batchStart < remainingKeywords.length; batchStart += keywordBatchSize) {
        // 🛑 CHECK CANCELLATION FLAG BEFORE PROCESSING EACH BATCH
        if (callbacks?.shouldCancel && callbacks.shouldCancel()) {
            logger.warn('CANCELLATION DETECTED - Stopping keyword processing...');
            throw new Error('Job cancelled by user');
        }
        
        const keywordBatch = remainingKeywords.slice(batchStart, batchStart + keywordBatchSize);
        const batchNum = Math.floor(batchStart / keywordBatchSize) + 1;
        const totalBatches = Math.ceil(remainingKeywords.length / keywordBatchSize);
        
        logger.separator();
        logger.header(`📦 BATCH ${batchNum}/${totalBatches}: Processing ${keywordBatch.length} keywords in parallel`);
        logger.separator();
        
        const keyword = keywordBatch[0];
        const urlStatuses = new Map();
        const i = keywords.indexOf(keyword);
        const keywordStartTime = Date.now();

        keywordBatch.forEach(kw => triggerKeywordStart(kw));
        
        logger.separator();
        logger.info(`📍 [${i + 1}/${keywords.length}] ${keyword}`);
        logger.separator();
        
        // Browser 1 & 2 already launched - just verify they're connected
        if (!browser || !browser.connected) {
            logger.error("Browser 1 disconnected - this shouldn't happen");
            throw new Error('Browser 1 disconnected unexpectedly');
        }
        
        if (!dataBrowser || !dataBrowser.connected) {
            logger.error("Browser 2 disconnected - this shouldn't happen");
            throw new Error('Browser 2 disconnected unexpectedly');
        }
        
        try {
            // Verify mainPage is available (should be created during browser launch)
            if (!mainPage || mainPage.isClosed()) {
                logger.debug('Creating new Browser 1 tab for link extraction...');
                mainPage = await browser.newPage();
                await setupRequestInterception(mainPage);
                logger.debug('Browser 1 tab created');
            } else if (i > 0) {
                logger.debug(`Reusing Browser 1 tab for keyword ${i + 1}/${keywords.length}`);
            }
            
            // Set configured timeouts
            mainPage.setDefaultNavigationTimeout(CONSTANTS.DEFAULT_TIMEOUT);
            mainPage.setDefaultTimeout(CONSTANTS.DEFAULT_TIMEOUT);
            
            const page = mainPage; // Use the reused page
            
            // Clear page state for new keyword (skip if prefetched since already cleared)
            if (i > 0 && !(prefetchedLinks && prefetchedLinks.keyword === keyword)) {
                try {
                    await clearPageData(page); // Clear page data first
                    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });
                    logger.debug('Page cleared for next keyword');
                } catch (err) {
                    logger.warn('Could not clear page, continuing...');
                }
            } else if (prefetchedLinks && prefetchedLinks.keyword === keyword) {
                logger.debug('Page already cleared during prefetch');
            }
            
            const numWorkers = numWorkersToUse;
            const extractionResults = []; 
            let totalLinks = 0;
            
            // ============ DUAL BROWSER MODE ============
            logger.info(`Dual browser mode: Browser 1 (links) + Browser 2 (${numWorkers} data workers)`);
            
            // Report progress: Starting link extraction (0%) with 0 links initially
            triggerProgress(keyword, 'extracting_links', 0, 0);
            
            // Reset variables for each keyword (IMPORTANT!)
            const linkQueue = [];
            let completed = 0;
            let extractionDone = false;
            
            // ============ MUTEX LOCK FOR THREAD-SAFE QUEUE ACCESS ============
            let queueLock = false;
            const acquireLock = async () => {
                while (queueLock) {
                    await new Promise(resolve => setTimeout(resolve, 10)); // Wait 10ms
                }
                queueLock = true;
            };
            const releaseLock = () => {
                queueLock = false;
            };
            
            // Auto-cleanup control (clean browser every N extracted places)
            let cleanupCounter = 0;
            const CLEANUP_INTERVAL = 20; // Clean browser every 20 extracted places
            
            logger.info(`Link extractor: Browser 1 | Data workers: ${numWorkers} in Browser 2`);
            logger.info(`Staggered start for workers with auto-cleanup every ${CLEANUP_INTERVAL} places.`);
            
            // Browser restart control
            let needsBrowserRestart = false;
            let browserRestartCount = 0;
            const MAX_BROWSER_RESTARTS = 2; // Max 2 restarts per batch
            
            // Worker function for Browser 2 with staggered delays
            const worker = async (workerPage, workerId) => {
                // Initial staggered start: each worker waits (workerId * 500ms)
                const initialDelay = (workerId - 1) * 500;
                await new Promise(resolve => setTimeout(resolve, initialDelay));
                
                while (!extractionDone || linkQueue.length > 0) {
                    // 🛑 CHECK CANCELLATION FLAG
                    if (callbacks?.shouldCancel && callbacks.shouldCancel()) {
                        logger.warn(`Worker ${workerId}: Cancellation detected, exiting...`);
                        return; // Exit worker immediately
                    }
                    
                    // Stop if browser restart needed
                    if (needsBrowserRestart) {
                        return; // Exit worker immediately
                    }
                    
                    if (linkQueue.length > 0) {
                        // Check again before processing
                        if (needsBrowserRestart) {
                            return; // Exit immediately if another worker triggered restart
                        }
                        
                        // ============ THREAD-SAFE QUEUE ACCESS WITH MUTEX ============
                        await acquireLock(); // Acquire lock before accessing queue
                        
                        let linkItem = null;
                        if (linkQueue.length > 0) {
                            linkItem = linkQueue.shift(); // Only ONE worker can do this at a time
                        }
                        
                        releaseLock(); // Release lock immediately after shift
                        
                        // If no link (queue emptied by another worker), skip
                        if (!linkItem) {
                            await new Promise(resolve => setTimeout(resolve, 300));
                            continue;
                        }
                        
                        // Handle both tagged links (objects) and plain links (strings)
                        const link = typeof linkItem === 'object' ? linkItem.url : linkItem;
                        const linkKeyword = typeof linkItem === 'object' ? linkItem.keyword : keyword;
                        
                        try {
                            const result = await retryOperation(
                                () => scrapePlaceInTab(workerPage, link, completed + 1, totalLinks || '?', dataBrowser),
                                `Place extraction: ${link}`
                            );

                            if (result && result.error) {
                                if (result.error === 'INVALID_URL') {
                                    urlStatuses.set(link, { status: 'SKIPPED_INVALID_URL' });
                                } else {
                                    urlStatuses.set(link, { status: 'FAILED', reason: result.message });
                                }
                            } else if (result) {
                                const notFoundCount = Object.values(result).filter(val => val === 'Not found' || val === '(Not found reviews)').length;
                                if (result.name === 'Not found' || !result.name) {
                                    urlStatuses.set(link, { status: 'SKIPPED_NO_NAME' });
                                } else if (notFoundCount > 5) {
                                    urlStatuses.set(link, { status: 'SKIPPED_LOW_QUALITY', missing: notFoundCount });
                                } else {
                                    urlStatuses.set(link, { status: 'SUCCESS' });
                                    extractionResults.push(result);
                                }
                            } else {
                                urlStatuses.set(link, { status: 'FAILED' });
                            }
                        } catch (err) {
                            urlStatuses.set(link, { status: 'FAILED', error: err.message });
                        }
                        completed++;
                        cleanupCounter++;
                        process.stdout.write(`\r   ✨ Progress: ${completed}/${totalLinks || '?'} URLs, ${extractionResults.length} places (queue: ${linkQueue.length}, ${numWorkers} workers)...`);
                        
                        // Update progress with correct counts: completed = URLs processed, extractionResults.length = places extracted
                        const extractionProgress = totalLinks > 0 ? 0.5 + (completed / totalLinks) * 0.5 : 0.5;
                        triggerProgress(keyword, 'extracting_data', extractionProgress, totalLinks, extractionResults.length);
                        
                        // Full browser cleanup every 20 extracted places (across all workers)
                        if (cleanupCounter >= CLEANUP_INTERVAL) {
                            console.log(`\n   🧹 Auto-cleanup triggered (${cleanupCounter} places extracted)...`);
                            cleanupCounter = 0; // Reset counter
                            
                            // Clean Browser 2 (data extraction) - Full clean
                            try {
                                await clearBrowserData(dataBrowser, 'full');
                                console.log(`   ✅ Browser 2 cleaned: Cache + Cookies + Storage cleared`);
                            } catch (err) {
                                console.log(`   ⚠️  Browser 2 cleanup failed: ${err.message}`);
                            }
                            
                            // Clean Browser 1 (link extraction) - Light clean
                            if (browser && browser.connected) {
                                try {
                                    await clearBrowserData(browser, 'light');
                                    console.log(`   ✅ Browser 1 cleaned: Cookies cleared`);
                                } catch (err) {
                                    console.log(`   ⚠️  Browser 1 cleanup failed: ${err.message}`);
                                }
                            }
                            
                            process.stdout.write(`\r   ✨ Progress: ${completed}/${totalLinks || '?'} (queue: ${linkQueue.length}, ${numWorkers} workers)...`);
                        }
                        
                        // Periodic page cleaning (every 20 places per worker)
                        if (completed % 20 === 0) {
                            await clearPageData(workerPage); // Clear page-specific data silently
                        }
                        
                        // Random delay between 500-1000ms for faster processing
                        const delayMs = randomDelay(500, 1000);
                        await new Promise(resolve => setTimeout(resolve, delayMs));
                    } else {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }
            };
            
            // ============ START PREFETCHING NEXT KEYWORD (CONTINUOUS BROWSER 1) ============
            // Start extracting next keyword links IMMEDIATELY in parallel with Browser 2 workers
            let prefetchPromise = Promise.resolve();
            const nextKeywordIndex = i + 1;
            const nextKeyword = keywords[nextKeywordIndex];
            
            if (nextKeyword && page && !page.isClosed() && linkWorkerPages.length === 0) {
                console.log(`   🚀 Browser 1: Starting prefetch for next keyword "${nextKeyword}" (continuous mode)`);
                prefetchPromise = (async () => {
                    try {
                        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s for current keyword to start
                        const links = [];
                        await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 });
                        console.log(`   🔗 Browser 1: Extracting links for "${nextKeyword}" while Browser 2 scrapes...`);
                        const linkCount = await extractPlaceLinksStreaming(page, nextKeyword, (newLinks) => {
                            links.push(...newLinks);
                        }, triggerProgress);
                        prefetchedLinks = { keyword: nextKeyword, links, totalLinks: linkCount };
                        console.log(`   ✅ Browser 1: Prefetched ${linkCount} links for "${nextKeyword}" (ready for instant use!)`);
                    } catch (err) {
                        console.log(`   ⚠️  Prefetch failed: ${err.message}`);
                        prefetchedLinks = null;
                    }
                })();
            }
            
            // Start workers in Browser 2
            const workerPromises = workerPages.map((wp, idx) => worker(wp, idx + 1));
            
            // ============ PARALLEL LINK EXTRACTION (if linkWorkers > 1) ============
            if (linkWorkerPages.length > 0 && keywordBatch.length > 1) {
                console.log(`\n   🔗 Extracting links for ${keywordBatch.length} keywords in PARALLEL...`);
                
                // Extract links for all keywords in batch simultaneously
                const linkExtractionPromises = keywordBatch.map(async (kw, idx) => {
                    const linkWorkerPage = linkWorkerPages[idx % linkWorkerPages.length];
                    const keywordLinks = [];
                    
                    try {
                        // Check if page is still valid
                        if (linkWorkerPage.isClosed()) {
                            console.log(`\n   ⚠️  Link worker page ${idx} is closed, skipping "${kw}"`);
                            return { keyword: kw, links: [], count: 0 };
                        }
                        
                        // Clear page state - no need to goto about:blank, extractPlaceLinksStreaming does it
                        const linkCount = await extractPlaceLinksStreaming(linkWorkerPage, kw, (newLinks) => {
                            keywordLinks.push(...newLinks);
                        }, triggerProgress);
                        return { keyword: kw, links: keywordLinks, count: linkCount };
                    } catch (error) {
                        console.log(`\n   ⚠️  Error extracting links for "${kw}": ${error.message}`);
                        return { keyword: kw, links: [], count: 0 };
                    }
                });
                
                // Wait for all link extractions to complete
                const allKeywordLinks = await Promise.all(linkExtractionPromises);
                
                // Aggregate all links into queue with keyword tagging
                allKeywordLinks.forEach(({ keyword: kw, links, count }) => {
                    console.log(`\n   ✅ "${kw}": ${count} links extracted`);
                    // Tag each link with its keyword for later separation
                    links.forEach(link => {
                        linkQueue.push({ url: link, keyword: kw });
                    });
                    totalLinks += count;
                });
                
                console.log(`\n   📦 BATCH TOTAL: ${totalLinks} links from ${keywordBatch.length} keywords`);
                
            } else {
                // Sequential extraction for single keyword or no link workers
                // Check if this is the first keyword with immediate extraction
                if (i === 0 && keyword === firstKeyword && firstKeywordLinks.length > 0) {
                    // Wait for immediate extraction to complete
                                    await linkExtractionPromise;
                                    totalLinks = firstKeywordLinkCount;
                                    firstKeywordLinks.forEach(link => urlStatuses.set(link, { status: 'PENDING' }));
                                    linkQueue.push(...firstKeywordLinks);                }
                // Check if links were prefetched (OPTION 1 OPTIMIZATION)
                else if (prefetchedLinks && prefetchedLinks.keyword === keyword) {
                    // Use prefetched links instead of extracting again!
                    console.log(`   ⚡ Using prefetched ${prefetchedLinks.totalLinks} links (Browser 1 saved time!)`);
                    linkQueue.push(...prefetchedLinks.links);
                    totalLinks = prefetchedLinks.totalLinks;
                    prefetchedLinks = null; // Clear after use
                } else {
                    // Extract links normally (prefetch failed or other keywords)
                    totalLinks = await extractPlaceLinksStreaming(page, keyword, (newLinks) => {
                        linkQueue.push(...newLinks);
                    }, triggerProgress);
                }
            }
            
            extractionDone = true;
            
            // Report progress: Starting data extraction (50%) with links found
            triggerProgress(keyword, 'extracting_data', 0.5, totalLinks, 0);
            
            // Wait for both Browser 2 workers AND Browser 1 prefetch to complete
            await Promise.all([...workerPromises, prefetchPromise]);
            
            // ============ BROWSER RESTART ON CAPTCHA ============
            if (needsBrowserRestart) {
                console.log(`\n🔄 CAPTCHA RESTART TRIGGERED - Entering restart loop...`);
            }
            
            while (needsBrowserRestart && dataBrowser && browserRestartCount < MAX_BROWSER_RESTARTS) {
                browserRestartCount++;
                console.log(`\n🏠 BROWSER 2 RESTART #${browserRestartCount}/${MAX_BROWSER_RESTARTS}: Closing entire browser...`);
                
                try {
                    await dataBrowser.close();
                    console.log(`   ✅ Browser 2 CLOSED successfully`);
                } catch (err) {
                    console.log(`   ⚠️  Error closing Browser 2: ${err.message}`);
                }
                
                const waitTime = browserRestartCount * 10000; // 10s, 20s, etc.
                console.log(`   ⏱️  Waiting ${waitTime/1000} seconds before restart...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                
                // Relaunch Browser 2
                console.log(`   🔄 Relaunching Browser 2 with ${numWorkers} workers...`);
                const b2 = BROWSER_CONFIG.dualBrowserMode.browser2;
                const dims2 = calculateBrowserDimensions(b2, 2);
                
                dataBrowser = await launchChromium({
                    devtools: BROWSER_CONFIG.devtools.enabled,
                    defaultViewport: null,
                    userDataDir: browser2TempDir,
                    extraArgs: [
                        `--window-size=${dims2.width},${dims2.height}`,
                        `--window-position=${dims2.x},${dims2.y}`
                    ]
                });
                
                if (!BROWSER_CONFIG.visibility.headless) { await closeDefaultPages(dataBrowser); }
                console.log(`   🗑️  Browser 2 relaunched with custom temp directory`);
                
                // Recreate worker pages
                workerPages = [];
                for (let w = 0; w < numWorkers; w++) {
                    const workerPage = await dataBrowser.newPage();
                    await setupRequestInterception(workerPage);
                    workerPages.push(workerPage);
                }
                
                await closeBlankTabsExcept(dataBrowser, workerPages);
                console.log(`   ✅ Browser 2 restarted with ${numWorkers} fresh workers!`);
                
                // Clear all data in fresh browser (cache, cookies, storage)
                console.log(`   🧹 Cleaning fresh browser data...`);
                await clearBrowserData(dataBrowser, 'full');
                
                console.log(`   🔄 Retrying remaining ${linkQueue.length} links...`);
                
                // Reset flags and restart workers for remaining links
                needsBrowserRestart = false;
                extractionDone = false;
                
                // Restart workers
                const retryWorkerPromises = workerPages.map((wp, idx) => worker(wp, idx + 1));
                
                // Wait for workers to process remaining links
                await Promise.all(retryWorkerPromises);
                
                // Set extraction done AFTER workers finish
                extractionDone = true;
            }
            
            // If max restarts exceeded
            if (needsBrowserRestart && browserRestartCount >= MAX_BROWSER_RESTARTS) {
                console.log(`\n⚠️  Max browser restarts (${MAX_BROWSER_RESTARTS}) reached. Skipping remaining ${linkQueue.length} links to avoid CAPTCHA loop.`);
                console.log(`   💡 TIP: Reduce workers (currently ${numWorkers}) or increase delays to avoid CAPTCHAs.`);
            }
            
            // Don't close browsers or tabs - reuse for next keyword
            console.log(`   ♻️  Browser 1 & Browser 2 kept open for next keyword`);
            
            // Results from dual browser mode
            const finalResults = extractionResults;
            console.log(`\n   ✅ Complete: ${finalResults.length}/${totalLinks} places extracted`);
            
            // ============ SAVE RESULTS (batch-aware) ============
            const savePromise = (async () => {
                if (linkWorkerPages.length > 0 && keywordBatch.length > 1) {
                    // Parallel extraction: separate and save results for each keyword
                    for (const kw of keywordBatch) {
                        const keywordResults = finalResults.filter(r => r._keyword === kw);
                        
                        // Remove internal _keyword tag before saving
                        keywordResults.forEach(r => delete r._keyword);
                        
                        // Store results for return
                        allResults[kw] = keywordResults;
                        
                        if (keywordResults.length > 0) {
                            // Final save: write to actual .json file (not .temp)
                            saveToJSON(keywordResults, kw, CONFIG.outputDir, true);
                            console.log(`\n   💾 Saved ${keywordResults.length} places for "${kw}"`);
                        }
                        
                        // Save progress for each keyword
                        completedSet.add(kw);
                        triggerKeywordComplete(kw, keywordResults.length, null, keywordResults);  // ✅ Pass results
                    }
                    
                    progressManager.saveProgress({
                        completedKeywords: Array.from(completedSet),
                        lastUpdated: new Date().toISOString()
                    });
                } else {
                    // Sequential extraction: single keyword
                    allResults[keyword] = finalResults;
                    
                    if (finalResults.length > 0) {
                        // Final save: write to actual .json file (not .temp)
                        saveToJSON(finalResults, keyword, CONFIG.outputDir, true);
                    }
                    
                    // Save progress
                    completedSet.add(keyword);
                    progressManager.saveProgress({
                        completedKeywords: Array.from(completedSet),
                        lastUpdated: new Date().toISOString()
                    });

                    triggerKeywordComplete(keyword, finalResults.length, null, finalResults);  // ✅ Pass results
                }
            })();
            
            // Wait for save to complete
            await savePromise;
            
        } catch (error) {
            logger.error(`Failed to process keyword: ${keyword}`, { error: error.message });
            triggerKeywordComplete(keyword, 0, error);
        } finally {
            const finalUrlStatuses = [];
            for (const [url, status] of urlStatuses.entries()) {
                finalUrlStatuses.push({ url, ...status });
            }
            
            const outputDir = CONFIG.outputDir;
            const sanitizedKeyword = keyword.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, '_').substring(0, 50);
            const urlsFilename = path.join(outputDir, `${sanitizedKeyword}_urls.json`);
            
            try {
                if (finalUrlStatuses.length > 0) {
                    atomicWriteJSON(urlsFilename, finalUrlStatuses);
                    logger.info(`Saved ${finalUrlStatuses.length} URLs with status to ${urlsFilename}`);
                }
            } catch (error) {
                logger.error(`Failed to save URLs with status for ${keyword}`, { error });
            }
        }
        
        // Log progress after each batch
        const completedSoFar = Math.min(batchStart + keywordBatch.length, remainingKeywords.length);
        console.log(`\n📊 Progress: Completed ${completedSoFar}/${remainingKeywords.length} keywords (Batch ${batchNum}/${totalBatches})`);
        
        // Clear browser data after each batch to avoid detection
        if (dataBrowser) {
            console.log('🧹 Cleaning Browser 2 data...');
            await clearBrowserData(dataBrowser, 'full'); // Full clean after each batch
        }
        if (browser) {
            console.log('🧹 Cleaning Browser 1 data...');
            await clearBrowserData(browser, 'light'); // Light clean for Browser 1
        }
        
        if (batchStart + keywordBatch.length < remainingKeywords.length) {
            // Small delay before next batch
            console.log(`⏭️  Moving to next batch in 2 seconds...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    
    } finally {
        // Close all browsers at the end
        if (dataBrowser) {
            try {
                await dataBrowser.close();
                logger.info('Browser 2 (data extraction) closed successfully');
            } catch (err) {
                logger.error('Failed to close Browser 2', { error: err.message });
            }
        }
        
        if (browser) {
            try {
                await browser.close();
                logger.info('Browser 1 (link extraction) closed successfully');
            } catch (err) {
                logger.error('Failed to close Browser 1', { error: err.message });
            }
        }
        
        // ============ MANUALLY DELETE TEMP DIRECTORIES ============
        console.log('\n🗑️  Cleaning up temporary directories...');
        for (const tempDir of tempDirsToCleanup) {
            try {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    console.log(`   ✅ Deleted: ${tempDir}`);
                }
            } catch (err) {
                console.log(`   ⚠️  Failed to delete ${tempDir}: ${err.message}`);
            }
        }
        console.log('   🔒 All browser data permanently deleted!\n');
    }
    
    const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`✨ Completed ${keywords.length} keyword(s) in ${totalTime} min`);
    console.log(`📁 Results: ${CONFIG.outputDir}`);
    console.log(`🛡️  CAPTCHA Detections: ${captchaDetector.getCount()}`);
    
    // Clear progress file on successful completion
    progressManager.clearProgress();
    console.log(`\n✅ All keywords completed successfully!`);
    if (CONFIG.enableErrorLogging && fs.existsSync(progressManager.errorLogFile)) {
        console.log(`⚠️  Check ${progressManager.errorLogFile} for any errors`);
    }
    
    // Return results for API server
    return allResults;
}

// ==============================================================================
// Load keywords from file
// ==============================================================================
function loadKeywordsFromFile(filepath) {
    if (!fs.existsSync(filepath)) {
        console.log(`⚠️  File not found: ${filepath}`);
        return null;
    }
    
    const content = fs.readFileSync(filepath, 'utf-8');
    const keywords = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    return keywords;
}

// ==============================================================================
// Main Entry Point
// ==============================================================================
async function main() {
    // Check for command line argument (keywords file)
    const keywordsFile = process.argv[2] || 'keywords.txt';
    
    let keywords = loadKeywordsFromFile(keywordsFile);
    
    // Fallback to hardcoded keywords if file not found
    if (!keywords) {
        console.log('📝 Using default keywords...');
        keywords = [
            'restaurants in Mumbai',
            'coffee shops in Delhi',
            'hotels in Bangalore'
        ];
    } else {
        console.log(`📂 Loaded ${keywords.length} keywords from ${keywordsFile}`);
    }
    
    try {
        await processKeywords(keywords);
    } catch (error) {
        console.error('\n💥 Fatal Error:', error);
        process.exit(1);
    }
}

// Emergency save functionality (REMOVED)

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = { 
    processKeywords, 
    extractPhoneNumbers, 
    // Export for pipeline mode
    setupRequestInterception,
    extractPlaceLinksStreaming,
    scrapePlaceInTab,
    saveToJSON,
    clearPageData
};












