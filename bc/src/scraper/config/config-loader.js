/**
 * Configuration loading utilities - Simplified
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const logger = require('../../utils/logger');
const CONSTANTS = require('../../utils/constants');

/**
 * Load browser configuration from browser-config.json
 * @returns {Object} Browser configuration
 */
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
        const browserConfigPath = path.join(__dirname, '../../../config/browser-config.json');
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
 * Load main configuration from config.json
 * @returns {Object} Main configuration
 */
function loadConfig() {
    const BROWSER_CONFIG = loadBrowserConfig();
    
    const defaultConfig = {
        headless: false,
        scrollTimeout: CONSTANTS.MAX_SCROLL_IDLE_TIME_SECONDS * 1000,
        parallelWorkers: 'auto',
        maxWorkers: CONSTANTS.MAX_WORKERS,
        minWorkers: CONSTANTS.MIN_WORKERS,
        browserRestartInterval: CONSTANTS.BROWSER_RESTART_INTERVAL,
        outputDir: path.join(__dirname, '../../../results'),
        phonePattern: CONSTANTS.PHONE_PATTERN,
        smartScrolling: false,
        retryAttempts: CONSTANTS.DEFAULT_RETRY_ATTEMPTS,
        retryDelay: CONSTANTS.RETRY_BASE_DELAY,
        enableErrorLogging: true,
        enableResume: false
    };

    try {
        const configPath = path.join(__dirname, '../../../config/config.json');
        if (fs.existsSync(configPath)) {
            const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            
            // Handle auto workers
            if (userConfig.parallelWorkers === 'auto') {
                const cpuCount = os.cpus().length;
                userConfig.parallelWorkers = Math.min(userConfig.maxWorkers || 4, Math.max(userConfig.minWorkers || 2, Math.floor(cpuCount / 2)));
            }
            
            // Merge with defaults
            const merged = { ...defaultConfig, ...userConfig };
            merged.parallelWorkers = BROWSER_CONFIG.workers.parallelWorkers || merged.parallelWorkers;
            merged.parallelPipeline = BROWSER_CONFIG.dualBrowserMode.enabled !== undefined ? BROWSER_CONFIG.dualBrowserMode.enabled : merged.parallelPipeline;
            
            return merged;
        }
    } catch (error) {
        logger.warn('Failed to load config, using defaults', { error: error.message });
    }
    
    return defaultConfig;
}

// Singleton instances exported
const BROWSER_CONFIG = loadBrowserConfig();
const CONFIG = loadConfig();

module.exports = {
    loadBrowserConfig,
    loadConfig,
    BROWSER_CONFIG,
    CONFIG
};
