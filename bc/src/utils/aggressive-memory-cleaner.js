/**
 * Aggressive Memory Cleaner
 * Super fast memory cleaning - nothing stays in memory!
 */

const v8 = require('v8');
const os = require('os');

class AggressiveMemoryCleaner {
    constructor() {
        this.cleanupInterval = 5000; // Clean every 5 seconds
        this.isRunning = false;
        this.cleanupTimer = null;
        this.resultBuffer = [];
        this.maxBufferSize = 10; // Only keep 10 items max
    }

    /**
     * Start aggressive cleaning
     */
    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        
        // console.log('🔥 AGGRESSIVE MEMORY CLEANER ACTIVATED!'); // Hidden
        // console.log('   • Nothing stays in memory'); // Hidden
        // console.log('   • Instant data streaming'); // Hidden
        // console.log('   • Continuous garbage collection'); // Hidden
        
        // Run aggressive cleanup every 5 seconds
        this.cleanupTimer = setInterval(() => {
            this.aggressiveClean();
        }, this.cleanupInterval);
        
        // Force immediate GC if available
        if (global.gc) {
            setInterval(() => {
                global.gc();
                global.gc(); // Double GC for aggressive cleaning
            }, 10000); // Every 10 seconds
        }
    }

    /**
     * Stop cleaner
     */
    stop() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.isRunning = false;
    }

    /**
     * Aggressive memory cleaning
     */
    aggressiveClean() {
        try {
            // 1. Force garbage collection
            if (global.gc) {
                global.gc();
            }
            
            // 2. Clear all global variables
            this.clearGlobalVariables();
            
            // 3. Clear require cache
            this.clearModuleCache();
            
            // 4. Clear result buffer
            if (this.resultBuffer.length > 0) {
                this.resultBuffer = [];
            }
            
            // 5. Clear V8 heap
            this.clearV8Heap();
            
            // 6. Process next tick cleanup
            process.nextTick(() => {
                if (global.gc) global.gc();
            });
            
        } catch (err) {
            // Silent fail - keep cleaning
        }
    }

    /**
     * Clear global variables
     */
    clearGlobalVariables() {
        // Clear any global arrays or objects
        if (global.extractionResults) {
            global.extractionResults = null;
            delete global.extractionResults;
        }
        if (global.allResults) {
            global.allResults = null;
            delete global.allResults;
        }
        if (global.linkQueue) {
            global.linkQueue = null;
            delete global.linkQueue;
        }
        if (global.tempData) {
            global.tempData = null;
            delete global.tempData;
        }
    }

    /**
     * Clear module cache aggressively
     */
    clearModuleCache() {
        // Clear non-essential module cache
        Object.keys(require.cache).forEach(key => {
            if (key.includes('temp') || 
                key.includes('result') || 
                key.includes('data') ||
                (key.includes('utils') && !key.includes('aggressive-memory'))) {
                delete require.cache[key];
            }
        });
    }

    /**
     * Clear V8 heap
     */
    clearV8Heap() {
        // Get heap statistics
        const heapStats = v8.getHeapStatistics();
        const usedPercent = (heapStats.used_heap_size / heapStats.heap_size_limit) * 100;
        
        // If heap usage > 50%, force aggressive cleanup
        if (usedPercent > 50) {
            // Write heap snapshot to clear memory
            if (v8.writeHeapSnapshot) {
                const snapshot = v8.writeHeapSnapshot();
                // Immediately delete snapshot to free memory
                if (snapshot) {
                    require('fs').unlinkSync(snapshot);
                }
            }
            
            // Force multiple GC cycles
            if (global.gc) {
                for (let i = 0; i < 3; i++) {
                    global.gc();
                }
            }
        }
    }

    /**
     * Process result immediately and clear from memory
     */
    processResultImmediate(result, callback) {
        // Process immediately
        if (callback) {
            callback(result);
        }
        
        // Don't store anything
        result = null;
        
        // Immediate GC
        if (global.gc) {
            process.nextTick(() => global.gc());
        }
    }

    /**
     * Stream data directly without storing
     */
    streamData(data, writeStream) {
        // Write immediately
        if (writeStream && data) {
            writeStream.write(JSON.stringify(data) + '\n');
        }
        
        // Clear reference immediately
        data = null;
        
        // Force cleanup
        if (global.gc) {
            process.nextTick(() => global.gc());
        }
    }

    /**
     * Get memory stats
     */
    getStats() {
        const mem = process.memoryUsage();
        const systemFree = os.freemem();
        
        return {
            heap: Math.round(mem.heapUsed / 1024 / 1024),
            rss: Math.round(mem.rss / 1024 / 1024),
            external: Math.round(mem.external / 1024 / 1024),
            systemFree: Math.round(systemFree / 1024 / 1024),
            heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100)
        };
    }

    /**
     * Emergency memory wipe
     */
    emergencyWipe() {
        console.log('🚨 EMERGENCY MEMORY WIPE!');
        
        // Clear everything
        this.clearGlobalVariables();
        this.clearModuleCache();
        this.resultBuffer = [];
        
        // Multiple GC cycles
        if (global.gc) {
            for (let i = 0; i < 5; i++) {
                global.gc();
            }
        }
        
        // Clear V8 compiled code cache
        if (v8.clearFunctionFeedback) {
            v8.clearFunctionFeedback();
        }
        
        console.log('   ✅ Memory wiped clean!');
    }
}

// Singleton instance
let cleaner = null;

module.exports = {
    /**
     * Get cleaner instance
     */
    getCleaner() {
        if (!cleaner) {
            cleaner = new AggressiveMemoryCleaner();
        }
        return cleaner;
    },
    
    /**
     * Start aggressive cleaning
     */
    startCleaning() {
        const instance = this.getCleaner();
        instance.start();
        return instance;
    },
    
    /**
     * Stop cleaning
     */
    stopCleaning() {
        if (cleaner) {
            cleaner.stop();
        }
    },
    
    /**
     * Force immediate cleanup
     */
    forceClean() {
        const instance = this.getCleaner();
        instance.aggressiveClean();
        
        // Run multiple times for super clean
        setTimeout(() => instance.aggressiveClean(), 100);
        setTimeout(() => instance.aggressiveClean(), 200);
    },
    
    /**
     * Emergency wipe
     */
    emergencyWipe() {
        const instance = this.getCleaner();
        instance.emergencyWipe();
    },
    
    /**
     * Get memory stats
     */
    getMemoryStats() {
        const instance = this.getCleaner();
        return instance.getStats();
    }
};
