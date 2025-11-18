/**
 * Scraping Routes
 * POST /api/scrape - Multi-keyword scraping
 * POST /api/scrape/single - Single keyword scraping  
 * POST /api/scrape/bulk - Bulk keyword scraping
 */

const express = require('express');
const router = express.Router();
const { requireAuthOrApiKey } = require('../middleware/auth');
const { scrapeLimiter } = require('../middleware/auth');
const {
    initScrapingController,
    startScraping,
    startSingleScraping,
    startBulkScraping
} = require('../controllers/scraping.controller');

// Routes
router.post('/scrape', requireAuthOrApiKey, scrapeLimiter, startScraping);
router.post('/scrape/single', requireAuthOrApiKey, scrapeLimiter, startSingleScraping);
router.post('/scrape/bulk', requireAuthOrApiKey, scrapeLimiter, startBulkScraping);

module.exports = {
    router,
    initScrapingController
};
