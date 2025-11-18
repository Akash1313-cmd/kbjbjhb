/**
 * Browser configuration utilities
 */

const { BASE_CHROME_ARGS } = require('../config/browser-constants');
const { getDeviceScreenDimensions } = require('../utils/helpers');

/**
 * Calculate browser dimensions based on config
 * @param {Object} config - Window configuration
 * @param {number} browserNumber - Browser instance number (1 or 2)
 * @returns {Object} Dimensions object with width, height, x, y
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
 * Build Chrome arguments array
 * @param {Array} extraArgs - Additional arguments to add
 * @returns {Array} Merged and deduplicated Chrome arguments
 */
function buildChromeArgs(extraArgs = []) {
    const merged = [...BASE_CHROME_ARGS, ...extraArgs.filter(Boolean)];
    return Array.from(new Set(merged));
}

/**
 * Prepare ignore arguments for Puppeteer
 * @param {Array} ignoreArgs - Arguments to ignore
 * @returns {Array} Prepared ignore arguments
 */
function prepareIgnoreArgs(ignoreArgs) {
    const list = Array.isArray(ignoreArgs) ? [...ignoreArgs] : [];
    if (!list.includes('--enable-automation')) {
        list.push('--enable-automation');
    }
    return list;
}

module.exports = {
    calculateBrowserDimensions,
    buildChromeArgs,
    prepareIgnoreArgs
};
