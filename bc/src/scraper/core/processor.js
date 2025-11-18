/**
 * Main orchestration and concurrent processing
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../../utils/scraper-logger');
const { CONFIG, BROWSER_CONFIG } = require('../config/config-loader');
const { launchChromium } = require('../browser/launcher');
const { clearBrowserData, clearEverything, closeBlankTabsExcept } = require('../browser/cleaner');
const { calculateBrowserDimensions } = require('../browser/config');
const { setupRequestInterception } = require('../middleware/request-interceptor');
const { extractPlaceLinks, extractPlaceLinksStreaming } = require('./link-extractor');
const { scrapePlace, scrapePlaceInTab } = require('./data-scraper');
const { saveToJSON } = require('../utils/file-operations');
const { retryOperation } = require('../utils/helpers');
const { progressManager } = require('../utils/progress-manager');
const { captchaDetector } = require('../utils/captcha-detector');

// Global state for all results (used by API)
let allResultsData = {};

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

module.exports = {
    processKeywords,
    ConcurrentProcessor,
    allResultsData
};
