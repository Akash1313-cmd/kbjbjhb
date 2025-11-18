/**
 * Job Service
 * MongoDB job operations
 */

const Job = require('../models/Job');
const logger = require('../utils/logger');
const { jobs } = require('../utils/job-manager');

/**
 * Save a new job to MongoDB
 * @param {Object} jobData - Job data to save
 * @param {string} userId - User ID who created the job
 */
async function saveJobToMongoDB(jobData, userId) {
    try {
        const job = new Job({
            jobId: jobData.jobId,
            userId: userId,
            keywords: jobData.keywords,
            status: jobData.status,
            config: jobData.config,
            progress: jobData.progress,
            totalPlaces: jobData.totalPlaces || 0,
            startedAt: jobData.startedAt || new Date()
        });
        await job.save();
        logger.info('Job saved to MongoDB', { jobId: jobData.jobId });
    } catch (error) {
        logger.error('Failed to save job to MongoDB', { error: error.message, jobId: jobData.jobId });
    }
}

/**
 * Update a job in MongoDB
 * @param {string} jobId - Job ID to update
 * @param {Object} updates - Update fields
 */
async function updateJobInMongoDB(jobId, updates) {
    try {
        await Job.findOneAndUpdate({ jobId }, updates);
    } catch (error) {
        logger.error('Failed to update job in MongoDB', { error: error.message, jobId });
    }
}

/**
 * Load recent jobs from MongoDB into memory on startup
 */
async function loadRecentJobsFromMongoDB() {
    try {
        // logger.info('📦 Loading recent jobs from MongoDB...'); // Hidden
        
        // Load jobs from last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const recentJobs = await Job.find({
            createdAt: { $gte: sevenDaysAgo }
        })
        .sort({ createdAt: -1 })
        .limit(50);
        
        if (recentJobs.length === 0) {
            // logger.info('📦 No recent jobs found in MongoDB'); // Hidden
            return;
        }
        
        // logger.info(`📦 Found ${recentJobs.length} recent jobs in MongoDB`); // Hidden
        
        // Load jobs into memory (metadata only - results come from local files)
        for (const dbJob of recentJobs) {
            const jobObj = dbJob.toObject();
            jobs.set(jobObj.jobId, jobObj);
            
            // ✅ DO NOT load results from MongoDB on startup
            // Results will be loaded from LOCAL FILES when requested via API
            // This ensures local files are the source of truth
            // logger.info(`   ✅ Loaded job metadata: ${jobObj.jobId} (status: ${jobObj.status})`); // Hidden
        }
        
        // logger.info(`✅ Loaded ${recentJobs.length} jobs from MongoDB into memory`); // Hidden
    } catch (error) {
        logger.error('Failed to load jobs from MongoDB', { error: error.message });
    }
}

module.exports = {
    saveJobToMongoDB,
    updateJobInMongoDB,
    loadRecentJobsFromMongoDB
};
