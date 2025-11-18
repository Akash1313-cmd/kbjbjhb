/**
 * Job Model - MongoDB Schema
 * Store scraping jobs with user association
 */

const mongoose = require('mongoose');

const jobSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  keywords: [{
    type: String,
    required: true
  }],
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'queued',
    index: true
  },
  config: {
    workers: { type: Number, default: 10 },
    linkWorkers: { type: Number, default: 1 },
    headless: { type: Boolean, default: true }
  },
  progress: {
    current: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
    keywordsCompleted: { type: Number, default: 0 },
    totalKeywords: { type: Number, default: 0 },
    placesScraped: { type: Number, default: 0 }
  },
  totalPlaces: {
    type: Number,
    default: 0
  },
  duration: {
    type: Number, // milliseconds
    default: 0
  },
  error: {
    type: String
  },
  startedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Index for faster queries
jobSchema.index({ userId: 1, createdAt: -1 });
jobSchema.index({ status: 1, createdAt: -1 });

// Virtual for places
jobSchema.virtual('places', {
  ref: 'Place',
  localField: 'jobId',
  foreignField: 'jobId'
});

module.exports = mongoose.model('Job', jobSchema);
