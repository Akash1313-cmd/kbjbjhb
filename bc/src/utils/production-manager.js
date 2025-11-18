/**
 * Production Manager
 * Handles memory optimization, auto-restart, and performance monitoring
 */

const os = require('os');
const v8 = require('v8');

class ProductionManager {
    constructor(options = {}) {
        this.maxMemoryMB = options.maxMemoryMB || parseInt(process.env.MEMORY_LIMIT_MB) || 2048;
        this.checkInterval = options.checkInterval || 30000; // Check every 30 seconds
        this.autoRestart = options.autoRestart || process.env.AUTO_RESTART_ON_ERROR === 'true';
        this.streamResults = options.streamResults || process.env.STREAM_RESULTS === 'true';
        this.cleanupInterval = parseInt(process.env.CLEANUP_INTERVAL) || 20;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 50;
        
        this.monitoring = false;
        this.memoryCheckTimer = null;
        this.performanceStats = {
            startTime: Date.now(),
            totalExtracted: 0,
            totalErrors: 0,
            captchaDetections: 0,
            lastMemoryClean: Date.now(),
            peakMemoryUsage: 0
        };
    }

    /**
     * Start production monitoring
     */
    startMonitoring() {
        if (this.monitoring) return;
        this.monitoring = true;
        
        // console.log('🚀 Production Manager Started'); // Hidden
        // console.log(`   Memory Limit: ${this.maxMemoryMB}MB`); // Hidden
        // console.log(`   Auto-Restart: ${this.autoRestart}`); // Hidden
        // console.log(`   Stream Results: ${this.streamResults}`); // Hidden
        
        // Set up memory monitoring
        this.memoryCheckTimer = setInterval(() => {
            this.checkMemoryUsage();
        }, this.checkInterval);
        
        // Set up graceful shutdown handlers
        this.setupShutdownHandlers();
        
        // Force garbage collection if available
        if (global.gc) {
            setInterval(() => {
                global.gc();
            }, 60000); // GC every minute
        }
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.memoryCheckTimer) {
            clearInterval(this.memoryCheckTimer);
            this.memoryCheckTimer = null;
        }
        this.monitoring = false;
        console.log('🛑 Production Manager Stopped');
    }

    /**
     * Check memory usage and take action if needed
     */
    checkMemoryUsage() {
        const memoryUsage = process.memoryUsage();
        const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
        const rssMB = Math.round(memoryUsage.rss / 1024 / 1024);
        const systemFreeMB = Math.round(os.freemem() / 1024 / 1024);
        
        // Update peak memory
        if (rssMB > this.performanceStats.peakMemoryUsage) {
            this.performanceStats.peakMemoryUsage = rssMB;
        }
        
        // Log memory status every 5 minutes
        const timeSinceStart = Date.now() - this.performanceStats.startTime;
        if (timeSinceStart % (5 * 60 * 1000) < this.checkInterval) {
            console.log(`📊 Memory Status: Heap ${heapUsedMB}MB / RSS ${rssMB}MB / System Free ${systemFreeMB}MB`);
        }
        
        // Check if memory limit exceeded
        if (rssMB > this.maxMemoryMB) {
            console.warn(`⚠️  Memory limit exceeded: ${rssMB}MB > ${this.maxMemoryMB}MB`);
            this.handleMemoryOverload(rssMB);
        }
        
        // Proactive memory cleanup if usage is high
        if (heapUsedMB > this.maxMemoryMB * 0.8) {
            this.performMemoryCleanup();
        }
        
        // System memory critical
        if (systemFreeMB < 500) {
            console.error('🚨 System memory critical! Less than 500MB free');
            this.emergencyMemoryCleanup();
        }
    }

    /**
     * Handle memory overload situation
     */
    handleMemoryOverload(currentMemoryMB) {
        console.log('🧹 Attempting memory recovery...');
        
        // Force garbage collection
        if (global.gc) {
            global.gc();
        }
        
        // Clear require cache for non-essential modules
        this.clearRequireCache();
        
        // Get heap statistics
        const heapStats = v8.getHeapStatistics();
        const heapUsagePercent = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;
        
        console.log(`   Heap Usage: ${heapUsagePercent.toFixed(1)}%`);
        
        // If still over limit after GC, restart if enabled
        setTimeout(() => {
            const newMemory = Math.round(process.memoryUsage().rss / 1024 / 1024);
            if (newMemory > this.maxMemoryMB && this.autoRestart) {
                console.error('🔄 Memory limit still exceeded. Restarting process...');
                process.exit(1); // PM2 will restart automatically
            }
        }, 5000);
    }

    /**
     * Perform memory cleanup
     */
    performMemoryCleanup() {
        const timeSinceLastClean = Date.now() - this.performanceStats.lastMemoryClean;
        
        // Don't clean too frequently
        if (timeSinceLastClean < 60000) return; // Minimum 1 minute between cleanups
        
        console.log('🧹 Performing scheduled memory cleanup...');
        
        // Force garbage collection
        if (global.gc) {
            global.gc();
            console.log('   ✅ Garbage collection completed');
        }
        
        // Clear internal buffers and caches
        this.clearInternalCaches();
        
        this.performanceStats.lastMemoryClean = Date.now();
    }

    /**
     * Emergency memory cleanup
     */
    emergencyMemoryCleanup() {
        console.log('🚨 Emergency memory cleanup initiated!');
        
        // Aggressive garbage collection
        if (global.gc) {
            global.gc();
            global.gc(); // Run twice for thorough cleanup
        }
        
        // Clear all possible caches
        this.clearRequireCache();
        this.clearInternalCaches();
        
        // Log memory after cleanup
        setTimeout(() => {
            const memoryAfter = Math.round(process.memoryUsage().rss / 1024 / 1024);
            console.log(`   Memory after cleanup: ${memoryAfter}MB`);
        }, 1000);
    }

    /**
     * Clear require cache for non-essential modules
     */
    clearRequireCache() {
        Object.keys(require.cache).forEach(key => {
            // Don't clear core modules
            if (!key.includes('node_modules') || key.includes('puppeteer')) {
                return;
            }
            delete require.cache[key];
        });
    }

    /**
     * Clear internal caches and buffers
     */
    clearInternalCaches() {
        // Clear any global caches or buffers in your application
        if (global.resultsCache) {
            global.resultsCache = null;
        }
        
        // Clear string intern pool (V8 specific)
        if (global.gc) {
            global.gc();
        }
    }

    /**
     * Setup graceful shutdown handlers
     */
    setupShutdownHandlers() {
        const gracefulShutdown = (signal) => {
            console.log(`\n📦 ${signal} received. Shutting down gracefully...`);
            
            // Stop monitoring
            this.stopMonitoring();
            
            // Print final stats
            this.printFinalStats();
            
            // Give time for cleanup
            setTimeout(() => {
                process.exit(0);
            }, 2000);
        };
        
        // Handle different shutdown signals
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // PM2 reload
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            console.error('🔥 Uncaught Exception:', error);
            this.performanceStats.totalErrors++;
            
            if (this.autoRestart) {
                console.log('🔄 Auto-restarting due to uncaught exception...');
                process.exit(1);
            }
        });
        
        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            console.error('🔥 Unhandled Rejection at:', promise, 'reason:', reason);
            this.performanceStats.totalErrors++;
        });
    }

    /**
     * Update extraction stats
     */
    updateStats(type, value = 1) {
        switch(type) {
            case 'extracted':
                this.performanceStats.totalExtracted += value;
                break;
            case 'error':
                this.performanceStats.totalErrors += value;
                break;
            case 'captcha':
                this.performanceStats.captchaDetections += value;
                break;
        }
    }

    /**
     * Get current performance metrics
     */
    getMetrics() {
        const memoryUsage = process.memoryUsage();
        const uptime = Math.floor((Date.now() - this.performanceStats.startTime) / 1000);
        
        return {
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
            memory: {
                current: Math.round(memoryUsage.rss / 1024 / 1024),
                peak: this.performanceStats.peakMemoryUsage,
                limit: this.maxMemoryMB
            },
            performance: {
                totalExtracted: this.performanceStats.totalExtracted,
                totalErrors: this.performanceStats.totalErrors,
                captchaDetections: this.performanceStats.captchaDetections,
                extractionRate: uptime > 0 ? 
                    (this.performanceStats.totalExtracted / uptime * 60).toFixed(1) : 0
            },
            system: {
                cpuUsage: process.cpuUsage(),
                freeMemory: Math.round(os.freemem() / 1024 / 1024),
                totalMemory: Math.round(os.totalmem() / 1024 / 1024)
            }
        };
    }

    /**
     * Print final statistics on shutdown
     */
    printFinalStats() {
        const metrics = this.getMetrics();
        
        console.log('\n📊 Final Production Stats:');
        console.log('─'.repeat(40));
        console.log(`   Uptime: ${metrics.uptime}`);
        console.log(`   Total Extracted: ${metrics.performance.totalExtracted}`);
        console.log(`   Total Errors: ${metrics.performance.totalErrors}`);
        console.log(`   CAPTCHA Detections: ${metrics.performance.captchaDetections}`);
        console.log(`   Peak Memory: ${metrics.memory.peak}MB`);
        console.log(`   Extraction Rate: ${metrics.performance.extractionRate} per minute`);
        console.log('─'.repeat(40));
    }

    /**
     * Check if should use streaming mode
     */
    shouldStreamResults() {
        return this.streamResults;
    }

    /**
     * Get batch size for processing
     */
    getBatchSize() {
        return this.batchSize;
    }

    /**
     * Get cleanup interval
     */
    getCleanupInterval() {
        return this.cleanupInterval;
    }
}

// Singleton instance
let productionManager = null;

/**
 * Get or create production manager instance
 */
function getProductionManager(options = {}) {
    if (!productionManager) {
        productionManager = new ProductionManager(options);
    }
    return productionManager;
}

module.exports = {
    ProductionManager,
    getProductionManager
};
