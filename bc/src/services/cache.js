/**
 * Cache Service - Redis Implementation
 * For production performance optimization
 */

const redis = require('redis');
const logger = require('../utils/logger');

class CacheService {
    constructor(options = {}) {
        this.client = null;
        this.connected = false;
        this.defaultTTL = options.defaultTTL || 3600; // 1 hour default
        this.prefix = options.prefix || 'gmap:';
        
        this.init();
    }
    
    async init() {
        // Skip Redis initialization if disabled or in Electron app
        if (process.env.DISABLE_REDIS === 'true' || process.env.IS_ELECTRON === 'true') {
            console.log('ℹ️  Redis disabled - Running in local mode');
            this.connected = false;
            return;
        }
        
        try {
            // Create Redis client
            this.client = redis.createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379',
                socket: {
                    connectTimeout: 5000,
                    reconnectStrategy: (retries) => {
                        if (retries > 3) {
                            console.log('⚠️  Redis unavailable - Continuing without cache');
                            return new Error('Max reconnection attempts reached');
                        }
                        return Math.min(retries * 100, 1000);
                    }
                },
                // Connection pool settings
                maxPoolSize: 10,
                minPoolSize: 2
            });
            
            // Error handling
            this.client.on('error', (err) => {
                console.log('⚠️  Redis error:', err.message);
                this.connected = false;
            });
            
            this.client.on('connect', () => {
                console.log('✅ Redis connected');
                this.connected = true;
            });
            
            this.client.on('reconnecting', () => {
                console.log('🔄 Redis reconnecting...');
            });
            
            // Connect with timeout
            const connectPromise = this.client.connect();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Connection timeout')), 5000)
            );
            
            await Promise.race([connectPromise, timeoutPromise]);
            
            // Test connection
            await this.client.ping();
            
            console.log('✅ Redis cache service initialized');
        } catch (error) {
            console.log('ℹ️  Redis not available - Running without cache');
            this.connected = false;
            this.client = null;
        }
    }
    
    // Generate cache key
    generateKey(namespace, id) {
        return `${this.prefix}${namespace}:${id}`;
    }
    
    // Set cache with optional TTL
    async set(key, value, ttl = null) {
        if (!this.connected) return false;
        
        try {
            const fullKey = this.generateKey(...(Array.isArray(key) ? key : [key, '']));
            const serialized = JSON.stringify(value);
            
            const options = {};
            if (ttl || this.defaultTTL) {
                options.EX = ttl || this.defaultTTL;
            }
            
            await this.client.set(fullKey, serialized, options);
            
            logger.debug('Cache set', { key: fullKey, ttl: options.EX });
            return true;
        } catch (error) {
            logger.error('Cache set error', { error: error.message, key });
            return false;
        }
    }
    
    // Get from cache
    async get(key) {
        if (!this.connected) return null;
        
        try {
            const fullKey = this.generateKey(...(Array.isArray(key) ? key : [key, '']));
            const value = await this.client.get(fullKey);
            
            if (value) {
                logger.debug('Cache hit', { key: fullKey });
                return JSON.parse(value);
            }
            
            logger.debug('Cache miss', { key: fullKey });
            return null;
        } catch (error) {
            logger.error('Cache get error', { error: error.message, key });
            return null;
        }
    }
    
    // Delete from cache
    async delete(key) {
        if (!this.connected) return false;
        
        try {
            const fullKey = this.generateKey(...(Array.isArray(key) ? key : [key, '']));
            const result = await this.client.del(fullKey);
            
            logger.debug('Cache delete', { key: fullKey, deleted: result > 0 });
            return result > 0;
        } catch (error) {
            logger.error('Cache delete error', { error: error.message, key });
            return false;
        }
    }
    
    // Clear cache by pattern
    async clearPattern(pattern) {
        if (!this.connected) return 0;
        
        try {
            const keys = await this.client.keys(`${this.prefix}${pattern}`);
            
            if (keys.length > 0) {
                const deleted = await this.client.del(keys);
                logger.info('Cache pattern cleared', { pattern, deletedCount: deleted });
                return deleted;
            }
            
            return 0;
        } catch (error) {
            logger.error('Cache clear pattern error', { error: error.message, pattern });
            return 0;
        }
    }
    
    // Clear all cache
    async clearAll() {
        if (!this.connected) return false;
        
        try {
            await this.client.flushDb();
            logger.warn('All cache cleared');
            return true;
        } catch (error) {
            logger.error('Cache clear all error', { error: error.message });
            return false;
        }
    }
    
    // Cache wrapper for functions
    async cacheable(key, fn, ttl = null) {
        // Try to get from cache first
        const cached = await this.get(key);
        if (cached !== null) {
            return cached;
        }
        
        // Execute function and cache result
        const result = await fn();
        await this.set(key, result, ttl);
        
        return result;
    }
    
    // Increment counter
    async increment(key, amount = 1) {
        if (!this.connected) return null;
        
        try {
            const fullKey = this.generateKey(...(Array.isArray(key) ? key : [key, '']));
            const result = await this.client.incrBy(fullKey, amount);
            
            return result;
        } catch (error) {
            logger.error('Cache increment error', { error: error.message, key });
            return null;
        }
    }
    
    // Decrement counter
    async decrement(key, amount = 1) {
        if (!this.connected) return null;
        
        try {
            const fullKey = this.generateKey(...(Array.isArray(key) ? key : [key, '']));
            const result = await this.client.decrBy(fullKey, amount);
            
            return result;
        } catch (error) {
            logger.error('Cache decrement error', { error: error.message, key });
            return null;
        }
    }
    
    // Set hash field
    async hset(key, field, value, ttl = null) {
        if (!this.connected) return false;
        
        try {
            const fullKey = this.generateKey(...(Array.isArray(key) ? key : [key, '']));
            await this.client.hSet(fullKey, field, JSON.stringify(value));
            
            if (ttl || this.defaultTTL) {
                await this.client.expire(fullKey, ttl || this.defaultTTL);
            }
            
            return true;
        } catch (error) {
            logger.error('Cache hset error', { error: error.message, key, field });
            return false;
        }
    }
    
    // Get hash field
    async hget(key, field) {
        if (!this.connected) return null;
        
        try {
            const fullKey = this.generateKey(...(Array.isArray(key) ? key : [key, '']));
            const value = await this.client.hGet(fullKey, field);
            
            return value ? JSON.parse(value) : null;
        } catch (error) {
            logger.error('Cache hget error', { error: error.message, key, field });
            return null;
        }
    }
    
    // Get all hash fields
    async hgetall(key) {
        if (!this.connected) return null;
        
        try {
            const fullKey = this.generateKey(...(Array.isArray(key) ? key : [key, '']));
            const hash = await this.client.hGetAll(fullKey);
            
            const result = {};
            for (const [field, value] of Object.entries(hash)) {
                try {
                    result[field] = JSON.parse(value);
                } catch {
                    result[field] = value;
                }
            }
            
            return result;
        } catch (error) {
            logger.error('Cache hgetall error', { error: error.message, key });
            return null;
        }
    }
    
    // Rate limiting helper
    async checkRateLimit(identifier, limit, window) {
        if (!this.connected) return { allowed: true, remaining: limit };
        
        try {
            const key = this.generateKey('ratelimit', identifier);
            const multi = this.client.multi();
            
            multi.incr(key);
            multi.expire(key, window);
            
            const results = await multi.exec();
            const count = results[0];
            
            const allowed = count <= limit;
            const remaining = Math.max(0, limit - count);
            
            return { allowed, remaining, count };
        } catch (error) {
            logger.error('Rate limit check error', { error: error.message, identifier });
            return { allowed: true, remaining: limit };
        }
    }
    
    // Session storage
    async setSession(sessionId, data, ttl = 86400) {
        return await this.set(['session', sessionId], data, ttl);
    }
    
    async getSession(sessionId) {
        return await this.get(['session', sessionId]);
    }
    
    async deleteSession(sessionId) {
        return await this.delete(['session', sessionId]);
    }
    
    // Job queue helpers
    async addToQueue(queueName, data) {
        if (!this.connected) return false;
        
        try {
            const key = this.generateKey('queue', queueName);
            await this.client.rPush(key, JSON.stringify(data));
            return true;
        } catch (error) {
            logger.error('Queue add error', { error: error.message, queue: queueName });
            return false;
        }
    }
    
    async getFromQueue(queueName) {
        if (!this.connected) return null;
        
        try {
            const key = this.generateKey('queue', queueName);
            const value = await this.client.lPop(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            logger.error('Queue get error', { error: error.message, queue: queueName });
            return null;
        }
    }
    
    // Health check
    async isHealthy() {
        if (!this.connected) return false;
        
        try {
            await this.client.ping();
            return true;
        } catch (error) {
            return false;
        }
    }
    
    // Close connection
    async close() {
        if (this.client) {
            await this.client.quit();
            this.connected = false;
            logger.info('Redis connection closed');
        }
    }
}

// Create singleton instance
const cacheService = new CacheService({
    defaultTTL: parseInt(process.env.REDIS_TTL) || 3600,
    prefix: process.env.REDIS_PREFIX || 'gmap:'
});

// Export middleware for Express
const cacheMiddleware = (namespace, ttl = null) => {
    return async (req, res, next) => {
        // Skip cache for non-GET requests
        if (req.method !== 'GET') {
            return next();
        }
        
        // Generate cache key from request
        const cacheKey = [namespace, `${req.originalUrl || req.url}`];
        
        // Try to get from cache
        const cached = await cacheService.get(cacheKey);
        
        if (cached) {
            logger.debug('Cache hit for request', { url: req.url });
            return res.json(cached);
        }
        
        // Store original send
        const originalSend = res.json;
        
        // Override send to cache response
        res.json = function(data) {
            res.json = originalSend;
            
            // Cache successful responses only
            if (res.statusCode === 200) {
                cacheService.set(cacheKey, data, ttl);
            }
            
            return res.json(data);
        };
        
        next();
    };
};

module.exports = {
    cacheService,
    cacheMiddleware,
    CacheService
};
