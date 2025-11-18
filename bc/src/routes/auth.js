/**
 * Authentication Routes
 * JWT-based authentication using JSON database
 */

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/json-db');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/auth');
const { verifyIdToken } = require('../config/firebase-admin');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production';
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

// Generate JWT Token
const generateToken = (userId, email) => {
  return jwt.sign(
    { userId, email },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRE }
  );
};

// Helper function to get public profile
const getPublicProfile = (user) => {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    plan: user.plan,
    avatar: user.avatar,
    authProvider: user.authProvider,
    apiKey: user.apiKey,
    jobsCreated: user.jobsCreated,
    totalPlacesScraped: user.totalPlacesScraped,
    createdAt: user.createdAt
  };
};

// @route   POST /api/auth/signup
// @desc    Register new user
// @access  Public
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please provide name, email, and password'
      });
    }

    // Check if user exists
    const existingUser = db.findOne('users', { email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        error: 'User exists',
        message: 'Email already registered'
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate API key
    const apiKey = crypto.randomBytes(16).toString('hex');

    // Create user
    const user = db.insert('users', {
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: 'user',
      plan: 'free',
      jobsCreated: 0,
      totalPlacesScraped: 0,
      apiKey: apiKey,
      authProvider: 'local',
      isActive: true,
      lastLogin: null
    });

    // Generate token
    const token = generateToken(user._id, user.email);

    logger.info('User registered', { userId: user._id, email: user.email });

    res.status(201).json({
      status: 'success',
      token,
      user: getPublicProfile(user)
    });

  } catch (error) {
    logger.error('Signup error', { error: error.message });
    res.status(500).json({
      error: 'Registration failed',
      message: error.message
    });
  }
});

// @route   POST /api/auth/google-signin
// @desc    Google Sign-In (Firebase)
// @access  Public
router.post('/google-signin', async (req, res) => {
  try {
    const { idToken, email, name, photoURL, uid } = req.body;

    // Validate input
    if (!idToken) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'ID token is required'
      });
    }

    // Verify the Firebase ID token
    let decodedToken;
    try {
      decodedToken = await verifyIdToken(idToken);
    } catch (error) {
      logger.error('Invalid Firebase ID token', { error: error.message });
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Invalid or expired Google authentication token'
      });
    }

    // Use the verified email and UID from the decoded token for security
    const verifiedEmail = decodedToken.email || email;
    const verifiedUid = decodedToken.uid || uid;
    const verifiedName = decodedToken.name || name;

    // Validate that we have the required data
    if (!verifiedEmail || !verifiedName) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Email and name are required'
      });
    }

    // Find or create user
    let user = db.findOne('users', { email: verifiedEmail.toLowerCase() });
    
    if (!user) {
      // Create new user with Google auth
      const apiKey = crypto.randomBytes(16).toString('hex');
      const randomPassword = Math.random().toString(36).slice(-8);
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(randomPassword, salt);

      user = db.insert('users', {
        name: verifiedName,
        email: verifiedEmail.toLowerCase(),
        password: hashedPassword,
        googleId: verifiedUid,
        avatar: photoURL,
        authProvider: 'google',
        role: 'user',
        plan: 'free',
        jobsCreated: 0,
        totalPlacesScraped: 0,
        apiKey: apiKey,
        isActive: true,
        lastLogin: new Date().toISOString()
      });
      
      logger.info('Google user registered', { userId: user._id, email: user.email });
    } else {
      // Update existing user
      const updates = {
        lastLogin: new Date().toISOString()
      };
      
      if (!user.googleId) updates.googleId = verifiedUid;
      if (photoURL && !user.avatar) updates.avatar = photoURL;
      if (!user.authProvider) updates.authProvider = 'google';
      
      db.update('users', { _id: user._id }, updates);
      
      // Re-fetch updated user
      user = db.findOne('users', { _id: user._id });
      
      logger.info('Google user signed in', { userId: user._id, email: user.email });
    }

    // Generate JWT token
    const token = generateToken(user._id, user.email);

    res.json({
      status: 'success',
      token,
      user: getPublicProfile(user)
    });

  } catch (error) {
    logger.error('Google signin error', { error: error.message });
    res.status(500).json({
      error: 'Google sign-in failed',
      message: error.message
    });
  }
});

// @route   POST /api/auth/signin
// @desc    Login user
// @access  Public
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please provide email and password'
      });
    }

    // Find user (password is included in json-db)
    const user = db.findOne('users', { email: email.toLowerCase() });
    
    if (!user) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Check if account is active
    if (!user.isActive) {
      return res.status(403).json({
        error: 'Account disabled',
        message: 'Your account has been disabled. Please contact support.'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    // Update last login
    db.update('users', { _id: user._id }, { lastLogin: new Date().toISOString() });

    // Re-fetch updated user
    const updatedUser = db.findOne('users', { _id: user._id });

    // Generate token
    const token = generateToken(updatedUser._id, updatedUser.email);

    logger.info('User signed in', { userId: updatedUser._id, email: updatedUser.email });

    res.json({
      status: 'success',
      token,
      user: getPublicProfile(updatedUser)
    });

  } catch (error) {
    logger.error('Signin error', { error: error.message });
    res.status(500).json({
      error: 'Login failed',
      message: error.message
    });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private (requires token)
router.get('/me', async (req, res) => {
  try {
    // Get token from header
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        error: 'No token',
        message: 'Authentication required'
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Find user
    const user = db.findOne('users', { _id: decoded.userId });
    
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User account not found'
      });
    }

    res.json({
      status: 'success',
      user: getPublicProfile(user)
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Token is invalid or malformed'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Please sign in again'
      });
    }

    logger.error('Get user error', { error: error.message });
    res.status(500).json({
      error: 'Failed to get user',
      message: error.message
    });
  }
});

// @route   PUT /api/auth/update-profile
// @desc    Update user profile
// @access  Private (JWT Auth)
router.put('/update-profile', requireAuth, async (req, res) => {
  try {
    const { name, avatar } = req.body;

    const user = db.findOne('users', { _id: req.user._id });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User account not found'
      });
    }

    // Update fields
    const updates = {};
    if (name) updates.name = name;
    if (avatar) updates.avatar = avatar;

    db.update('users', { _id: user._id }, updates);

    // Get updated user
    const updatedUser = db.findOne('users', { _id: user._id });

    logger.info('Profile updated', { userId: user._id });

    res.json({
      status: 'success',
      message: 'Profile updated successfully',
      user: getPublicProfile(updatedUser)
    });

  } catch (error) {
    logger.error('Update profile error', { error: error.message });
    res.status(500).json({
      error: 'Update failed',
      message: error.message
    });
  }
});

// @route   POST /api/auth/change-password
// @desc    Change user password
// @access  Private (JWT Auth)
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        error: 'No token',
        message: 'Authentication required'
      });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Validation failed',
        message: 'Please provide current and new password'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.findOne('users', { _id: decoded.userId });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      return res.status(401).json({
        error: 'Invalid password',
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    db.update('users', { _id: user._id }, { password: hashedPassword });

    logger.info('Password changed', { userId: user._id });

    res.json({
      status: 'success',
      message: 'Password changed successfully'
    });

  } catch (error) {
    logger.error('Password change error', { error: error.message });
    res.status(500).json({
      error: 'Password change failed',
      message: error.message
    });
  }
});

// @route   POST /api/auth/regenerate-api-key
// @desc    Regenerate user's API key
// @access  Private (JWT Auth)
router.post('/regenerate-api-key', requireAuth, async (req, res) => {
  try {
    const user = db.findOne('users', { _id: req.user._id });

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        message: 'User account not found'
      });
    }

    // Generate new API key (32-char hex string)
    const newApiKey = crypto.randomBytes(16).toString('hex');
    
    // Save old key for logging
    const oldApiKey = user.apiKey;

    // Update user's API key
    db.update('users', { _id: user._id }, { apiKey: newApiKey });

    logger.info('API key regenerated', { 
      userId: user._id, 
      email: user.email,
      oldKey: oldApiKey?.substring(0, 8) + '...',
      newKey: newApiKey.substring(0, 8) + '...'
    });

    res.json({
      status: 'success',
      message: 'API key regenerated successfully',
      apiKey: newApiKey
    });

  } catch (error) {
    logger.error('API key regeneration error', { error: error.message });
    res.status(500).json({
      error: 'Failed to regenerate API key',
      message: error.message
    });
  }
});

module.exports = router;
