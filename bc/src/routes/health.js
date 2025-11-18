/**
 * Health Check & Monitoring Routes
 * For production monitoring and load balancer health checks
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const os = require('os');
const { cacheService } = require('../services/cache');
const logger = require('../utils/logger');

// Basic health check
router.get('/health', async (req, res) => {
    try {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            environment: process.env.NODE_ENV,
            version: require('../../package.json').version
        };
        
        res.status(200).json(health);
    } catch (error) {
        logger.error('Health check failed', { error: error.message });
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Detailed health check (for internal monitoring)
router.get('/health/detailed', async (req, res) => {
    try {
        // Check database connection
        const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
        let dbLatency = null;
        
        if (dbStatus === 'connected') {
            const start = Date.now();
            await mongoose.connection.db.admin().ping();
            dbLatency = Date.now() - start;
        }
        
        // Check Redis connection
        const redisStatus = await cacheService.isHealthy() ? 'connected' : 'disconnected';
        
        // System metrics
        const systemMetrics = {
            hostname: os.hostname(),
            platform: os.platform(),
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            loadAverage: os.loadavg(),
            uptime: os.uptime()
        };
        
        // Process metrics
        const processMetrics = {
            pid: process.pid,
            version: process.version,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage()
        };
        
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: require('../../package.json').version,
            environment: process.env.NODE_ENV,
            services: {
                database: {
                    status: dbStatus,
                    latency: dbLatency
                },
                redis: {
                    status: redisStatus
                }
            },
            system: systemMetrics,
            process: processMetrics
        };
        
        // Determine overall health
        if (dbStatus !== 'connected' || redisStatus !== 'connected') {
            health.status = 'degraded';
        }
        
        const statusCode = health.status === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
        
    } catch (error) {
        logger.error('Detailed health check failed', { error: error.message });
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Liveness probe (for Kubernetes)
router.get('/health/live', (req, res) => {
    res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString()
    });
});

// Readiness probe (for Kubernetes)
router.get('/health/ready', async (req, res) => {
    try {
        // Check if database is ready
        const dbReady = mongoose.connection.readyState === 1;
        
        // Check if Redis is ready (optional)
        const redisReady = await cacheService.isHealthy();
        
        if (dbReady) {
            res.status(200).json({
                status: 'ready',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(503).json({
                status: 'not_ready',
                reason: 'Database connection not established',
                timestamp: new Date().toISOString()
            });
        }
    } catch (error) {
        res.status(503).json({
            status: 'not_ready',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Metrics endpoint (Prometheus format)
router.get('/metrics', async (req, res) => {
    try {
        const metrics = [];
        
        // Process metrics
        const memUsage = process.memoryUsage();
        metrics.push(`# HELP nodejs_heap_size_total_bytes Process heap size`);
        metrics.push(`# TYPE nodejs_heap_size_total_bytes gauge`);
        metrics.push(`nodejs_heap_size_total_bytes ${memUsage.heapTotal}`);
        
        metrics.push(`# HELP nodejs_heap_size_used_bytes Process heap used`);
        metrics.push(`# TYPE nodejs_heap_size_used_bytes gauge`);
        metrics.push(`nodejs_heap_size_used_bytes ${memUsage.heapUsed}`);
        
        metrics.push(`# HELP nodejs_external_memory_bytes Process external memory`);
        metrics.push(`# TYPE nodejs_external_memory_bytes gauge`);
        metrics.push(`nodejs_external_memory_bytes ${memUsage.external}`);
        
        // Process uptime
        metrics.push(`# HELP nodejs_process_uptime_seconds Process uptime`);
        metrics.push(`# TYPE nodejs_process_uptime_seconds gauge`);
        metrics.push(`nodejs_process_uptime_seconds ${process.uptime()}`);
        
        // System metrics
        metrics.push(`# HELP nodejs_os_free_memory_bytes OS free memory`);
        metrics.push(`# TYPE nodejs_os_free_memory_bytes gauge`);
        metrics.push(`nodejs_os_free_memory_bytes ${os.freemem()}`);
        
        metrics.push(`# HELP nodejs_os_total_memory_bytes OS total memory`);
        metrics.push(`# TYPE nodejs_os_total_memory_bytes gauge`);
        metrics.push(`nodejs_os_total_memory_bytes ${os.totalmem()}`);
        
        // Load average
        const loadAvg = os.loadavg();
        metrics.push(`# HELP nodejs_os_loadavg_1m OS load average 1m`);
        metrics.push(`# TYPE nodejs_os_loadavg_1m gauge`);
        metrics.push(`nodejs_os_loadavg_1m ${loadAvg[0]}`);
        
        metrics.push(`# HELP nodejs_os_loadavg_5m OS load average 5m`);
        metrics.push(`# TYPE nodejs_os_loadavg_5m gauge`);
        metrics.push(`nodejs_os_loadavg_5m ${loadAvg[1]}`);
        
        metrics.push(`# HELP nodejs_os_loadavg_15m OS load average 15m`);
        metrics.push(`# TYPE nodejs_os_loadavg_15m gauge`);
        metrics.push(`nodejs_os_loadavg_15m ${loadAvg[2]}`);
        
        // Database status
        const dbConnected = mongoose.connection.readyState === 1 ? 1 : 0;
        metrics.push(`# HELP gmap_database_connected Database connection status`);
        metrics.push(`# TYPE gmap_database_connected gauge`);
        metrics.push(`gmap_database_connected ${dbConnected}`);
        
        // Application version
        const version = require('../../package.json').version.replace(/\./g, '');
        metrics.push(`# HELP gmap_app_info Application information`);
        metrics.push(`# TYPE gmap_app_info gauge`);
        metrics.push(`gmap_app_info{version="${require('../../package.json').version}",env="${process.env.NODE_ENV}"} 1`);
        
        res.set('Content-Type', 'text/plain');
        res.send(metrics.join('\n'));
        
    } catch (error) {
        logger.error('Metrics generation failed', { error: error.message });
        res.status(500).json({ error: 'Failed to generate metrics' });
    }
});

// Version endpoint
router.get('/version', (req, res) => {
    const packageInfo = require('../../package.json');
    res.json({
        name: packageInfo.name,
        version: packageInfo.version,
        description: packageInfo.description,
        node: process.version,
        environment: process.env.NODE_ENV
    });
});

module.exports = router;
