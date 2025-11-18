/**
 * Browser data cleaning utilities
 */

const logger = require('../../utils/logger');

/**
 * Clear browser data (cache, cookies, storage)
 * @param {Browser} browser - Puppeteer browser instance
 * @param {string} mode - Cleaning mode: 'full' or 'light'
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
 * @param {Page} page - Puppeteer page instance
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
 * @param {Browser} browser - Puppeteer browser instance
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
 * @param {Browser} browser - Puppeteer browser instance
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
        console.log(`   Failed to close default pages: ${error.message}`);
    }
}

/**
 * Close all about:blank tabs except provided keepPages (if any).
 * If there are only blank tabs and keepPages is empty, keeps one alive.
 * @param {Browser} browser - Puppeteer browser instance
 * @param {Array} keepPages - Pages to keep open
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

module.exports = {
    clearBrowserData,
    clearPageData,
    clearEverything,
    closeDefaultPages,
    closeBlankTabsExcept
};
