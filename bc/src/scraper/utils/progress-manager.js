/**
 * Progress Manager - Track scraping progress and errors
 */

const fs = require('fs');
const logger = require('../../utils/scraper-logger');
const { CONFIG } = require('../config/config-loader');
const { atomicWriteJSON } = require('./file-operations');

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

// Singleton instance
const progressManager = new ProgressManager();

module.exports = {
    ProgressManager,
    progressManager
};
