/**
 * Validation Utilities
 * Request validation and sanitization
 */

const { ALLOWED_CONFIG_KEYS, MAX_WORKERS, MIN_WORKERS } = require('./constants');

/**
 * Sanitize keyword input to prevent injection attacks
 */
function sanitizeKeyword(keyword) {
    if (typeof keyword !== 'string') {
        throw new Error('Keyword must be a string');
    }
    
    // Remove dangerous characters but keep spaces and common punctuation
    const sanitized = keyword
        .replace(/[<>"'`;\\]/g, '') // Remove HTML/SQL injection chars
        .replace(/\.\.\//g, '')      // Remove path traversal
        .trim()
        .substring(0, 200);           // Limit length
    
    if (sanitized.length === 0) {
        throw new Error('Keyword cannot be empty after sanitization');
    }
    
    return sanitized;
}

/**
 * Sanitize array of keywords
 */
function sanitizeKeywords(keywords) {
    if (!Array.isArray(keywords)) {
        throw new Error('Keywords must be an array');
    }
    
    return keywords.map(k => sanitizeKeyword(k));
}

/**
 * Validate scraping request
 */
function validateScrapeRequest(body) {
    const errors = [];
    
    if (!body.keywords) {
        errors.push('keywords field is required');
    } else if (!Array.isArray(body.keywords)) {
        errors.push('keywords must be an array');
    } else if (body.keywords.length === 0) {
        errors.push('keywords array cannot be empty');
    } else if (body.keywords.length > 500) {
        errors.push('Maximum 500 keywords allowed per request');
    }
    
    if (body.config) {
        if (typeof body.config !== 'object') {
            errors.push('config must be an object');
        } else {
            const configErrors = validateConfig(body.config);
            errors.push(...configErrors);
        }
    }
    
    return errors;
}

/**
 * Validate configuration updates
 */
function validateConfig(config) {
    const errors = [];
    
    // Check for unknown keys
    const unknownKeys = Object.keys(config).filter(key => !ALLOWED_CONFIG_KEYS.includes(key));
    if (unknownKeys.length > 0) {
        errors.push(`Unknown config keys: ${unknownKeys.join(', ')}`);
    }
    
    // Validate worker counts (unlimited support)
    if (config.parallelWorkers !== undefined && config.parallelWorkers !== 'auto') {
        const workers = parseInt(config.parallelWorkers);
        if (isNaN(workers) || workers < 1) {
            errors.push(`parallelWorkers must be 'auto' or a positive number (minimum 1)`);
        }
    }
    
    if (config.maxWorkers !== undefined) {
        const maxWorkers = parseInt(config.maxWorkers);
        if (isNaN(maxWorkers) || maxWorkers < 1) {
            errors.push(`maxWorkers must be a positive number (minimum 1)`);
        }
    }
    
    if (config.minWorkers !== undefined) {
        const minWorkers = parseInt(config.minWorkers);
        if (isNaN(minWorkers) || minWorkers < 1) {
            errors.push(`minWorkers must be a positive number (minimum 1)`);
        }
    }
    
    // Validate boolean fields
    const booleanFields = ['headless', 'enableResume', 'enableErrorLogging', 'smartScrolling'];
    for (const field of booleanFields) {
        if (config[field] !== undefined && typeof config[field] !== 'boolean') {
            errors.push(`${field} must be a boolean`);
        }
    }
    
    // Validate numeric fields
    if (config.scrollTimeout !== undefined) {
        const timeout = parseInt(config.scrollTimeout);
        if (isNaN(timeout) || timeout < 1000 || timeout > 300000) {
            errors.push('scrollTimeout must be between 1000 and 300000 milliseconds');
        }
    }
    
    if (config.retryAttempts !== undefined) {
        const attempts = parseInt(config.retryAttempts);
        if (isNaN(attempts) || attempts < 0 || attempts > 10) {
            errors.push('retryAttempts must be between 0 and 10');
        }
    }
    
    return errors;
}

/**
 * Sanitize configuration object
 */
function sanitizeConfig(config) {
    const sanitized = {};
    
    for (const key of ALLOWED_CONFIG_KEYS) {
        if (config[key] !== undefined) {
            sanitized[key] = config[key];
        }
    }
    
    return sanitized;
}

/**
 * Validate pagination parameters
 */
function validatePagination(query) {
    const limit = parseInt(query.limit) || 10;
    const page = parseInt(query.page) || 1;
    
    return {
        limit: Math.min(Math.max(limit, 1), 100), // Between 1 and 100
        page: Math.max(page, 1) // At least 1
    };
}

module.exports = {
    validateScrapeRequest,
    validateConfig,
    sanitizeConfig,
    validatePagination,
    sanitizeKeyword,
    sanitizeKeywords
};
