/**
 * Link extraction utilities for Google Maps
 */

const logger = require('../../utils/scraper-logger');
const CONSTANTS = require('../../utils/constants');
const { CONFIG, BROWSER_CONFIG } = require('../config/config-loader');
const { randomDelay } = require('../utils/helpers');
const { progressManager } = require('../utils/progress-manager');

/**
 * Find scrollable element on Google Maps page
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<ElementHandle|null>} Scroll element or null
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
 * @param {Page} page - Puppeteer page instance
 * @param {string} keyword - Search keyword
 * @param {Function} onLinksFound - Callback for when new links are found
 * @param {Function} triggerProgress - Progress callback
 * @returns {Promise<number>} Total number of links found
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
 * @param {Browser} browser - Puppeteer browser instance
 * @param {Page} page - Puppeteer page instance
 * @param {string} keyword - Search keyword
 * @returns {Promise<Array<string>>} Array of place links
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

module.exports = {
    findScrollElement,
    extractPlaceLinksStreaming,
    extractPlaceLinks
};
