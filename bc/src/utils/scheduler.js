/**
 * Schedule Runner
 * Handles cron-based job scheduling
 */

const logger = require('./logger');

class Scheduler {
    constructor() {
        this.schedules = new Map();
        this.timers = new Map();
        this.isRunning = false;
    }
    
    /**
     * Start the scheduler
     */
    start() {
        if (this.isRunning) {
            logger.warn('Scheduler already running');
            return;
        }
        
        this.isRunning = true;
        // logger.info('Scheduler started'); // Hidden
        
        // Check schedules every minute
        this.mainTimer = setInterval(() => {
            this.checkSchedules();
        }, 60 * 1000);
    }
    
    /**
     * Stop the scheduler
     */
    stop() {
        if (!this.isRunning) {
            return;
        }
        
        this.isRunning = false;
        
        if (this.mainTimer) {
            clearInterval(this.mainTimer);
        }
        
        // Clear all schedule timers
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        
        this.timers.clear();
        logger.info('Scheduler stopped');
    }
    
    /**
     * Add a schedule
     */
    addSchedule(scheduleId, schedule, executeCallback) {
        this.schedules.set(scheduleId, {
            ...schedule,
            callback: executeCallback,
            lastRun: null,
            nextRun: this.calculateNextRun(schedule)
        });
        
        logger.info('Schedule added', { scheduleId, nextRun: this.calculateNextRun(schedule) });
    }
    
    /**
     * Remove a schedule
     */
    removeSchedule(scheduleId) {
        this.schedules.delete(scheduleId);
        
        if (this.timers.has(scheduleId)) {
            clearTimeout(this.timers.get(scheduleId));
            this.timers.delete(scheduleId);
        }
        
        logger.info('Schedule removed', { scheduleId });
    }
    
    /**
     * Check all schedules and run due ones
     */
    async checkSchedules() {
        const now = Date.now();
        
        for (const [scheduleId, schedule] of this.schedules.entries()) {
            if (schedule.status !== 'active') {
                continue;
            }
            
            const nextRun = new Date(schedule.nextRun).getTime();
            
            if (now >= nextRun) {
                logger.info('Executing scheduled job', { scheduleId });
                
                try {
                    await schedule.callback(schedule);
                    
                    // Update schedule
                    schedule.lastRun = new Date().toISOString();
                    schedule.nextRun = this.calculateNextRun(schedule);
                    this.schedules.set(scheduleId, schedule);
                    
                    logger.info('Scheduled job completed', { 
                        scheduleId,
                        nextRun: schedule.nextRun 
                    });
                } catch (error) {
                    logger.error('Scheduled job failed', { 
                        scheduleId,
                        error: error.message 
                    });
                }
            }
        }
    }
    
    /**
     * Calculate next run time based on frequency
     */
    calculateNextRun(schedule) {
        const now = new Date();
        let nextRun = new Date(now);
        
        switch (schedule.frequency) {
            case 'hourly':
                nextRun.setHours(nextRun.getHours() + 1);
                break;
            
            case 'daily':
                nextRun.setDate(nextRun.getDate() + 1);
                if (schedule.time) {
                    const [hours, minutes] = schedule.time.split(':');
                    nextRun.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                }
                break;
            
            case 'weekly':
                nextRun.setDate(nextRun.getDate() + 7);
                if (schedule.time) {
                    const [hours, minutes] = schedule.time.split(':');
                    nextRun.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                }
                break;
            
            case 'monthly':
                nextRun.setMonth(nextRun.getMonth() + 1);
                if (schedule.time) {
                    const [hours, minutes] = schedule.time.split(':');
                    nextRun.setHours(parseInt(hours), parseInt(minutes), 0, 0);
                }
                break;
            
            default:
                // Custom cron expression (simplified)
                nextRun.setHours(nextRun.getHours() + 1);
                logger.warn('Custom cron not fully implemented, defaulting to hourly', { 
                    scheduleId: schedule.scheduleId 
                });
        }
        
        return nextRun.toISOString();
    }
    
    /**
     * Get all active schedules
     */
    getSchedules() {
        return Array.from(this.schedules.values());
    }
    
    /**
     * Get schedule by ID
     */
    getSchedule(scheduleId) {
        return this.schedules.get(scheduleId);
    }
}

// Export singleton instance
module.exports = new Scheduler();
