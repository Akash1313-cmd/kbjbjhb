/**
 * Security Configuration
 * Production-ready security settings
 */

const crypto = require('crypto');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// Generate secure random strings
const generateSecureKey = (length = 64) => {
    return crypto.randomBytes(length).toString('hex');
};

// Validate environment variables
const validateEnvVariables = () => {
    const required = [
        'JWT_SECRET',
        'MONGODB_URI',
        'NODE_ENV'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    // Validate JWT secret strength
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
        console.warn('⚠️  JWT_SECRET should be at least 32 characters for production');
    }
    
    // Check for default values
    if (process.env.JWT_SECRET === 'gmap-pro-secret-key-2024-change-this-in-production') {
        throw new Error('Default JWT_SECRET detected. Please set a secure secret for production');
    }
    
    if (process.env.API_KEY === 'akki') {
        throw new Error('Default API_KEY detected. Please set a secure API key for production');
    }
};

// Security headers configuration
const securityHeaders = () => {
    return helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
                imgSrc: ["'self'", "data:", "https:"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                connectSrc: ["'self'", "https://api.openai.com"],
                frameSrc: ["'none'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
            }
        },
        hsts: {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
        }
    });
};

// CORS configuration
const corsOptions = () => {
    const allowedOrigins = process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim())
        : ['http://localhost:5173'];
    
    return {
        origin: function (origin, callback) {
            // Allow requests with no origin (like mobile apps or Postman)
            if (!origin) return callback(null, true);
            
            if (process.env.NODE_ENV === 'development') {
                // Allow all origins in development
                return callback(null, true);
            }
            
            if (allowedOrigins.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
        exposedHeaders: ['X-API-Key', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key']
    };
};

// Enhanced rate limiting for production
const createRateLimiter = (options = {}) => {
    const defaults = {
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
        max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
        message: {
            error: 'Too many requests',
            message: 'Please try again later',
            retryAfter: null
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            const retryAfter = req.rateLimit.resetTime 
                ? new Date(req.rateLimit.resetTime).toISOString()
                : null;
            
            res.status(429).json({
                error: 'Too many requests',
                message: `Rate limit exceeded. Please try again later.`,
                retryAfter
            });
        }
    };
    
    return rateLimit({ ...defaults, ...options });
};

// API rate limiter
const apiRateLimiter = createRateLimiter({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
});

// Scraping rate limiter (stricter)
const scrapeRateLimiter = createRateLimiter({
    windowMs: parseInt(process.env.SCRAPE_LIMIT_WINDOW_MS) || 60 * 60 * 1000,
    max: parseInt(process.env.SCRAPE_LIMIT_MAX_REQUESTS) || 50,
    skipSuccessfulRequests: false
});

// Authentication rate limiter (very strict)
const authRateLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 5,
    skipSuccessfulRequests: false
});

// Sanitize user input
const sanitizeInput = (input) => {
    if (typeof input !== 'string') return input;
    
    // Remove potential XSS vectors
    return input
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '')
        .replace(/<iframe/gi, '')
        .trim();
};

// MongoDB connection string sanitizer
const sanitizeMongoUri = (uri) => {
    if (!uri) return null;
    
    // Hide password in logs
    return uri.replace(/:([^:@]+)@/, ':****@');
};

// Session configuration
const sessionConfig = {
    secret: process.env.SESSION_SECRET || generateSecureKey(),
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: parseInt(process.env.SESSION_EXPIRY) || 24 * 60 * 60 * 1000,
        sameSite: 'strict'
    },
    name: 'gmap.sid'
};

// Password strength validator
const validatePasswordStrength = (password) => {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    
    const errors = [];
    
    if (password.length < minLength) {
        errors.push(`Password must be at least ${minLength} characters`);
    }
    if (!hasUpperCase) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!hasLowerCase) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!hasNumbers) {
        errors.push('Password must contain at least one number');
    }
    if (!hasSpecialChar) {
        errors.push('Password must contain at least one special character');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
};

// Generate API key
const generateApiKey = () => {
    const prefix = 'gmap';
    const timestamp = Date.now().toString(36);
    const random = crypto.randomBytes(16).toString('hex');
    return `${prefix}_${timestamp}_${random}`;
};

// IP whitelist/blacklist
const ipFilter = (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress;
    
    // Check blacklist
    const blacklist = process.env.IP_BLACKLIST?.split(',') || [];
    if (blacklist.includes(clientIp)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    // Check whitelist (if configured)
    const whitelist = process.env.IP_WHITELIST?.split(',') || [];
    if (whitelist.length > 0 && !whitelist.includes(clientIp)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    next();
};

module.exports = {
    generateSecureKey,
    validateEnvVariables,
    securityHeaders,
    corsOptions,
    apiRateLimiter,
    scrapeRateLimiter,
    authRateLimiter,
    sanitizeInput,
    sanitizeMongoUri,
    sessionConfig,
    validatePasswordStrength,
    generateApiKey,
    ipFilter,
    createRateLimiter
};
