/**
 * Database Service
 * Database operations for places and other entities
 */

const db = require('../database/json-db');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

/**
 * Save places to database
 * @param {string} jobId - Job ID
 * @param {string} userId - User ID
 * @param {string} keyword - Keyword
 * @param {Array} places - Array of place objects
 */
async function savePlacesToDB(jobId, userId, keyword, places) {
    try {
        for (const place of places) {
            // Check for duplicate using googleMapsLink
            const existing = db.findOne('places', { googleMapsLink: place.googleMapsLink });
            if (!existing) {
                db.insert('places', {
                    jobId,
                    userId,
                    keyword,
                    ...place
                });
            }
        }
        logger.info('Places saved to database', { jobId, keyword, count: places.length });
    } catch (error) {
        logger.error('Failed to save places to database', { error: error.message, jobId, keyword });
    }
}

/**
 * Count total places from local JSON files
 * @param {string} jobId - Job ID
 * @returns {number} Total count of places
 */
async function countPlacesFromLocalFiles(jobId) {
    try {
        const resultsDir = path.join(__dirname, '../../results');
        const jobFilePath = path.join(resultsDir, `${jobId}.json`);
        
        if (!fs.existsSync(jobFilePath)) {
            return 0;
        }
        
        const data = JSON.parse(fs.readFileSync(jobFilePath, 'utf8'));
        let totalPlaces = 0;
        
        for (const keyword in data) {
            if (Array.isArray(data[keyword])) {
                totalPlaces += data[keyword].length;
            }
        }
        
        return totalPlaces;
    } catch (error) {
        logger.error('Error counting places from local files', { error: error.message, jobId });
        return 0;
    }
}

module.exports = {
    savePlacesToDB,
    countPlacesFromLocalFiles,
    // Keep old names for compatibility
    savePlacesToMongoDB: savePlacesToDB
};
