/**
 * Error Handler - Production Ready
 * Centralized error handling with monitoring
 */

const logger = require('./logger');

// Custom error classes
class AppError extends Error {
    constructor(message, statusCode, isOperational = true) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}

class ValidationError extends AppError {
    constructor(message, errors = []) {
        super(message, 400);
        this.errors = errors;
        this.name = 'ValidationError';
    }
}

class AuthenticationError extends AppError {
    constructor(message = 'Authentication failed') {
        super(message, 401);
        this.name = 'AuthenticationError';
    }
}

class AuthorizationError extends AppError {
    constructor(message = 'Access denied') {
        super(message, 403);
        this.name = 'AuthorizationError';
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, 404);
        this.name = 'NotFoundError';
    }
}

class RateLimitError extends AppError {
    constructor(message = 'Too many requests') {
        super(message, 429);
        this.name = 'RateLimitError';
    }
}

class DatabaseError extends AppError {
    constructor(message = 'Database operation failed') {
        super(message, 500);
        this.name = 'DatabaseError';
        this.isOperational = false;
    }
}

class ScrapingError extends AppError {
    constructor(message = 'Scraping operation failed', details = {}) {
        super(message, 500);
        this.name = 'ScrapingError';
        this.details = details;
    }
}

// Async error wrapper
const asyncWrapper = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

// Error response formatter
const formatErrorResponse = (err, includeStack = false) => {
    const response = {
        error: err.name || 'Error',
        message: err.message || 'An error occurred',
        statusCode: err.statusCode || 500,
        timestamp: new Date().toISOString()
    };
    
    if (err.errors) {
        response.errors = err.errors;
    }
    
    if (err.details) {
        response.details = err.details;
    }
    
    if (includeStack && err.stack) {
        response.stack = err.stack;
    }
    
    return response;
};

// Global error handler middleware
const globalErrorHandler = (err, req, res, next) => {
    // Set default values
    err.statusCode = err.statusCode || 500;
    err.status = err.status || 'error';
    
    // Log error
    const logLevel = err.statusCode >= 500 ? 'error' : 'warn';
    logger[logLevel]('Error occurred', {
        requestId: req.requestId,
        error: err.message,
        statusCode: err.statusCode,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userId: req.user?._id,
        isOperational: err.isOperational
    });
    
    // Send error response
    if (process.env.NODE_ENV === 'production') {
        // Production: send minimal error info
        if (err.isOperational) {
            // Operational errors: safe to send to client
            res.status(err.statusCode).json(formatErrorResponse(err, false));
        } else {
            // Programming errors: send generic message
            logger.error('Programming error detected', { error: err });
            res.status(500).json({
                error: 'Internal Server Error',
                message: 'Something went wrong. Please try again later.',
                statusCode: 500,
                timestamp: new Date().toISOString()
            });
        }
    } else {
        // Development: send full error details
        res.status(err.statusCode).json(formatErrorResponse(err, true));
    }
};

// Unhandled rejection handler
const handleUnhandledRejection = () => {
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection detected', {
            reason: reason,
            promise: promise
        });
        
        // In production, exit gracefully
        if (process.env.NODE_ENV === 'production') {
            setTimeout(() => {
                process.exit(1);
            }, 1000);
        }
    });
};

// Uncaught exception handler
const handleUncaughtException = () => {
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception detected', {
            error: error.message,
            stack: error.stack
        });
        
        // Exit process
        setTimeout(() => {
            process.exit(1);
        }, 1000);
    });
};

// MongoDB error handler
const handleMongoError = (error) => {
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
        switch (error.code) {
            case 11000:
                return new ValidationError('Duplicate key error');
            case 11001:
                return new ValidationError('Duplicate key error');
            default:
                return new DatabaseError(error.message);
        }
    }
    return error;
};

// Validation error handler
const handleValidationError = (error) => {
    if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(err => ({
            field: err.path,
            message: err.message
        }));
        return new ValidationError('Validation failed', errors);
    }
    return error;
};

// JWT error handler
const handleJWTError = (error) => {
    if (error.name === 'JsonWebTokenError') {
        return new AuthenticationError('Invalid token');
    }
    if (error.name === 'TokenExpiredError') {
        return new AuthenticationError('Token expired');
    }
    return error;
};

// Cast error handler (MongoDB)
const handleCastError = (error) => {
    if (error.name === 'CastError') {
        return new ValidationError(`Invalid ${error.path}: ${error.value}`);
    }
    return error;
};

// Error monitoring integration (Sentry)
const initErrorMonitoring = () => {
    if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
        const Sentry = require('@sentry/node');
        
        Sentry.init({
            dsn: process.env.SENTRY_DSN,
            environment: process.env.NODE_ENV,
            tracesSampleRate: 0.1,
            beforeSend(event, hint) {
                // Filter sensitive data
                if (event.request) {
                    delete event.request.cookies;
                    delete event.request.headers?.authorization;
                    delete event.request.headers?.['x-api-key'];
                }
                return event;
            }
        });
        
        logger.info('Sentry error monitoring initialized');
        return Sentry;
    }
    return null;
};

// Performance monitoring
const performanceMonitor = {
    start: (label) => {
        const start = process.hrtime.bigint();
        return {
            end: () => {
                const end = process.hrtime.bigint();
                const duration = Number(end - start) / 1000000; // Convert to ms
                
                if (duration > 1000) {
                    logger.warn(`Performance warning: ${label} took ${duration}ms`);
                }
                
                return duration;
            }
        };
    }
};

// Circuit breaker for external services
class CircuitBreaker {
    constructor(name, options = {}) {
        this.name = name;
        this.failureThreshold = options.failureThreshold || 5;
        this.recoveryTimeout = options.recoveryTimeout || 60000;
        this.failures = 0;
        this.lastFailureTime = null;
        this.state = 'closed'; // closed, open, half-open
    }
    
    async execute(fn) {
        if (this.state === 'open') {
            const now = Date.now();
            if (now - this.lastFailureTime > this.recoveryTimeout) {
                this.state = 'half-open';
            } else {
                throw new AppError(`Circuit breaker is open for ${this.name}`, 503);
            }
        }
        
        try {
            const result = await fn();
            
            if (this.state === 'half-open') {
                this.state = 'closed';
                this.failures = 0;
                logger.info(`Circuit breaker closed for ${this.name}`);
            }
            
            return result;
        } catch (error) {
            this.failures++;
            this.lastFailureTime = Date.now();
            
            if (this.failures >= this.failureThreshold) {
                this.state = 'open';
                logger.error(`Circuit breaker opened for ${this.name}`, {
                    failures: this.failures
                });
            }
            
            throw error;
        }
    }
}

module.exports = {
    // Error classes
    AppError,
    ValidationError,
    AuthenticationError,
    AuthorizationError,
    NotFoundError,
    RateLimitError,
    DatabaseError,
    ScrapingError,
    
    // Utilities
    asyncWrapper,
    globalErrorHandler,
    handleUnhandledRejection,
    handleUncaughtException,
    handleMongoError,
    handleValidationError,
    handleJWTError,
    handleCastError,
    initErrorMonitoring,
    performanceMonitor,
    CircuitBreaker
};
