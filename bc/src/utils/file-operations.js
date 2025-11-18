/**
 * File Operations Utilities
 * Atomic file write and cleanup operations
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Atomically write data to a file to prevent corruption
 * @param {string} filePath - Target file path
 * @param {any} data - Data to write (will be JSON stringified)
 */
function atomicWriteJSON(filePath, data) {
    const tmpPath = `${filePath}.${Date.now()}.tmp`;
    try {
        // Write to temporary file
        const jsonString = JSON.stringify(data, null, 2);
        fs.writeFileSync(tmpPath, jsonString, 'utf8');
        
        // Ensure data is written to disk (important for crash safety)
        const fd = fs.openSync(tmpPath, 'r+');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        
        // Atomically rename temp file to target (this is atomic on all platforms)
        fs.renameSync(tmpPath, filePath);
        
        return true;
    } catch (err) {
        // Clean up temp file if it exists
        try {
            if (fs.existsSync(tmpPath)) {
                fs.unlinkSync(tmpPath);
            }
        } catch (cleanupErr) {
            // Ignore cleanup errors
        }
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
