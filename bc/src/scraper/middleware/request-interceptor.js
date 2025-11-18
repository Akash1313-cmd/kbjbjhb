/**
 * Request Interceptor - Block images and media to improve performance
 */

const { BROWSER_CONFIG } = require('../config/config-loader');

/**
 * Setup request interception to block images and media
 * @param {Page} page - Puppeteer page instance
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

module.exports = {
    setupRequestInterception
};
