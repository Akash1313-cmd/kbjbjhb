/**
 * File operations utilities
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

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
 * Save scraped data to JSON file asynchronously
 * @param {Array} data - Data to save
 * @param {string} keyword - Keyword being scraped
 * @param {string} outputDir - Output directory path
 * @param {boolean} isComplete - Whether scraping is complete
 * @returns {Object} Object with jsonFile path
 */
async function saveToJSON(data, keyword, outputDir, isComplete = false) {
    // Check if local file saving is disabled
    const saveLocalFiles = process.env.SAVE_LOCAL_FILES !== 'false';
    if (!saveLocalFiles) {
        // Even if not saving, we need to provide a predictable path for other parts of the system
        const sanitized = keyword.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, '_').substring(0, 50);
        const finalFilename = path.join(outputDir, `${sanitized}.json`);
        logger.warn(`Local file saving disabled - data will be handled in-memory or via database only.`);
        return { jsonFile: finalFilename };
    }

    // Create sanitized filename
    const sanitized = keyword.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, '_').substring(0, 50);
    const finalFilename = path.join(outputDir, `${sanitized}.json`);

    try {
        await fs.promises.writeFile(finalFilename, JSON.stringify(data, null, 2), 'utf8');
        if (isComplete) {
            logger.success(`Final results saved to ${finalFilename}`);
        }
    } catch (error) {
        logger.error(`Failed to write JSON for ${keyword}`, { error });
    }
    return { jsonFile: finalFilename };
}

/**
 * Load keywords from a text file
 * @param {string} filepath - Path to file containing keywords (one per line)
 * @returns {Array<string>} Array of keywords
 */
function loadKeywordsFromFile(filepath) {
    if (!fs.existsSync(filepath)) {
        throw new Error(`File not found: ${filepath}`);
    }
    
    const content = fs.readFileSync(filepath, 'utf-8');
    const keywords = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    return keywords;
}

module.exports = {
    atomicWriteJSON,
    saveToJSON,
    loadKeywordsFromFile
};
