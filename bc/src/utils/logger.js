/**
 * Unified Logger using Winston
 * Replaces logger.js, scraper-logger.js, and log-formatter.js
 */

const winston = require('winston');
const chalk = require('chalk');
const path = require('path');

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

// Console format with colors
const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(({ level, message, timestamp, ...metadata }) => {
        let msg = `${timestamp} [${level}] ${message}`;
        if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
        }
        return msg;
    })
);

// Create Winston logger
const winstonLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
        // Console output
        new winston.transports.Console({
            format: consoleFormat
        }),
        // Error log file
        new winston.transports.File({ 
            filename: 'logs/error.log', 
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        // Combined log file
        new winston.transports.File({ 
            filename: 'logs/combined.log',
            maxsize: 5242880, // 5MB
            maxFiles: 5
        })
    ],
    exitOnError: false
});

// Progress tracking state
let lastProgressMessage = '';
let progressTimeout = null;

// Enhanced logger with additional methods
const logger = {
    info: (message, context) => winstonLogger.info(message, context),
    error: (message, context) => winstonLogger.error(message, context),
    warn: (message, context) => winstonLogger.warn(message, context),
    debug: (message, context) => winstonLogger.debug(message, context),
    
    // Success method (maps to info with success icon)
    success: (message, context) => {
        console.log(chalk.green('✅ ') + message + (context ? ' ' + JSON.stringify(context) : ''));
        winstonLogger.info(message, { ...context, level: 'success' });
    },
    
    // Progress method for overwriting console lines
    progress: (message) => {
        if (progressTimeout) {
            clearTimeout(progressTimeout);
        }
        
        if (!message) {
            if (lastProgressMessage) {
                process.stdout.write('\r' + ' '.repeat(lastProgressMessage.length) + '\r');
                lastProgressMessage = '';
            }
            return;
        }
        
        process.stdout.write('\r' + message);
        lastProgressMessage = message;
        
        // Auto-clear after 5 seconds of inactivity
        progressTimeout = setTimeout(() => {
            logger.clearProgress();
        }, 5000);
    },
    
    // Clear progress line
    clearProgress: () => {
        if (lastProgressMessage) {
            process.stdout.write('\r' + ' '.repeat(lastProgressMessage.length) + '\r');
            lastProgressMessage = '';
        }
        if (progressTimeout) {
            clearTimeout(progressTimeout);
            progressTimeout = null;
        }
    },
    
    // Legacy methods for compatibility
    setLogFile: (filename) => {
        // Winston handles this automatically
    },
    
    setEnabled: (enabled) => {
        if (!enabled) {
            winstonLogger.transports.forEach(t => t.silent = true);
        } else {
            winstonLogger.transports.forEach(t => t.silent = false);
        }
    },
    
    // Additional custom methods
    header: (text) => {
        const line = '='.repeat(50);
        console.log(chalk.bold.cyan(`\n${line}\n${text}\n${line}\n`));
    },
    
    separator: () => {
        console.log(chalk.gray('─'.repeat(50)));
    },
    
    warning: (text) => {
        console.log(chalk.yellow(`⚠ ${text}`));
        winstonLogger.warn(text);
    },
    
    highlight: (text) => {
        console.log(chalk.bold.yellow(text));
    },
    
    dim: (text) => {
        console.log(chalk.dim(text));
    }
};

module.exports = logger;
