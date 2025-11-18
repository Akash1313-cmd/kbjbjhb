/**
 * File operations utilities
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

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
 * Save scraped data to JSON file
 * @param {Array} data - Data to save
 * @param {string} keyword - Keyword being scraped
 * @param {string} outputDir - Output directory path
 * @param {boolean} isComplete - Whether scraping is complete
 * @returns {Object} Object with jsonFile path
 */
function saveToJSON(data, keyword, outputDir, isComplete = false) {
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
        fs.writeFileSync(finalFilename, JSON.stringify(data, null, 2), 'utf8');
        if (isComplete) {
            logger.success(`Final results saved to ${finalFilename}`);
        }
    } catch (error) {
        logger.error(`Failed to write JSON for ${keyword}`, { error });
    }
    return { jsonFile: finalFilename };
}
        // During scraping, only write to the temporary file
        try {
            // This is not atomic, but it's for temporary progress updates
            const jsonData = JSON.stringify(data, null, 2);
            fs.writeFileSync(tempFilename, jsonData, 'utf8');
        } catch (error) {
            logger.error(`Failed to write temporary JSON for ${keyword}`, { error });
        }
        // We return the final filename so the UI knows what to eventually expect
        return { jsonFile: finalFilename };
    }
}

/**
 * Load keywords from a text file
 * @param {string} filepath - Path to keywords file
 * @returns {Array<string>|null} Array of keywords or null if file not found
 */
function loadKeywordsFromFile(filepath) {
    if (!fs.existsSync(filepath)) {
        console.log(`⚠️  File not found: ${filepath}`);
        return null;
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
