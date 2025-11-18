/**
 * Log Formatter - API Response Logs
 * Simplified version for API log formatting
 */

class LogFormatter {
    
    // Format logs for API response
    static formatApiLogs(job, results) {
        const logs = [];
        
        // Job Creation
        logs.push({
            timestamp: job.createdAt,
            level: 'INFO',
            icon: '📝',
            category: 'Job Created',
            message: `New scraping job initialized`,
            details: {
                jobId: job.jobId,
                keywords: job.keywords,
                totalKeywords: job.keywords.length,
                workers: job.config?.workers || 5,
                linkWorkers: job.config?.linkWorkers || 3
            }
        });
        
        // Job Started
        if (job.startTime) {
            logs.push({
                timestamp: job.startTime,
                level: 'INFO',
                icon: '🚀',
                category: 'Job Started',
                message: `Scraping job started with ${job.keywords.length} keyword(s)`,
                details: {
                    workers: job.config?.workers || 5,
                    linkWorkers: job.config?.linkWorkers || 3,
                    estimatedTime: `${job.keywords.length * 4} minutes`
                }
            });
        }
        
        // Job Progress
        if (job.progress && job.status === 'in_progress') {
            logs.push({
                timestamp: new Date().toISOString(),
                level: 'INFO',
                icon: '⏳',
                category: 'In Progress',
                message: `Processing keyword ${job.progress.current} of ${job.progress.total}`,
                details: {
                    progress: `${job.progress.percentage}%`,
                    current: job.progress.current,
                    total: job.progress.total
                }
            });
        }
        
        // Job Completed
        if (job.status === 'completed' && job.completedAt) {
            const totalPlaces = results ? 
                Object.values(results).reduce((sum, places) => sum + places.length, 0) : 0;
            
            logs.push({
                timestamp: job.completedAt,
                level: 'SUCCESS',
                icon: '✅',
                category: 'Job Completed',
                message: `Scraping completed successfully! Found ${totalPlaces} places`,
                details: {
                    duration: job.duration,
                    totalPlaces,
                    keywordsProcessed: job.keywords.length,
                    averagePerKeyword: Math.round(totalPlaces / job.keywords.length),
                    status: 'completed'
                }
            });
        }
        
        // Job Failed
        if (job.status === 'failed') {
            logs.push({
                timestamp: job.completedAt || new Date().toISOString(),
                level: 'ERROR',
                icon: '❌',
                category: 'Job Failed',
                message: `Job failed: ${job.error || 'Unknown error'}`,
                details: {
                    error: job.error || 'Unknown error',
                    status: 'failed',
                    duration: job.duration || 'N/A'
                }
            });
        }
        
        return logs;
    }
    
    // Format summary
    static formatSummary(logs) {
        const summary = {
            total: logs.length,
            byLevel: {},
            byCategory: {},
            timeline: []
        };
        
        logs.forEach(log => {
            summary.byLevel[log.level] = (summary.byLevel[log.level] || 0) + 1;
            summary.byCategory[log.category] = (summary.byCategory[log.category] || 0) + 1;
            summary.timeline.push({
                time: log.timestamp,
                event: log.category,
                status: log.level
            });
        });
        
        return summary;
    }
}

module.exports = LogFormatter;
