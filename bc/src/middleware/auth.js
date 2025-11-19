/**
 * Authentication Middleware
 * JWT + API Key validation for SaaS platform
 */

const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Validate JWT_SECRET is set
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required!');
}

// API Key validation middleware (ENABLED by default for security)
function requireApiKey(req, res, next) {
    // Production security: API key required by default
    // To disable for development: set API_KEY=disabled in .env file
    if (process.env.API_KEY === 'disabled' || process.env.NODE_ENV === 'development' && !process.env.API_KEY) {
        return next(); // Skip authentication only if explicitly disabled
    }
    
    if (!process.env.API_KEY) {
        return res.status(503).json({ 
            error: 'Server configuration error',
            message: 'API_KEY not configured. Please set API_KEY in your .env file or set API_KEY=disabled for development.'
        });
    }
    
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    const validApiKey = process.env.API_KEY;
    
    if (!apiKey) {
        return res.status(401).json({ 
            error: 'API key required',
            message: 'Please provide API key in X-API-Key header or apiKey query parameter'
        });
    }
    
    if (apiKey !== validApiKey) {
        return res.status(403).json({ 
            error: 'Invalid API key',
            message: 'The provided API key is not valid'
        });
    }
    
    next();
}

// Rate limiting middleware
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // Limit each IP to 10000 requests per windowMs
    message: {
        error: 'Too many requests',
        message: 'Please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stricter rate limit for scraping endpoints
const scrapeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10000, // Limit to 10000 scraping jobs per hour
    message: {
        error: 'Scraping rate limit exceeded',
        message: 'Maximum 10000 scraping jobs per hour allowed'
    }
});

// JWT Authentication Middleware - For SaaS user authentication
async function requireAuth(req, res, next) {
    try {
        // Get token from header
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                error: 'No token',
                message: 'Authentication required. Please sign in.'
            });
        }

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Find user
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({
                error: 'User not found',
                message: 'Invalid authentication token'
            });
        }

        if (!user.isActive) {
            return res.status(403).json({
                error: 'Account disabled',
                message: 'Your account has been disabled'
            });
        }

        // Attach user to request
        req.user = user;
        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Invalid token',
                message: 'Authentication failed'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired',
                message: 'Please sign in again'
            });
        }

        return res.status(500).json({
            error: 'Authentication error',
            message: 'Failed to authenticate user'
        });
    }
}

// Optional Auth - Attach user if token exists, but don't require it
async function optionalAuth(req, res, next) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await User.findById(decoded.userId);
            if (user && user.isActive) {
                req.user = user;
            }
        }
    } catch (error) {
        // Silently fail for optional auth
    }
    
    next();
}

// User API Key Authentication - For external integrations
async function requireUserApiKey(req, res, next) {
    try {
        // Get API key from header or query param
        const apiKey = req.headers['x-api-key'] || req.query.apiKey;
        
        if (!apiKey) {
            return res.status(401).json({
                error: 'API key required',
                message: 'Please provide your API key in X-API-Key header or apiKey query parameter'
            });
        }

        // Find user by API key
        const user = await User.findOne({ apiKey, isActive: true });
        
        if (!user) {
            return res.status(401).json({
                error: 'Invalid API key',
                message: 'The provided API key is not valid or account is disabled'
            });
        }

        // Attach user to request
        req.user = user;
        
        // Log API usage (for analytics/billing)
        user.lastLogin = new Date();
        await user.save();

        next();

    } catch (error) {
        return res.status(500).json({
            error: 'Authentication error',
            message: 'Failed to authenticate API key'
        });
    }
}

// Flexible Auth - Accept either JWT token OR user API key
async function requireAuthOrApiKey(req, res, next) {
    // Check if API key is provided
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;
    
    // Debug log
    console.log('🔑 Auth Check:', {
        hasApiKey: !!apiKey,
        hasAuthHeader: !!req.headers.authorization,
        apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'none'
    });

    // Allow system/dev API key from .env (API_KEY)
    if (apiKey && process.env.API_KEY && apiKey === process.env.API_KEY) {
        req.user = {
            _id: 'system',
            isActive: true,
            role: 'admin',
            plan: 'pro',
            email: 'system@local'
        };
        return next();
    }
    
    if (apiKey) {
        // Use API key authentication
        return requireUserApiKey(req, res, next);
    }
    
    // Otherwise use JWT authentication
    return requireAuth(req, res, next);
}

module.exports = {
    requireApiKey,
    apiLimiter,
    scrapeLimiter,
    requireAuth,
    optionalAuth,
    requireUserApiKey,
    requireAuthOrApiKey
};
