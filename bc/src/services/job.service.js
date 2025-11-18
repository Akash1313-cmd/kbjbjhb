/**
 * Job Service
 * JSON database job operations
 */

const db = require('../database/json-db');
const logger = require('../utils/logger');
const { jobs } = require('../utils/job-manager');

/**
 * Save a new job to database
 * @param {Object} jobData - Job data to save
 * @param {string} userId - User ID who created the job
 */
async function saveJobToDB(jobData, userId) {
    try {
        const job = {
            jobId: jobData.jobId,
            userId: userId,
            keywords: jobData.keywords,
            status: jobData.status,
            config: jobData.config,
            progress: jobData.progress,
            totalPlaces: jobData.totalPlaces || 0,
            startedAt: jobData.startedAt || new Date().toISOString()
        };
        db.insert('jobs', job);
        logger.info('Job saved to database', { jobId: jobData.jobId });
    } catch (error) {
        logger.error('Failed to save job to database', { error: error.message, jobId: jobData.jobId });
    }
}

/**
 * Update a job in database
 * @param {string} jobId - Job ID to update
 * @param {Object} updates - Update fields
 */
async function updateJobInDB(jobId, updates) {
    try {
        db.update('jobs', { jobId }, updates);
    } catch (error) {
        logger.error('Failed to update job in database', { error: error.message, jobId });
    }
}

/**
 * Load recent jobs from database into memory on startup
 */
async function loadRecentJobsFromDB() {
    try {
        // logger.info('📦 Loading recent jobs from database...'); // Hidden
        
        // Load jobs from last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const allJobs = db.find('jobs', {});
        
        const recentJobs = allJobs
            .filter(job => new Date(job.createdAt) >= new Date(sevenDaysAgo))
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 50);
        
        if (recentJobs.length === 0) {
            // logger.info('📦 No recent jobs found in database'); // Hidden
            return;
        }
        
        // logger.info(`📦 Found ${recentJobs.length} recent jobs in database`); // Hidden
        
        // Load jobs into memory (metadata only - results come from local files)
        for (const jobObj of recentJobs) {
            jobs.set(jobObj.jobId, jobObj);
            
            // ✅ DO NOT load results on startup
            // Results will be loaded from LOCAL FILES when requested via API
            // This ensures local files are the source of truth
            // logger.info(`   ✅ Loaded job metadata: ${jobObj.jobId} (status: ${jobObj.status})`); // Hidden
        }
        
        // logger.info(`✅ Loaded ${recentJobs.length} jobs from database into memory`); // Hidden
    } catch (error) {
        logger.error('Failed to load jobs from database', { error: error.message });
    }
}

module.exports = {
    saveJobToDB,
    updateJobInDB,
    loadRecentJobsFromDB,
    // Keep old names for compatibility
    saveJobToMongoDB: saveJobToDB,
    updateJobInMongoDB: updateJobInDB,
    loadRecentJobsFromMongoDB: loadRecentJobsFromDB
};
