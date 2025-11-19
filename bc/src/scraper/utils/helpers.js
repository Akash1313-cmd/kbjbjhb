/**
 * Helper utilities
 */

const { execSync } = require('child_process');
const logger = require('../../utils/logger');
const { CONFIG } = require('../config/config-loader');

/**
 * Generate random delay in milliseconds
 * @param {number} min - Minimum delay
 * @param {number} max - Maximum delay
 * @returns {number} Random delay in milliseconds
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
 * Retry operation with exponential backoff
 * @param {Function} operation - Async operation to retry
 * @param {string} context - Context description for error logging
 * @param {number} maxAttempts - Maximum retry attempts
 * @returns {Promise} Result of operation
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
                logger.error(`${context}: ${error.message}`, { attempt, maxAttempts });
                throw error;
            }
            const delay = CONFIG.retryDelay * attempt; // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Clear page data (cookies and cache)
 * @param {Page} page - Puppeteer page object
 */
async function clearPageData(page) {
    try {
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');
        await client.send('Network.clearBrowserCache');
    } catch (err) {
        // Silently fail
    }
}

/**
 * Atomic write to JSON file
 * @param {string} filePath - Path to file
 * @param {Object} data - Data to write
 */
function atomicWriteJSON(filePath, data) {
    const fs = require('fs');
    const tempPath = filePath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filePath);
}

module.exports = {
    randomDelay,
    getDeviceScreenDimensions,
    retryOperation,
    clearPageData,
    atomicWriteJSON
};
