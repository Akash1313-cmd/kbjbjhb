/**
 * MongoDB Service
 * Database operations for places and other entities
 */

const Place = require('../models/Place');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs');

/**
 * Save places to MongoDB
 * @param {string} jobId - Job ID
 * @param {string} userId - User ID
 * @param {string} keyword - Keyword
 * @param {Array} places - Array of place objects
 */
async function savePlacesToMongoDB(jobId, userId, keyword, places) {
    try {
        const placeDocs = places.map(place => ({
            jobId,
            userId,
            keyword,
            ...place
        }));
        
        // Use insertMany with ordered: false to continue on duplicates
        await Place.insertMany(placeDocs, { ordered: false });
        logger.info('Places saved to MongoDB', { jobId, keyword, count: places.length });
    } catch (error) {
        // Ignore duplicate key errors (E11000)
        if (error.code !== 11000) {
            logger.error('Failed to save places to MongoDB', { error: error.message, jobId, keyword });
        }
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
    savePlacesToMongoDB,
    countPlacesFromLocalFiles
};
