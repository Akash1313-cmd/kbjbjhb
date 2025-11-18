/**
 * Advanced Job Queue Manager for handling 500+ keywords
 * Implements batching, prioritization, and distributed processing
 */

const EventEmitter = require('events');
const logger = require('./logger');
const redisCache = require('./redis-cache');

class JobQueueManager extends EventEmitter {
    constructor() {
        super();
        this.queues = {
            high: [],       // High priority jobs
            normal: [],     // Normal priority jobs
            low: []         // Low priority jobs
        };
        this.processing = new Map();  // Currently processing jobs
        this.completed = new Map();   // Recently completed jobs (LRU cache)
        this.maxConcurrentJobs = 5;   // Max concurrent scraping jobs
        this.maxCompletedCache = 100; // Max completed jobs in memory
        this.batchSize = 50;          // Keywords per batch for 500+ keyword jobs
    }

    /**
     * Split large job into smaller batches
     * @param {Object} job - Job with potentially 500+ keywords
     * @returns {Array} Array of batch jobs
     */
    createBatches(job) {
        const { keywords, jobId, userId, config } = job;
        
        if (keywords.length <= this.batchSize) {
            return [job];  // No batching needed
        }

        const batches = [];
        const totalBatches = Math.ceil(keywords.length / this.batchSize);
        
        for (let i = 0; i < totalBatches; i++) {
            const start = i * this.batchSize;
            const end = Math.min(start + this.batchSize, keywords.length);
            const batchKeywords = keywords.slice(start, end);
            
            const batchJob = {
                ...job,
                jobId: `${jobId}_batch_${i + 1}`,
                parentJobId: jobId,
                batchNumber: i + 1,
                totalBatches,
                keywords: batchKeywords,
                config: {
                    ...config,
                    // Reduce workers for large batches to avoid detection
                    workers: Math.min(config.workers || 5, 5),
                    linkWorkers: 1,
                    // Add delay between batches
                    batchDelay: (i + 1) * 60000  // 1 minute delay per batch
                }
            };
            
            batches.push(batchJob);
        }

        logger.info(`Job ${jobId} split into ${totalBatches} batches of ${this.batchSize} keywords`);
        return batches;
    }

    /**
     * Add job to queue with priority and batching
     * @param {Object} job - Job to add
     * @param {String} priority - 'high', 'normal', or 'low'
     * @returns {Boolean} Success status
     */
    async addJob(job, priority = 'normal') {
        try {
            // Check if job needs batching (500+ keywords)
            if (job.keywords && job.keywords.length > 100) {
                const batches = this.createBatches(job);
                
                // Create parent job record
                const parentJob = {
                    ...job,
                    status: 'batched',
                    batches: batches.map(b => b.jobId),
                    totalBatches: batches.length,
                    completedBatches: 0
                };
                
                // Save parent job to Redis
                await redisCache.setJob(job.jobId, parentJob);
                
                // Add each batch to queue
                for (const batch of batches) {
                    this.queues[priority].push(batch);
                    await redisCache.setJob(batch.jobId, {
                        ...batch,
                        status: 'queued',
                        priority
                    });
                }
                
                this.emit('job_batched', {
                    jobId: job.jobId,
                    batches: batches.length,
                    totalKeywords: job.keywords.length
                });
                
                logger.info(`Added ${batches.length} batch jobs for ${job.jobId}`);
            } else {
                // Regular job, no batching needed
                this.queues[priority].push(job);
                await redisCache.setJob(job.jobId, {
                    ...job,
                    status: 'queued',
                    priority
                });
                
                logger.info(`Added job ${job.jobId} to ${priority} priority queue`);
            }
            
            // Start processing if not at capacity
            this.processNext();
            return true;
        } catch (error) {
            logger.error('Failed to add job to queue', { jobId: job.jobId, error: error.message });
            return false;
        }
    }

    /**
     * Get next job from queue based on priority
     * @returns {Object|null} Next job or null
     */
    getNextJob() {
        // Check priority queues in order
        for (const priority of ['high', 'normal', 'low']) {
            if (this.queues[priority].length > 0) {
                return this.queues[priority].shift();
            }
        }
        return null;
    }

    /**
     * Process next job in queue
     */
    async processNext() {
        // Check if at capacity
        if (this.processing.size >= this.maxConcurrentJobs) {
            logger.info(`At max capacity (${this.maxConcurrentJobs} jobs), waiting...`);
            return;
        }

        const job = this.getNextJob();
        if (!job) {
            logger.debug('No jobs in queue');
            return;
        }

        // Apply batch delay if needed
        if (job.config?.batchDelay) {
            logger.info(`Batch ${job.batchNumber}: Waiting ${job.config.batchDelay / 1000}s before start`);
            await new Promise(resolve => setTimeout(resolve, job.config.batchDelay));
        }

        // Mark as processing
        this.processing.set(job.jobId, job);
        await redisCache.setJob(job.jobId, {
            ...job,
            status: 'processing',
            startedAt: new Date().toISOString()
        });

        this.emit('job_started', {
            jobId: job.jobId,
            keywords: job.keywords.length,
            batchNumber: job.batchNumber,
            totalBatches: job.totalBatches
        });

        logger.info(`Processing job ${job.jobId} with ${job.keywords.length} keywords`);

        // Process the job (this would call the actual scraper)
        try {
            await this.executeJob(job);
        } catch (error) {
            logger.error('Job execution failed', { jobId: job.jobId, error: error.message });
            await this.handleJobError(job, error);
        }
    }

    /**
     * Execute the actual scraping job
     * @param {Object} job - Job to execute
     */
    async executeJob(job) {
        // This would integrate with the existing scraper
        const { processKeywords } = require('../scraper-pro');
        
        try {
            const results = await processKeywords(
                job.keywords,
                job.config?.workers || 5,
                job.config?.linkWorkers || 1,
                {
                    onKeywordComplete: async ({ keyword, results: keywordResults }) => {
                        // Save results immediately to Redis
                        await redisCache.setResults(job.jobId, {
                            [keyword]: keywordResults
                        });
                        
                        // Emit progress
                        this.emit('keyword_completed', {
                            jobId: job.jobId,
                            keyword,
                            results: keywordResults.length
                        });
                    },
                    onProgress: (progress) => {
                        this.emit('job_progress', {
                            jobId: job.jobId,
                            ...progress
                        });
                    }
                }
            );

            await this.handleJobComplete(job, results);
        } catch (error) {
            await this.handleJobError(job, error);
        }
    }

    /**
     * Handle job completion
     * @param {Object} job - Completed job
     * @param {Object} results - Job results
     */
    async handleJobComplete(job, results) {
        // Remove from processing
        this.processing.delete(job.jobId);

        // Update job status
        await redisCache.setJob(job.jobId, {
            ...job,
            status: 'completed',
            completedAt: new Date().toISOString(),
            totalPlaces: Object.values(results).reduce((sum, r) => sum + r.length, 0)
        });

        // If this is a batch job, update parent
        if (job.parentJobId) {
            await this.updateParentJob(job.parentJobId, job.jobId);
        }

        // Add to completed cache (LRU)
        this.addToCompletedCache(job.jobId, job);

        this.emit('job_completed', {
            jobId: job.jobId,
            keywords: job.keywords.length,
            totalPlaces: Object.values(results).reduce((sum, r) => sum + r.length, 0)
        });

        logger.info(`Job ${job.jobId} completed successfully`);

        // Process next job
        this.processNext();
    }

    /**
     * Handle job error
     * @param {Object} job - Failed job
     * @param {Error} error - Error object
     */
    async handleJobError(job, error) {
        // Remove from processing
        this.processing.delete(job.jobId);

        // Check if should retry
        const retryCount = job.retryCount || 0;
        const maxRetries = job.config?.maxRetries || 3;

        if (retryCount < maxRetries) {
            // Retry with exponential backoff
            const retryDelay = Math.pow(2, retryCount) * 60000; // 1min, 2min, 4min
            
            logger.info(`Retrying job ${job.jobId} in ${retryDelay / 1000}s (attempt ${retryCount + 1}/${maxRetries})`);
            
            setTimeout(() => {
                this.addJob({
                    ...job,
                    retryCount: retryCount + 1
                }, 'high');  // Retry with high priority
            }, retryDelay);
        } else {
            // Mark as failed
            await redisCache.setJob(job.jobId, {
                ...job,
                status: 'failed',
                error: error.message,
                completedAt: new Date().toISOString()
            });

            this.emit('job_failed', {
                jobId: job.jobId,
                error: error.message
            });

            logger.error(`Job ${job.jobId} failed after ${maxRetries} retries`);
        }

        // Process next job
        this.processNext();
    }

    /**
     * Update parent job when batch completes
     * @param {String} parentJobId - Parent job ID
     * @param {String} batchJobId - Completed batch job ID
     */
    async updateParentJob(parentJobId, batchJobId) {
        const parentJob = await redisCache.getJob(parentJobId);
        
        if (parentJob) {
            parentJob.completedBatches = (parentJob.completedBatches || 0) + 1;
            
            if (parentJob.completedBatches === parentJob.totalBatches) {
                parentJob.status = 'completed';
                parentJob.completedAt = new Date().toISOString();
                
                this.emit('parent_job_completed', {
                    jobId: parentJobId,
                    totalBatches: parentJob.totalBatches
                });
                
                logger.info(`Parent job ${parentJobId} completed (all ${parentJob.totalBatches} batches done)`);
            } else {
                parentJob.status = 'processing';
                logger.info(`Parent job ${parentJobId}: ${parentJob.completedBatches}/${parentJob.totalBatches} batches complete`);
            }
            
            await redisCache.setJob(parentJobId, parentJob);
        }
    }

    /**
     * Add job to completed cache with LRU eviction
     * @param {String} jobId - Job ID
     * @param {Object} job - Job data
     */
    addToCompletedCache(jobId, job) {
        // Remove oldest if at capacity
        if (this.completed.size >= this.maxCompletedCache) {
            const firstKey = this.completed.keys().next().value;
            this.completed.delete(firstKey);
        }
        
        this.completed.set(jobId, {
            ...job,
            cachedAt: Date.now()
        });
    }

    /**
     * Cancel a job
     * @param {String} jobId - Job ID to cancel
     * @returns {Boolean} Success status
     */
    async cancelJob(jobId) {
        // Check if processing
        if (this.processing.has(jobId)) {
            const job = this.processing.get(jobId);
            job.cancelled = true;
            
            this.processing.delete(jobId);
            await redisCache.setJob(jobId, {
                ...job,
                status: 'cancelled',
                cancelledAt: new Date().toISOString()
            });
            
            this.emit('job_cancelled', { jobId });
            logger.info(`Job ${jobId} cancelled`);
            
            // Process next job
            this.processNext();
            return true;
        }
        
        // Check if in queue
        for (const priority of ['high', 'normal', 'low']) {
            const index = this.queues[priority].findIndex(j => j.jobId === jobId);
            if (index !== -1) {
                this.queues[priority].splice(index, 1);
                
                await redisCache.setJob(jobId, {
                    status: 'cancelled',
                    cancelledAt: new Date().toISOString()
                });
                
                this.emit('job_cancelled', { jobId });
                logger.info(`Job ${jobId} removed from queue and cancelled`);
                return true;
            }
        }
        
        return false;
    }

    /**
     * Get queue status
     * @returns {Object} Queue statistics
     */
    getQueueStatus() {
        return {
            queued: {
                high: this.queues.high.length,
                normal: this.queues.normal.length,
                low: this.queues.low.length,
                total: this.queues.high.length + this.queues.normal.length + this.queues.low.length
            },
            processing: this.processing.size,
            completed: this.completed.size,
            maxConcurrent: this.maxConcurrentJobs
        };
    }

    /**
     * Clear all queues
     */
    clearQueues() {
        this.queues.high = [];
        this.queues.normal = [];
        this.queues.low = [];
        this.processing.clear();
        this.completed.clear();
        
        logger.info('All queues cleared');
    }
}

// Export singleton instance
module.exports = new JobQueueManager();
