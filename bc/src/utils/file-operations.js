/**
 * File Operations Utilities
 * Simplified file operations
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Write JSON data to a file
 * @param {string} filePath - Target file path
 * @param {any} data - Data to write (will be JSON stringified)
 */
function atomicWriteJSON(filePath, data) {
    try {
        const jsonString = JSON.stringify(data, null, 2);
        fs.writeFileSync(filePath, jsonString, 'utf8');
        return true;
    } catch (err) {
        throw err;
    }
}

/**
 * Clean up old temporary files in results directory
 * Removes .tmp files older than 1 hour
 */
function cleanupOldTempFiles() {
    try {
        const resultsDir = path.join(__dirname, '../../results');
        if (!fs.existsSync(resultsDir)) return;
        
        const files = fs.readdirSync(resultsDir);
        const now = Date.now();
        let cleaned = 0;
        
        files.forEach(file => {
            if (file.endsWith('.tmp')) {
                const filePath = path.join(resultsDir, file);
                try {
                    const stats = fs.statSync(filePath);
                    const fileAge = now - stats.mtimeMs;
                    
                    // Delete files older than 1 hour
                    if (fileAge > 60 * 60 * 1000) {
                        fs.unlinkSync(filePath);
                        cleaned++;
                    }
                } catch (err) {
                    // Ignore errors for individual files
                }
            }
        });
        
        if (cleaned > 0) {
            logger.info(`Cleaned up ${cleaned} old temporary files`);
        }
    } catch (error) {
        logger.error('Error cleaning up temp files', { error: error.message });
    }
}

module.exports = {
    atomicWriteJSON,
    cleanupOldTempFiles
};
