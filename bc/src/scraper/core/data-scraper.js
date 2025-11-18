/**
 * Data scraping utilities for individual places
 */

const { extractOutletDetails } = require('../extractors/details-extractor');
const { extractBusinessPhone } = require('../extractors/phone-extractor');
const { captchaDetector } = require('../utils/captcha-detector');

/**
 * Scrape place data (creates new tab)
 * @param {Browser|BrowserContext} browserOrContext - Browser or context instance
 * @param {string} link - Place URL
 * @param {number} index - Current index
 * @param {number} total - Total places
 * @returns {Promise<Object|null>} Scraped data or null
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
        
        return result;
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
 * @param {Page} page - Puppeteer page instance
 * @param {string} link - Place URL
 * @param {number} index - Current index
 * @param {number} total - Total places
 * @param {Browser} browser - Browser instance (optional)
 * @param {number} retryCount - Retry attempt count
 * @returns {Promise<Object>} Scraped data
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

module.exports = {
    scrapePlace,
    scrapePlaceInTab
};
