/**
 * Business details extraction utilities
 */

/**
 * Extract business details from Google Maps page
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<Object>} Business details object
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

module.exports = {
    extractOutletDetails
};
