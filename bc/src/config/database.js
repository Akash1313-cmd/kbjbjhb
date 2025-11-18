/**
 * MongoDB Database Connection
 * For SaaS platform with multiple users
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/gmap-pro';

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
        });
        // logger.info(`✅ MongoDB Connected: ${conn.connection.host}`); // Hidden
        // logger.info(`📦 Database: ${conn.connection.name}`); // Hidden
    } catch (error) {
        logger.error(`❌ MongoDB Connection Error: ${error.message}`);
        process.exit(1);
    }
};
// Handle connection events
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected. Attempting to reconnect...');
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB error:', { error: err.message });
});

module.exports = connectDB;
