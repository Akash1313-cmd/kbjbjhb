/**
 * Ultra-Minimal API Server
 * Only 6 essential endpoints
 * Version: 4.0.0 - Minimal Edition
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./database/json-db');
const { processKeywords } = require('./scraper-pro');
const authRoutes = require('./routes/auth');
const exportService = require('./utils/export');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Authentication Routes (Public)
app.use('/api/auth', authRoutes);

/**
 * JWT Authentication Middleware
 */
const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'Authentication required' 
    });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ 
      error: 'Invalid token',
      message: 'Authentication failed' 
    });
  }
};

/**
 * ENDPOINT 1: POST /api/scrape
 * Submit keywords for scraping, get job ID
 */
app.post('/api/scrape', requireAuth, async (req, res) => {
  try {
    const { keywords } = req.body;
    
    // Validate keywords
    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return res.status(400).json({ 
        error: 'Validation failed',
        message: 'Keywords array is required' 
      });
    }
    
    // Generate job ID
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Create job record
    const job = {
      jobId,
      userId: req.user.id,
      keywords,
      status: 'queued',
      progress: 0,
      createdAt: new Date().toISOString()
    };
    
    await db.insert('jobs', job);
    
    // Start scraping asynchronously
    (async () => {
      try {
        // Track all results from keywords
        const allResults = {};
        
        await processKeywords(
          keywords, 
          null, // customWorkers (use default)
          null, // customLinkWorkers (use default)
          {
            onKeywordStart: async (data) => {
              console.log(`Starting keyword ${data.index}/${data.total}: ${data.keyword}`);
              await db.update('jobs', { jobId }, { 
                status: 'in_progress',
                currentKeyword: data.keyword
              });
            },
            onProgress: async (data) => {
              const progress = Math.floor((data.index / data.total) * 100);
              await db.update('jobs', { jobId }, { 
                progress,
                status: 'in_progress',
                currentKeyword: data.keyword,
                phase: data.phase
              });
            },
            onKeywordComplete: async (data) => {
              console.log(`Completed keyword: ${data.keyword} (${data.resultsCount} results)`);
              if (data.results) {
                allResults[data.keyword] = data.results;
              }
              const progress = Math.floor(((data.index + 1) / data.total) * 100);
              await db.update('jobs', { jobId }, { progress });
            }
          }
        );
        
        // All keywords completed
        await db.update('jobs', { jobId }, {
          status: 'completed',
          progress: 100,
          results: allResults,
          completedAt: new Date().toISOString()
        });
        console.log(`Job ${jobId} completed successfully`);
        
      } catch (error) {
        console.error('Scraping error:', error);
        await db.update('jobs', { jobId }, {
          status: 'failed',
          error: error.message,
          failedAt: new Date().toISOString()
        });
      }
    })();
    
    res.json({ 
      success: true, 
      jobId,
      message: 'Scraping job started',
      keywords 
    });
    
  } catch (error) {
    console.error('Scrape endpoint error:', error);
    res.status(500).json({ 
      error: 'Failed to start scraping',
      message: error.message 
    });
  }
});

/**
 * ENDPOINT 2: GET /api/jobs/:jobId
 * Get job status and results
 */
app.get('/api/jobs/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await db.findOne('jobs', { 
      jobId: req.params.jobId,
      userId: req.user.id 
    });
    
    if (!job) {
      return res.status(404).json({ 
        error: 'Job not found',
        message: 'Job not found or access denied' 
      });
    }
    
    res.json(job);
    
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ 
      error: 'Failed to get job',
      message: error.message 
    });
  }
});

/**
 * ENDPOINT 3: GET /api/jobs
 * List all user jobs (with optional status filter)
 */
app.get('/api/jobs', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = { userId: req.user.id };
    if (status) {
      query.status = status;
    }
    
    const jobs = await db.find('jobs', query);
    
    // Return summary without full results
    const jobsSummary = jobs.map(j => ({
      jobId: j.jobId,
      keywords: j.keywords,
      status: j.status,
      progress: j.progress,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
      currentKeyword: j.currentKeyword
    }));
    
    res.json({ 
      jobs: jobsSummary,
      total: jobs.length 
    });
    
  } catch (error) {
    console.error('List jobs error:', error);
    res.status(500).json({ 
      error: 'Failed to list jobs',
      message: error.message 
    });
  }
});

/**
 * ENDPOINT 4: GET /api/download/:jobId
 * Download results in JSON/CSV/Excel format
 */
app.get('/api/download/:jobId', requireAuth, async (req, res) => {
  try {
    const { format = 'json' } = req.query;
    
    const job = await db.findOne('jobs', { 
      jobId: req.params.jobId,
      userId: req.user.id 
    });
    
    if (!job) {
      return res.status(404).json({ 
        error: 'Job not found',
        message: 'Job not found or access denied' 
      });
    }
    
    if (!job.results || job.status !== 'completed') {
      return res.status(400).json({ 
        error: 'Results not available',
        message: 'Job is not completed or has no results' 
      });
    }
    
    // Export based on format
    if (format === 'csv') {
      const csv = exportService.toCSV(job.results);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${job.jobId}.csv"`);
      return res.send(csv);
    }
    
    if (format === 'excel') {
      const excel = await exportService.toExcel(job.results);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${job.jobId}.xlsx"`);
      return res.send(excel);
    }
    
    // Default: JSON
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${job.jobId}.json"`);
    res.json(job.results);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ 
      error: 'Failed to download results',
      message: error.message 
    });
  }
});

/**
 * ENDPOINT 5 (Optional): GET /api/health
 * Health check endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '4.0.0'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('');
  console.log('✅ Ultra-Minimal API Server Started');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📋 Total Endpoints: 6`);
  console.log('');
  console.log('Authentication:');
  console.log('  - POST /api/auth/signup');
  console.log('  - POST /api/auth/signin');
  console.log('');
  console.log('Core Functionality:');
  console.log('  - POST /api/scrape');
  console.log('  - GET  /api/jobs/:jobId');
  console.log('  - GET  /api/jobs');
  console.log('  - GET  /api/download/:jobId');
  console.log('');
  console.log('Health:');
  console.log('  - GET  /api/health');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});

module.exports = app;
