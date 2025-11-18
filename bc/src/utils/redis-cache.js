/**
 * Redis Cache Manager for GMap Pro Multi
 * Replaces in-memory Maps with Redis for better memory management
 * Supports handling 500+ keywords without memory issues
 */

const redis = require('redis');
const logger = require('./logger');

class RedisCache {
    constructor() {
        this.client = null;
        this.connected = false;
        this.ttl = {
            jobs: 7 * 24 * 60 * 60,      // 7 days for jobs
            results: 3 * 24 * 60 * 60,    // 3 days for results
            activeJobs: 60 * 60,          // 1 hour for active jobs
            tempData: 30 * 60             // 30 minutes for temporary data
        };
    }

    async connect() {
        try {
            // Windows Redis configuration
            const redisConfig = {
                socket: {
                    host: process.env.REDIS_HOST || 'localhost',
                    port: process.env.REDIS_PORT || 6379,
                    reconnectStrategy: (retries) => {
                        if (retries > 10) {
                            logger.error('Redis reconnection failed after 10 attempts');
                            return new Error('Too many reconnection attempts');
                        }
                        return Math.min(retries * 100, 3000);
                    }
                }
            };

            // Add password if configured
            if (process.env.REDIS_PASSWORD) {
                redisConfig.password = process.env.REDIS_PASSWORD;
            }

            this.client = redis.createClient(redisConfig);

            this.client.on('error', (err) => {
                logger.error('Redis Client Error', { error: err.message });
                this.connected = false;
            });

            this.client.on('connect', () => {
                logger.info('Redis Client Connected');
                this.connected = true;
            });

            await this.client.connect();
            
            // Set max memory policy for Redis
            await this.client.configSet('maxmemory', '1gb');
            await this.client.configSet('maxmemory-policy', 'allkeys-lru');
            
            logger.info('Redis cache initialized with 1GB memory limit and LRU eviction');
            return true;
        } catch (error) {
            logger.error('Failed to connect to Redis', { error: error.message });
            return false;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.quit();
            this.connected = false;
            logger.info('Redis disconnected');
        }
    }

    // Job Management with TTL
    async setJob(jobId, jobData) {
        if (!this.connected) return false;
        try {
            const key = `job:${jobId}`;
            await this.client.setEx(key, this.ttl.jobs, JSON.stringify(jobData));
            
            // Add to user's job index
            if (jobData.userId) {
                await this.client.sAdd(`user:${jobData.userId}:jobs`, jobId);
                await this.client.expire(`user:${jobData.userId}:jobs`, this.ttl.jobs);
            }
            
            return true;
        } catch (error) {
            logger.error('Redis setJob failed', { jobId, error: error.message });
            return false;
        }
    }

    async getJob(jobId) {
        if (!this.connected) return null;
        try {
            const data = await this.client.get(`job:${jobId}`);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            logger.error('Redis getJob failed', { jobId, error: error.message });
            return null;
        }
    }

    async deleteJob(jobId) {
        if (!this.connected) return false;
        try {
            // Get job to find userId
            const job = await this.getJob(jobId);
            
            // Delete job
            await this.client.del(`job:${jobId}`);
            
            // Remove from user's job index
            if (job && job.userId) {
                await this.client.sRem(`user:${job.userId}:jobs`, jobId);
            }
            
            // Delete associated results
            await this.deleteResults(jobId);
            
            return true;
        } catch (error) {
            logger.error('Redis deleteJob failed', { jobId, error: error.message });
            return false;
        }
    }

    // Results Management with Streaming
    async setResults(jobId, results) {
        if (!this.connected) return false;
        try {
            const key = `results:${jobId}`;
            
            // For large results, use hash to store by keyword
            if (typeof results === 'object' && !Array.isArray(results)) {
                // Store each keyword's results separately
                for (const [keyword, keywordResults] of Object.entries(results)) {
                    await this.client.hSet(
                        key,
                        keyword,
                        JSON.stringify(keywordResults)
                    );
                }
            } else {
                // Store as single value
                await this.client.setEx(key, this.ttl.results, JSON.stringify(results));
            }
            
            return true;
        } catch (error) {
            logger.error('Redis setResults failed', { jobId, error: error.message });
            return false;
        }
    }

    async getResults(jobId, keyword = null) {
        if (!this.connected) return null;
        try {
            const key = `results:${jobId}`;
            
            if (keyword) {
                // Get specific keyword results
                const data = await this.client.hGet(key, keyword);
                return data ? JSON.parse(data) : null;
            } else {
                // Get all results
                const type = await this.client.type(key);
                
                if (type === 'hash') {
                    const allResults = await this.client.hGetAll(key);
                    const parsed = {};
                    for (const [k, v] of Object.entries(allResults)) {
                        parsed[k] = JSON.parse(v);
                    }
                    return parsed;
                } else if (type === 'string') {
                    const data = await this.client.get(key);
                    return data ? JSON.parse(data) : null;
                }
            }
            
            return null;
        } catch (error) {
            logger.error('Redis getResults failed', { jobId, error: error.message });
            return null;
        }
    }

    async deleteResults(jobId) {
        if (!this.connected) return false;
        try {
            await this.client.del(`results:${jobId}`);
            return true;
        } catch (error) {
            logger.error('Redis deleteResults failed', { jobId, error: error.message });
            return false;
        }
    }

    // Stream results for a keyword (memory efficient)
    async streamResults(jobId, keyword, callback) {
        if (!this.connected) return false;
        try {
            const key = `results:${jobId}`;
            const data = await this.client.hGet(key, keyword);
            
            if (data) {
                const results = JSON.parse(data);
                // Stream results in chunks
                const chunkSize = 10;
                for (let i = 0; i < results.length; i += chunkSize) {
                    const chunk = results.slice(i, i + chunkSize);
                    await callback(chunk);
                }
            }
            
            return true;
        } catch (error) {
            logger.error('Redis streamResults failed', { jobId, keyword, error: error.message });
            return false;
        }
    }

    // Active Jobs Tracking
    async setActiveJob(jobId, jobData) {
        if (!this.connected) return false;
        try {
            const key = `active:${jobId}`;
            await this.client.setEx(key, this.ttl.activeJobs, JSON.stringify(jobData));
            await this.client.sAdd('active:jobs', jobId);
            return true;
        } catch (error) {
            logger.error('Redis setActiveJob failed', { jobId, error: error.message });
            return false;
        }
    }

    async getActiveJobs() {
        if (!this.connected) return [];
        try {
            const jobIds = await this.client.sMembers('active:jobs');
            const jobs = [];
            
            for (const jobId of jobIds) {
                const data = await this.client.get(`active:${jobId}`);
                if (data) {
                    jobs.push(JSON.parse(data));
                } else {
                    // Remove stale reference
                    await this.client.sRem('active:jobs', jobId);
                }
            }
            
            return jobs;
        } catch (error) {
            logger.error('Redis getActiveJobs failed', { error: error.message });
            return [];
        }
    }

    async removeActiveJob(jobId) {
        if (!this.connected) return false;
        try {
            await this.client.del(`active:${jobId}`);
            await this.client.sRem('active:jobs', jobId);
            return true;
        } catch (error) {
            logger.error('Redis removeActiveJob failed', { jobId, error: error.message });
            return false;
        }
    }

    // Batch Operations for 500 keywords
    async batchSetResults(jobId, keywordResults) {
        if (!this.connected) return false;
        try {
            const pipeline = this.client.multi();
            const key = `results:${jobId}`;
            
            for (const [keyword, results] of Object.entries(keywordResults)) {
                pipeline.hSet(key, keyword, JSON.stringify(results));
            }
            
            pipeline.expire(key, this.ttl.results);
            await pipeline.exec();
            
            return true;
        } catch (error) {
            logger.error('Redis batchSetResults failed', { jobId, error: error.message });
            return false;
        }
    }

    // Memory usage monitoring
    async getMemoryUsage() {
        if (!this.connected) return null;
        try {
            const info = await this.client.info('memory');
            const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1];
            const maxMemory = await this.client.configGet('maxmemory');
            
            return {
                used: usedMemory,
                max: maxMemory.maxmemory || '1gb',
                connected: this.connected
            };
        } catch (error) {
            logger.error('Redis getMemoryUsage failed', { error: error.message });
            return null;
        }
    }

    // Clear all data (use with caution)
    async flushAll() {
        if (!this.connected) return false;
        try {
            await this.client.flushAll();
            logger.info('Redis cache flushed');
            return true;
        } catch (error) {
            logger.error('Redis flushAll failed', { error: error.message });
            return false;
        }
    }

    // Cleanup old data
    async cleanup() {
        if (!this.connected) return false;
        try {
            // Redis handles expiration automatically with TTL
            // This method can be used for custom cleanup logic
            
            // Get all keys and check their TTL
            const keys = await this.client.keys('*');
            let cleaned = 0;
            
            for (const key of keys) {
                const ttl = await this.client.ttl(key);
                // Remove keys without TTL (shouldn't happen with our setup)
                if (ttl === -1) {
                    await this.client.del(key);
                    cleaned++;
                }
            }
            
            if (cleaned > 0) {
                logger.info(`Redis cleanup: removed ${cleaned} keys without TTL`);
            }
            
            return true;
        } catch (error) {
            logger.error('Redis cleanup failed', { error: error.message });
            return false;
        }
    }
}

// Export singleton instance
module.exports = new RedisCache();
