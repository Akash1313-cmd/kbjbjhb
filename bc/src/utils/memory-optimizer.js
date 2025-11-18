/**
 * Memory Optimizer for GMap Pro Multi
 * Handles memory management for processing 500+ keywords without crashes
 */

const v8 = require('v8');
const os = require('os');
const logger = require('./logger');

class MemoryOptimizer {
    constructor() {
        this.thresholds = {
            warning: 0.70,     // 70% memory usage - start cleanup
            critical: 0.85,    // 85% memory usage - aggressive cleanup
            maxHeap: 1.5 * 1024 * 1024 * 1024  // 1.5GB max heap
        };
        
        this.monitoring = false;
        this.monitorInterval = null;
        this.lastGC = Date.now();
        this.gcInterval = 5 * 60 * 1000; // Force GC every 5 minutes
    }

    /**
     * Start memory monitoring
     */
    startMonitoring(interval = 30000) {
        if (this.monitoring) return;
        
        this.monitoring = true;
        this.monitorInterval = setInterval(() => {
            this.checkMemory();
        }, interval);
        
        logger.info(`Memory monitoring started (checking every ${interval / 1000}s)`);
    }

    /**
     * Stop memory monitoring
     */
    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
        this.monitoring = false;
        logger.info('Memory monitoring stopped');
    }

    /**
     * Get current memory stats
     */
    getMemoryStats() {
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        
        return {
            process: {
                rss: this.formatBytes(memUsage.rss),           // Resident Set Size
                heapTotal: this.formatBytes(memUsage.heapTotal),
                heapUsed: this.formatBytes(memUsage.heapUsed),
                external: this.formatBytes(memUsage.external),
                arrayBuffers: this.formatBytes(memUsage.arrayBuffers || 0)
            },
            v8: {
                totalHeapSize: this.formatBytes(heapStats.total_heap_size),
                usedHeapSize: this.formatBytes(heapStats.used_heap_size),
                heapLimit: this.formatBytes(heapStats.heap_size_limit),
                mallocedMemory: this.formatBytes(heapStats.malloced_memory),
                peakMallocedMemory: this.formatBytes(heapStats.peak_malloced_memory)
            },
            system: {
                total: this.formatBytes(totalMem),
                free: this.formatBytes(freeMem),
                used: this.formatBytes(totalMem - freeMem),
                percentUsed: ((1 - freeMem / totalMem) * 100).toFixed(2) + '%'
            },
            usage: {
                heapUsagePercent: ((memUsage.heapUsed / heapStats.heap_size_limit) * 100).toFixed(2) + '%',
                systemUsagePercent: ((memUsage.rss / totalMem) * 100).toFixed(2) + '%'
            }
        };
    }

    /**
     * Check memory and trigger cleanup if needed
     */
    async checkMemory() {
        const memUsage = process.memoryUsage();
        const heapStats = v8.getHeapStatistics();
        const heapUsageRatio = memUsage.heapUsed / heapStats.heap_size_limit;
        
        // Log current memory usage
        logger.debug('Memory check', {
            heapUsed: this.formatBytes(memUsage.heapUsed),
            heapTotal: this.formatBytes(memUsage.heapTotal),
            heapUsagePercent: (heapUsageRatio * 100).toFixed(2) + '%'
        });
        
        // Check if we need garbage collection
        const timeSinceLastGC = Date.now() - this.lastGC;
        
        if (heapUsageRatio > this.thresholds.critical) {
            logger.warn('CRITICAL memory usage detected', {
                usage: (heapUsageRatio * 100).toFixed(2) + '%',
                action: 'Triggering aggressive cleanup'
            });
            await this.aggressiveCleanup();
        } else if (heapUsageRatio > this.thresholds.warning) {
            logger.warn('High memory usage detected', {
                usage: (heapUsageRatio * 100).toFixed(2) + '%',
                action: 'Triggering cleanup'
            });
            await this.cleanup();
        } else if (timeSinceLastGC > this.gcInterval) {
            // Periodic GC even if memory is OK
            this.forceGC();
        }
        
        // Emit memory stats for monitoring
        process.emit('memory-stats', this.getMemoryStats());
        
        return heapUsageRatio;
    }

    /**
     * Standard cleanup - gentle memory optimization
     */
    async cleanup() {
        logger.info('Starting memory cleanup...');
        
        // Clear require cache for non-essential modules
        this.clearRequireCache();
        
        // Force garbage collection if available
        this.forceGC();
        
        // Clear any global caches
        this.clearGlobalCaches();
        
        logger.info('Memory cleanup completed');
    }

    /**
     * Aggressive cleanup - when memory is critical
     */
    async aggressiveCleanup() {
        logger.warn('Starting AGGRESSIVE memory cleanup...');
        
        // First do standard cleanup
        await this.cleanup();
        
        // Clear all caches aggressively
        this.clearAllCaches();
        
        // Clear browser-related memory if possible
        await this.clearBrowserMemory();
        
        // Force multiple GC cycles
        for (let i = 0; i < 3; i++) {
            this.forceGC();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Emit critical memory event
        process.emit('memory-critical', this.getMemoryStats());
        
        logger.warn('Aggressive memory cleanup completed');
    }

    /**
     * Force garbage collection (requires --expose-gc flag)
     */
    forceGC() {
        if (global.gc) {
            const before = process.memoryUsage().heapUsed;
            global.gc();
            const after = process.memoryUsage().heapUsed;
            const freed = before - after;
            
            if (freed > 0) {
                logger.info(`Garbage collection freed ${this.formatBytes(freed)}`);
            }
            
            this.lastGC = Date.now();
        } else {
            logger.debug('Garbage collection not available (run with --expose-gc)');
        }
    }

    /**
     * Clear require cache for non-essential modules
     */
    clearRequireCache() {
        const essentialModules = [
            'express',
            'mongoose',
            'puppeteer',
            'socket.io',
            'redis'
        ];
        
        let cleared = 0;
        Object.keys(require.cache).forEach(key => {
            // Don't clear essential modules or node_modules
            const isEssential = essentialModules.some(mod => key.includes(mod));
            const isNodeModule = key.includes('node_modules');
            
            if (!isEssential && !isNodeModule && !key.includes('.node')) {
                delete require.cache[key];
                cleared++;
            }
        });
        
        if (cleared > 0) {
            logger.debug(`Cleared ${cleared} modules from require cache`);
        }
    }

    /**
     * Clear global caches
     */
    clearGlobalCaches() {
        // Clear any global Maps/Sets that might be holding data
        if (global.resultsCache && typeof global.resultsCache.clear === 'function') {
            global.resultsCache.clear();
        }
        
        // Clear DNS cache
        if (require('dns').getCache) {
            const cache = require('dns').getCache();
            if (cache && cache.clear) {
                cache.clear();
            }
        }
    }

    /**
     * Clear all caches aggressively
     */
    clearAllCaches() {
        // Clear all Maps and Sets in global scope
        for (const key in global) {
            if (global[key] instanceof Map || global[key] instanceof Set) {
                if (typeof global[key].clear === 'function') {
                    const size = global[key].size;
                    global[key].clear();
                    if (size > 0) {
                        logger.debug(`Cleared global ${key} with ${size} items`);
                    }
                }
            }
        }
        
        // Clear all WeakMaps and WeakSets
        for (const key in global) {
            if (global[key] instanceof WeakMap || global[key] instanceof WeakSet) {
                // Can't clear WeakMaps/WeakSets directly, but nullify reference
                global[key] = new (global[key].constructor)();
            }
        }
    }

    /**
     * Clear browser-related memory
     */
    async clearBrowserMemory() {
        // This would interact with puppeteer browsers if available
        try {
            const puppeteer = require('puppeteer');
            
            // Get all browser instances
            if (global.browserInstances && Array.isArray(global.browserInstances)) {
                for (const browser of global.browserInstances) {
                    if (browser && browser.isConnected()) {
                        const pages = await browser.pages();
                        
                        // Clear page caches
                        for (const page of pages) {
                            try {
                                const client = await page.target().createCDPSession();
                                await client.send('Network.clearBrowserCache');
                                await client.send('Network.clearBrowserCookies');
                                await client.detach();
                            } catch (err) {
                                // Continue on error
                            }
                        }
                        
                        // Close unnecessary pages
                        if (pages.length > 10) {
                            const toClose = pages.slice(10);
                            await Promise.all(toClose.map(p => p.close()));
                            logger.debug(`Closed ${toClose.length} excess browser pages`);
                        }
                    }
                }
            }
        } catch (error) {
            // Puppeteer might not be available
        }
    }

    /**
     * Optimize for batch processing
     * Call this before processing large batches
     */
    async optimizeForBatch(keywordCount) {
        logger.info(`Optimizing memory for batch of ${keywordCount} keywords`);
        
        // Estimate memory needed (rough estimate: 5MB per keyword)
        const estimatedMemory = keywordCount * 5 * 1024 * 1024;
        const currentUsed = process.memoryUsage().heapUsed;
        const heapStats = v8.getHeapStatistics();
        const available = heapStats.heap_size_limit - currentUsed;
        
        if (estimatedMemory > available) {
            logger.warn(`Insufficient memory for batch. Need ${this.formatBytes(estimatedMemory)}, have ${this.formatBytes(available)}`);
            
            // Try to free memory
            await this.aggressiveCleanup();
            
            // Recheck
            const newAvailable = heapStats.heap_size_limit - process.memoryUsage().heapUsed;
            if (estimatedMemory > newAvailable) {
                // Still not enough, recommend splitting
                const recommendedBatchSize = Math.floor(newAvailable / (5 * 1024 * 1024));
                return {
                    canProcess: false,
                    recommendedBatchSize,
                    message: `Memory insufficient. Recommend processing ${recommendedBatchSize} keywords at a time.`
                };
            }
        }
        
        // Pre-emptive cleanup before batch
        if (keywordCount > 100) {
            await this.cleanup();
        }
        
        return {
            canProcess: true,
            estimatedMemory: this.formatBytes(estimatedMemory),
            availableMemory: this.formatBytes(available)
        };
    }

    /**
     * Format bytes to human-readable format
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * Get memory recommendations for optimal performance
     */
    getRecommendations() {
        const stats = this.getMemoryStats();
        const recommendations = [];
        
        const heapUsage = parseFloat(stats.usage.heapUsagePercent);
        
        if (heapUsage > 80) {
            recommendations.push('⚠️ Critical: Heap usage above 80%. Reduce batch size immediately.');
        } else if (heapUsage > 60) {
            recommendations.push('⚠️ Warning: Heap usage above 60%. Consider reducing concurrent workers.');
        }
        
        const systemUsage = parseFloat(stats.usage.systemUsagePercent);
        if (systemUsage > 70) {
            recommendations.push('⚠️ System memory high. Close other applications.');
        }
        
        // Check if GC is available
        if (!global.gc) {
            recommendations.push('💡 Tip: Run with --expose-gc flag for better memory management.');
        }
        
        // Batch size recommendations based on available memory
        const freeMem = os.freemem();
        const recommendedBatchSize = Math.min(50, Math.floor(freeMem / (50 * 1024 * 1024)));
        recommendations.push(`✅ Recommended batch size: ${recommendedBatchSize} keywords`);
        
        return {
            stats,
            recommendations
        };
    }
}

// Export singleton instance
module.exports = new MemoryOptimizer();
