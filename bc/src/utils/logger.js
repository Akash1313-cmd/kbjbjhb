/**
 * Logging Utility
 * Centralized logging with levels
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

class Logger {
    constructor(logFile = 'scraper-errors.log') {
        this.logFile = logFile;
        this.enableLogging = true;
        this.writeQueue = [];
        this.isWriting = false;
    }
    
    async _write(level, message, context = {}) {
        if (!this.enableLogging) return;
        
        const timestamp = new Date().toISOString();
        const contextStr = Object.keys(context).length > 0 
            ? JSON.stringify(context) 
            : '';
        
        const logEntry = `[${timestamp}] [${level}] ${message} ${contextStr}\n`;
        
        // Add to queue for async writing
        this.writeQueue.push(logEntry);
        
        // Process queue if not already writing
        if (!this.isWriting) {
            this._processQueue();
        }
    }
    
    async _processQueue() {
        if (this.writeQueue.length === 0) {
            this.isWriting = false;
            return;
        }
        
        this.isWriting = true;
        const entries = this.writeQueue.splice(0, this.writeQueue.length);
        const content = entries.join('');
        
        try {
            await fs.appendFile(this.logFile, content);
        } catch (err) {
            console.error('Failed to write to log file:', err.message);
        }
        
        // Process remaining queue
        setImmediate(() => this._processQueue());
    }
    
    error(message, context) {
        console.error(`❌ ${message}`, context || '');
        this._write('ERROR', message, context);
    }
    
    warn(message, context) {
        console.warn(`⚠️  ${message}`, context || '');
        this._write('WARN', message, context);
    }
    
    info(message, context) {
        console.log(`ℹ️  ${message}`, context || '');
        this._write('INFO', message, context);
    }
    
    debug(message, context) {
        if (process.env.DEBUG) {
            console.log(`🔍 ${message}`, context || '');
            this._write('DEBUG', message, context);
        }
    }
    
    setLogFile(filename) {
        this.logFile = filename;
    }
    
    setEnabled(enabled) {
        this.enableLogging = enabled;
    }
}

// Export singleton instance
module.exports = new Logger();
