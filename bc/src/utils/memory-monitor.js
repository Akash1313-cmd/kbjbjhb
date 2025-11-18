/**
 * Memory Monitor Utility
 * Tracks and reports memory usage for the scraping process
 */

const os = require('os');

class MemoryMonitor {
    constructor() {
        this.startMemory = process.memoryUsage();
        this.peakMemory = { ...this.startMemory };
        this.monitorInterval = null;
    }

    /**
     * Start monitoring memory usage
     * @param {number} intervalMs - Monitoring interval in milliseconds
     */
    startMonitoring(intervalMs = 5000) {
        this.monitorInterval = setInterval(() => {
            const current = this.getMemoryStats();
            
            // Update peak memory
            Object.keys(current.process).forEach(key => {
                if (current.process[key] > this.peakMemory[key]) {
                    this.peakMemory[key] = current.process[key];
                }
            });
            
            // Log if memory usage is high
            if (current.processPercent > 50) {
                console.log(`⚠️  High memory usage: ${current.processPercent.toFixed(1)}% of system RAM`);
            }
        }, intervalMs);
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }
    }

    /**
     * Get current memory statistics
     */
    getMemoryStats() {
        const processMemory = process.memoryUsage();
        const systemMemory = {
            total: os.totalmem(),
            free: os.freemem(),
            used: os.totalmem() - os.freemem()
        };

        return {
            process: {
                rss: processMemory.rss,
                heapTotal: processMemory.heapTotal,
                heapUsed: processMemory.heapUsed,
                external: processMemory.external,
                arrayBuffers: processMemory.arrayBuffers
            },
            processReadable: {
                rss: `${(processMemory.rss / 1024 / 1024).toFixed(2)} MB`,
                heapTotal: `${(processMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
                heapUsed: `${(processMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                external: `${(processMemory.external / 1024 / 1024).toFixed(2)} MB`
            },
            system: systemMemory,
            systemReadable: {
                total: `${(systemMemory.total / 1024 / 1024 / 1024).toFixed(2)} GB`,
                free: `${(systemMemory.free / 1024 / 1024 / 1024).toFixed(2)} GB`,
                used: `${(systemMemory.used / 1024 / 1024 / 1024).toFixed(2)} GB`,
                usedPercent: `${((systemMemory.used / systemMemory.total) * 100).toFixed(1)}%`
            },
            processPercent: (processMemory.rss / systemMemory.total) * 100
        };
    }

    /**
     * Get memory report
     */
    getReport() {
        const current = this.getMemoryStats();
        const startRss = this.startMemory.rss / 1024 / 1024;
        const currentRss = current.process.rss / 1024 / 1024;
        const peakRss = this.peakMemory.rss / 1024 / 1024;
        
        return {
            summary: {
                start: `${startRss.toFixed(2)} MB`,
                current: `${currentRss.toFixed(2)} MB`,
                peak: `${peakRss.toFixed(2)} MB`,
                increase: `${(currentRss - startRss).toFixed(2)} MB`,
                systemUsage: `${current.processPercent.toFixed(1)}%`
            },
            details: current
        };
    }

    /**
     * Print formatted memory report
     */
    printReport() {
        const report = this.getReport();
        
        console.log('\n📊 Memory Usage Report:');
        console.log('─'.repeat(40));
        console.log(`   Start Memory:    ${report.summary.start}`);
        console.log(`   Current Memory:  ${report.summary.current}`);
        console.log(`   Peak Memory:     ${report.summary.peak}`);
        console.log(`   Memory Increase: ${report.summary.increase}`);
        console.log(`   System RAM Used: ${report.summary.systemUsage} of total`);
        console.log('─'.repeat(40));
        
        console.log('\n💾 System Memory:');
        console.log(`   Total: ${report.details.systemReadable.total}`);
        console.log(`   Free:  ${report.details.systemReadable.free}`);
        console.log(`   Used:  ${report.details.systemReadable.used} (${report.details.systemReadable.usedPercent})`);
    }

    /**
     * Get optimization suggestions based on current memory usage
     */
    getOptimizationSuggestions() {
        const stats = this.getMemoryStats();
        const suggestions = [];
        
        if (stats.processPercent > 30) {
            suggestions.push('• Consider reducing the number of parallel workers');
        }
        
        if (stats.processPercent > 50) {
            suggestions.push('• Memory usage is high! Reduce MAX_DATA_WORKERS in .env');
            suggestions.push('• Enable headless mode for lower memory usage');
        }
        
        if (stats.process.heapUsed > stats.process.heapTotal * 0.9) {
            suggestions.push('• Heap memory is almost full - may need to restart the process');
        }
        
        if (stats.system.free < 1024 * 1024 * 1024) { // Less than 1GB free
            suggestions.push('• System RAM is running low - close other applications');
        }
        
        return suggestions;
    }
}

module.exports = MemoryMonitor;
