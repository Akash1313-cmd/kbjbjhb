/**
 * Storage Layer
 * Abstraction for data persistence (in-memory with optional Redis)
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('./logger');

class Storage {
    constructor() {
        this.jobs = new Map();
        this.results = new Map();
        this.activeJobs = new Map();
        this.persistenceEnabled = process.env.ENABLE_PERSISTENCE === 'true';
        this.dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
    }
    
    async init() {
        if (this.persistenceEnabled) {
            try {
                await fs.mkdir(this.dataDir, { recursive: true });
                await this.loadFromDisk();
                logger.info('Storage initialized with persistence');
            } catch (error) {
                logger.error('Failed to initialize persistent storage', { error: error.message });
            }
        }
    }
    
    // Job operations
    async setJob(jobId, jobData) {
        this.jobs.set(jobId, jobData);
        
        if (this.persistenceEnabled) {
            await this.saveJobToDisk(jobId, jobData);
        }
    }
    
    getJob(jobId) {
        return this.jobs.get(jobId);
    }
    
    getAllJobs() {
        return Array.from(this.jobs.values());
    }
    
    deleteJob(jobId) {
        const deleted = this.jobs.delete(jobId);
        
        if (this.persistenceEnabled && deleted) {
            this.deleteJobFromDisk(jobId).catch(err => 
                logger.error('Failed to delete job from disk', { jobId, error: err.message })
            );
        }
        
        return deleted;
    }
    
    // Results operations
    async setResults(jobId, results) {
        this.results.set(jobId, results);
        
        if (this.persistenceEnabled) {
            await this.saveResultsToDisk(jobId, results);
        }
    }
    
    getResults(jobId) {
        return this.results.get(jobId);
    }
    
    deleteResults(jobId) {
        const deleted = this.results.delete(jobId);
        
        if (this.persistenceEnabled && deleted) {
            this.deleteResultsFromDisk(jobId).catch(err =>
                logger.error('Failed to delete results from disk', { jobId, error: err.message })
            );
        }
        
        return deleted;
    }
    
    // Active jobs tracking
    setActiveJob(jobId, jobData) {
        this.activeJobs.set(jobId, jobData);
    }
    
    getActiveJob(jobId) {
        return this.activeJobs.get(jobId);
    }
    
    deleteActiveJob(jobId) {
        return this.activeJobs.delete(jobId);
    }
    
    getAllActiveJobs() {
        return Array.from(this.activeJobs.values());
    }
    
    // Persistence methods
    async saveJobToDisk(jobId, jobData) {
        try {
            const jobPath = path.join(this.dataDir, 'jobs', `${jobId}.json`);
            await fs.mkdir(path.dirname(jobPath), { recursive: true });
            await fs.writeFile(jobPath, JSON.stringify(jobData, null, 2));
        } catch (error) {
            logger.error('Failed to save job to disk', { jobId, error: error.message });
        }
    }
    
    async saveResultsToDisk(jobId, results) {
        try {
            const resultsPath = path.join(this.dataDir, 'results', `${jobId}.json`);
            await fs.mkdir(path.dirname(resultsPath), { recursive: true });
            await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
        } catch (error) {
            logger.error('Failed to save results to disk', { jobId, error: error.message });
        }
    }
    
    async deleteJobFromDisk(jobId) {
        try {
            const jobPath = path.join(this.dataDir, 'jobs', `${jobId}.json`);
            await fs.unlink(jobPath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('Failed to delete job from disk', { jobId, error: error.message });
            }
        }
    }
    
    async deleteResultsFromDisk(jobId) {
        try {
            const resultsPath = path.join(this.dataDir, 'results', `${jobId}.json`);
            await fs.unlink(resultsPath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('Failed to delete results from disk', { jobId, error: error.message });
            }
        }
    }
    
    async loadFromDisk() {
        try {
            // Load jobs
            const jobsDir = path.join(this.dataDir, 'jobs');
            await fs.mkdir(jobsDir, { recursive: true });
            const jobFiles = await fs.readdir(jobsDir);
            
            for (const file of jobFiles) {
                if (file.endsWith('.json')) {
                    const jobData = JSON.parse(await fs.readFile(path.join(jobsDir, file), 'utf8'));
                    this.jobs.set(jobData.jobId, jobData);
                }
            }
            
            // Load results
            const resultsDir = path.join(this.dataDir, 'results');
            await fs.mkdir(resultsDir, { recursive: true });
            const resultFiles = await fs.readdir(resultsDir);
            
            for (const file of resultFiles) {
                if (file.endsWith('.json')) {
                    const jobId = file.replace('.json', '');
                    const results = JSON.parse(await fs.readFile(path.join(resultsDir, file), 'utf8'));
                    this.results.set(jobId, results);
                }
            }
            
            logger.info(`Loaded ${this.jobs.size} jobs and ${this.results.size} results from disk`);
        } catch (error) {
            logger.error('Failed to load data from disk', { error: error.message });
        }
    }
}

// Export singleton instance
module.exports = new Storage();
