/**
 * User Model - MongoDB Schema
 * For SaaS multi-user platform
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    trim: true,
    maxlength: [50, 'Name cannot be more than 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    select: false // Don't return password by default
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  plan: {
    type: String,
    enum: ['free', 'pro', 'enterprise'],
    default: 'free'
  },
  jobsCreated: {
    type: Number,
    default: 0
  },
  totalPlacesScraped: {
    type: Number,
    default: 0
  },
  apiKey: {
    type: String,
    unique: true,
    default: function() {
      // Generate 32-character hexadecimal API key (similar to MD5 hash format)
      return crypto.randomBytes(16).toString('hex');
    }
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true // Allow null values
  },
  avatar: {
    type: String // Google profile picture URL
  },
  authProvider: {
    type: String,
    enum: ['local', 'google', 'facebook'],
    default: 'local'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) {
    return next();
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Get public profile (without sensitive data)
userSchema.methods.getPublicProfile = function() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    plan: this.plan,
    avatar: this.avatar,
    authProvider: this.authProvider,
    apiKey: this.apiKey,  // Include API key for settings page
    jobsCreated: this.jobsCreated,
    totalPlacesScraped: this.totalPlacesScraped,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model('User', userSchema);
