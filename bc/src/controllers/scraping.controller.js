/**
 * Scraping Controller
 * Handles all scraping-related API endpoints
 */

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const { validateScrapeRequest, sanitizeConfig, sanitizeKeywords } = require('../utils/validation');
const { jobs } = require('../utils/job-manager');
const { saveJobToMongoDB } = require('../services/job.service');
const { startScrapingJob } = require('../services/scraper.service');

// Stats object (will be shared from api-server.js)
let stats = { totalJobs: 0, totalKeywords: 0, activeJobs: 0 };
let config = {};
let io = null;
let triggerWebhooks = null;

/**
 * Initialize controller with dependencies
 */
function initScrapingController(appConfig, socketIO, webhookFn, statsObj) {
    config = appConfig;
    io = socketIO;
    triggerWebhooks = webhookFn;
    stats = statsObj;
}

/**
 * POST /api/scrape - Start multi-keyword scraping
 */
async function startScraping(req, res) {
    // Debug log
    if (!req.body || Object.keys(req.body).length === 0) {
        return res.status(400).json({ 
            error: 'Empty request body', 
            message: 'Please send JSON body with keywords array',
            example: { keywords: ["restaurants in Mumbai"] }
        });
    }
    
    let { keywords, config: jobConfig, workers, linkWorkers } = req.body;
    
    // Validate request
    const errors = validateScrapeRequest(req.body);
    if (errors.length > 0) {
        return res.status(400).json({ error: 'Validation failed', details: errors });
    }
    
    // Sanitize keywords to prevent injection attacks
    try {
        keywords = sanitizeKeywords(keywords);
    } catch (error) {
        return res.status(400).json({ error: 'Invalid keywords', message: error.message });
    }
    
    // Enforce limits using environment variables (with fallback defaults)
    const maxLinkWorkers = parseInt(process.env.MAX_LINK_WORKERS) || 1;
    const maxDataWorkers = parseInt(process.env.MAX_DATA_WORKERS) || 1;
    
    const enforcedLinkWorkers = Math.min(linkWorkers || 1, maxLinkWorkers);
    const enforcedWorkers = Math.min(workers || 1, maxDataWorkers);
    
    // Merge workers and linkWorkers into jobConfig
    const finalJobConfig = { 
        ...(jobConfig || {}), 
        workers: enforcedWorkers,           // Browser 2 workers (data scraping) - max from env
        linkWorkers: enforcedLinkWorkers    // Browser 1 workers (link extraction) - max from env
    };
    
    const jobId = `job_${uuidv4()}`;
    const job = {
        jobId,
        userId: req.user._id, // Store user ID for MongoDB
        keywords,
        status: 'queued',
        config: { ...config, ...(jobConfig ? sanitizeConfig(jobConfig) : {}), workers: enforcedWorkers, linkWorkers: enforcedLinkWorkers },
        createdAt: new Date().toISOString(),
        progress: {
            current: 0,
            keywordsCompleted: 0,
            total: keywords.length,
            totalKeywords: keywords.length,
            percentage: 0,
            placesScraped: 0
        }
    };
    
    jobs.set(jobId, job);
    stats.totalJobs++;
    stats.totalKeywords += keywords.length;
    
    // Save job to MongoDB with error handling
    saveJobToMongoDB(job, req.user._id).catch(err => {
        logger.error('Failed to save job to MongoDB', { jobId, error: err.message });
        // Continue anyway since job is in memory
    });
    
    logger.info('New scraping job created', { jobId, keywordsCount: keywords.length, workers: enforcedWorkers, linkWorkers: enforcedLinkWorkers });
    
    // Start scraping in background
    startScrapingJob(jobId, keywords, finalJobConfig, config, io, triggerWebhooks);
    
    res.json({
        status: 'success',
        jobId,
        message: 'Scraping started',
        estimatedTime: `${keywords.length * 4} minutes`,
        totalKeywords: keywords.length
    });
}

/**
 * POST /api/scrape/single - Scrape single keyword
 */
async function startSingleScraping(req, res) {
    const { keyword, workers = 5 } = req.body;
    
    if (!keyword) {
        return res.status(400).json({ error: 'Keyword required' });
    }
    
    const jobId = `job_${uuidv4()}`;
    const job = {
        jobId,
        userId: req.user._id, // Store user ID for MongoDB
        keywords: [keyword],
        status: 'queued',
        config: { ...config, workers },
        createdAt: new Date().toISOString(),
        progress: {
            current: 0,
            keywordsCompleted: 0,
            total: 1,
            totalKeywords: 1,
            percentage: 0,
            placesScraped: 0
        }
    };
    
    jobs.set(jobId, job);
    stats.totalJobs++;
    stats.totalKeywords++;
    
    // Save job to MongoDB with error handling
    saveJobToMongoDB(job, req.user._id).catch(err => {
        logger.error('Failed to save job to MongoDB', { jobId, error: err.message });
        // Continue anyway since job is in memory
    });
    
    startScrapingJob(jobId, [keyword], { workers }, config, io, triggerWebhooks);
    
    res.json({
        status: 'success',
        jobId,
        keyword,
        estimatedTime: '4 minutes'
    });
}

/**
 * POST /api/scrape/bulk - Upload file with keywords
 */
async function startBulkScraping(req, res) {
    // In production, use multer for file upload
    const { fileContent, workers = 5, format = 'json' } = req.body;
    
    if (!fileContent) {
        return res.status(400).json({ error: 'File content required' });
    }
    
    const keywords = fileContent.split('\n').map(k => k.trim()).filter(k => k);
    
    const jobId = `job_bulk_${uuidv4()}`;
    const job = {
        jobId,
        userId: req.user._id, // Store user ID for MongoDB
        keywords,
        status: 'queued',
        config: { ...config, workers, outputFormat: format },
        createdAt: new Date().toISOString(),
        progress: {
            current: 0,
            keywordsCompleted: 0,
            total: keywords.length,
            totalKeywords: keywords.length,
            percentage: 0,
            placesScraped: 0
        }
    };
    
    jobs.set(jobId, job);
    stats.totalJobs++;
    stats.totalKeywords += keywords.length;
    
    // Save job to MongoDB with error handling
    saveJobToMongoDB(job, req.user._id).catch(err => {
        logger.error('Failed to save job to MongoDB', { jobId, error: err.message });
        // Continue anyway since job is in memory
    });
    
    startScrapingJob(jobId, keywords, { workers, format }, config, io, triggerWebhooks);
    
    res.json({
        status: 'success',
        jobId,
        keywordsCount: keywords.length,
        estimatedTime: `${(keywords.length * 4 / 60).toFixed(1)} hours`
    });
}

module.exports = {
    initScrapingController,
    startScraping,
    startSingleScraping,
    startBulkScraping
};
