/**
 * Place Model - MongoDB Schema
 * Store scraped place data
 */

const mongoose = require('mongoose');

const placeSchema = new mongoose.Schema({
  jobId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  keyword: {
    type: String,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  phone: {
    type: String
  },
  rating: {
    type: String
  },
  reviews: {
    type: String
  },
  category: {
    type: String
  },
  address: {
    type: String
  },
  website: {
    type: String
  },
  coordinates: {
    lat: { type: Number },
    lng: { type: Number }
  },
  plusCode: {
    type: String
  },
  openingHours: {
    type: String
  },
  businessStatus: {
    type: String
  },
  priceLevel: {
    type: String
  },
  googleMapsLink: {
    type: String,
    required: true
  }
}, {
  timestamps: true
});

// Compound indexes for faster queries
placeSchema.index({ jobId: 1, keyword: 1 });
placeSchema.index({ userId: 1, createdAt: -1 });
placeSchema.index({ googleMapsLink: 1 }, { unique: true });

module.exports = mongoose.model('Place', placeSchema);
