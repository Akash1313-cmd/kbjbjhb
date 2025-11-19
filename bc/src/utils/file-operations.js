/**
 * File Operations Utilities
 * Simplified file operations
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Write JSON data to a file asynchronously
 * @param {string} filePath - Target file path
 * @param {any} data - Data to write (will be JSON stringified)
 */
async function atomicWriteJSON(filePath, data) {
    const tmpPath = `${filePath}.${Date.now()}.tmp`;
    try {
        const jsonString = JSON.stringify(data, null, 2);
        
        // Use async operations
        await fs.promises.writeFile(tmpPath, jsonString, 'utf8');
        
        // Atomic rename
        await fs.promises.rename(tmpPath, filePath);
        
        return true;
    } catch (err) {
        // Cleanup
        try {
            await fs.promises.unlink(tmpPath);
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
async function cleanupOldTempFiles() {
    try {
        const resultsDir = path.join(__dirname, '../../results');
        
        // Check if directory exists
        try {
            await fs.promises.access(resultsDir);
        } catch {
            return; // Directory doesn't exist
        }
        
        const files = await fs.promises.readdir(resultsDir);
        const now = Date.now();
        let cleaned = 0;
        
        for (const file of files) {
            if (file.endsWith('.tmp')) {
                const filePath = path.join(resultsDir, file);
                try {
                    const stats = await fs.promises.stat(filePath);
                    const fileAge = now - stats.mtimeMs;
                    
                    // Delete files older than 1 hour
                    if (fileAge > 60 * 60 * 1000) {
                        await fs.promises.unlink(filePath);
                        cleaned++;
                    }
                } catch (err) {
                    // Ignore errors for individual files
                }
            }
        }
        
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
