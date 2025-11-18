/**
 * Authentication Routes
 * Simple JWT-based authentication
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/json-db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';
const JWT_EXPIRE = '7d';

/**
 * POST /api/auth/signup
 * Register new user
 */
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Validation failed',
        message: 'Email and password are required' 
      });
    }
    
    // Check if user exists
    const existingUser = await db.findOne('users', { email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ 
        error: 'User exists',
        message: 'User already exists' 
      });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user
    const user = await db.insert('users', {
      email: email.toLowerCase(),
      password: hashedPassword,
      createdAt: new Date().toISOString()
    });
    
    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRE }
    );
    
    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: { id: user.id, email: user.email }
    });
    
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({
      error: 'Registration failed',
      message: error.message
    });
  }
});

/**
 * POST /api/auth/signin
 * Login user
 */
router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Validation failed',
        message: 'Email and password are required' 
      });
    }
    
    // Find user
    const user = await db.findOne('users', { email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid credentials',
        message: 'Invalid email or password' 
      });
    }
    
    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ 
        error: 'Invalid credentials',
        message: 'Invalid email or password' 
      });
    }
    
    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRE }
    );
    
    res.json({
      success: true,
      token,
      user: { id: user.id, email: user.email }
    });
    
  } catch (error) {
    console.error('Signin error:', error);
    res.status(500).json({
      error: 'Login failed',
      message: error.message
    });
  }
});

module.exports = router;
