/**
 * Configuration Loader
 * Loads and validates configuration with backward compatibility
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('./logger');

class ConfigLoader {
    constructor() {
        this.config = null;
        this.configPath = path.join(__dirname, '../../config/config.json');
    }
    
    /**
     * Load configuration with backward compatibility
     */
    load() {
        try {
            const rawConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
            
            // Check if it's the new structured format
            if (rawConfig.workers || rawConfig.browser || rawConfig.scraping) {
                this.config = this.normalizeNewFormat(rawConfig);
            } else {
                // Old flat format - convert to new structure
                this.config = this.convertOldFormat(rawConfig);
            }
            
            // Apply defaults for missing values
            this.applyDefaults();
            
            // Validate configuration
            this.validate();
            
            logger.info('Configuration loaded successfully');
            return this.config;
            
        } catch (error) {
            logger.error('Failed to load configuration', { error: error.message });
            return this.getDefaults();
        }
    }
    
    /**
     * Normalize new structured format
     */
    normalizeNewFormat(config) {
        return {
            // Browser settings
            headless: config.browser?.headless ?? false,
            windowWidth: config.browser?.windowWidth ?? 800,
            windowHeight: config.browser?.windowHeight ?? 900,
            blockImages: config.browser?.blockImages ?? true,
            blockMedia: config.browser?.blockMedia ?? true,
            
            // Worker settings
            parallelWorkers: config.workers?.parallelWorkers ?? 5,
            maxWorkers: config.workers?.maxWorkers ?? 10,
            minWorkers: config.workers?.minWorkers ?? 2,
            linkExtractionWorkers: config.workers?.linkExtractionWorkers ?? 3,
            
            // Scraping settings
            scrollTimeout: config.scraping?.scrollTimeout ?? 60000,
            smartScrolling: config.scraping?.smartScrolling ?? true,
            maxLinksPerKeyword: config.scraping?.maxLinksPerKeyword ?? 120,
            timeout: config.scraping?.timeout ?? 30000,
            retryAttempts: config.scraping?.retryAttempts ?? 3,
            retryDelay: config.scraping?.retryDelay ?? 2000,
            
            // Output settings
            outputDir: this.expandPath(config.output?.outputDir ?? './results'),
            generateExcel: config.output?.generateExcel ?? true,
            generateJSON: config.output?.generateJSON ?? true,
            
            // Phone settings
            phoneDefaultCountry: config.phone?.defaultCountry ?? 'IN',
            phoneEnableInternational: config.phone?.enableInternational ?? true,
            phoneSupportedCountries: config.phone?.supportedCountries ?? ['IN', 'US', 'GB', 'AU', 'AE'],
            
            // Features
            enableErrorLogging: config.features?.enableErrorLogging ?? true,
            enableResume: config.features?.enableResume ?? true,
            parallelPipeline: config.features?.parallelPipeline ?? true,
            enableWebSocket: config.features?.enableWebSocket ?? true,
            
            // Performance
            browserRestartInterval: config.performance?.browserRestartInterval ?? 20,
            rateLimitDelay: config.performance?.rateLimitDelay ?? 1000,
            adaptiveRateLimiting: config.performance?.adaptiveRateLimiting ?? true
        };
    }
    
    /**
     * Convert old flat format to new structure
     */
    convertOldFormat(config) {
        logger.info('Converting old configuration format to new structure');
        
        return {
            headless: config.headless ?? false,
            windowWidth: 800,
            windowHeight: 900,
            blockImages: true,
            blockMedia: true,
            
            parallelWorkers: config.parallelWorkers ?? 5,
            maxWorkers: config.maxWorkers ?? 10,
            minWorkers: config.minWorkers ?? 2,
            linkExtractionWorkers: config.linkExtractionWorkers ?? 3,
            
            scrollTimeout: config.scrollTimeout ?? 60000,
            smartScrolling: config.smartScrolling ?? false,
            maxLinksPerKeyword: config.maxLinksPerKeyword ?? 50,
            timeout: config.timeout ?? 20000,
            retryAttempts: config.retryAttempts ?? 2,
            retryDelay: config.retryDelay ?? 2000,
            
            outputDir: this.expandPath(config.outputDir ?? './results'),
            generateExcel: true,
            generateJSON: true,
            
            phoneDefaultCountry: 'IN',
            phoneEnableInternational: true,
            phoneSupportedCountries: ['IN', 'US', 'GB', 'AU', 'AE'],
            
            enableErrorLogging: config.enableErrorLogging ?? true,
            enableResume: config.enableResume ?? true,
            parallelPipeline: config.parallelPipeline ?? true,
            enableWebSocket: true,
            
            browserRestartInterval: config.browserRestartInterval ?? 20,
            rateLimitDelay: config.rateLimitDelay ?? 1000,
            adaptiveRateLimiting: config.adaptiveRateLimiting ?? true
        };
    }
    
    /**
     * Apply defaults for any missing values
     */
    applyDefaults() {
        const defaults = this.getDefaults();
        
        for (const [key, value] of Object.entries(defaults)) {
            if (this.config[key] === undefined) {
                this.config[key] = value;
            }
        }
    }
    
    /**
     * Get default configuration
     */
    getDefaults() {
        return {
            headless: false,
            windowWidth: 800,
            windowHeight: 900,
            blockImages: true,
            blockMedia: true,
            
            parallelWorkers: 5,
            maxWorkers: 10,
            minWorkers: 2,
            linkExtractionWorkers: 3,
            
            scrollTimeout: 60000,
            smartScrolling: true,
            maxLinksPerKeyword: 120,
            timeout: 30000,
            retryAttempts: 3,
            retryDelay: 2000,
            
            outputDir: path.join(__dirname, '..', '..', 'results'),
            generateExcel: true,
            generateJSON: true,
            
            phoneDefaultCountry: 'IN',
            phoneEnableInternational: true,
            phoneSupportedCountries: ['IN', 'US', 'GB', 'AU', 'AE'],
            
            enableErrorLogging: true,
            enableResume: true,
            parallelPipeline: true,
            enableWebSocket: true,
            
            browserRestartInterval: 20,
            rateLimitDelay: 1000,
            adaptiveRateLimiting: true
        };
    }
    
    /**
     * Validate configuration
     */
    validate() {
        const errors = [];
        
        if (this.config.parallelWorkers < 1) {
            errors.push('parallelWorkers must be at least 1');
        }
        
        if (this.config.maxWorkers < this.config.parallelWorkers) {
            errors.push('maxWorkers must be >= parallelWorkers');
        }
        
        if (this.config.retryAttempts < 0 || this.config.retryAttempts > 10) {
            errors.push('retryAttempts must be between 0 and 10');
        }
        
        if (errors.length > 0) {
            logger.warn('Configuration validation warnings', { errors });
        }
    }
    
    /**
     * Expand path with ~ and environment variables
     */
    expandPath(filepath) {
        if (!filepath) return filepath;
        
        // Expand ~
        if (filepath.startsWith('~')) {
            filepath = filepath.replace('~', os.homedir());
        }
        
        // Expand environment variables
        filepath = filepath.replace(/\$\{(\w+)\}/g, (match, env) => {
            return process.env[env] || match;
        });
        
        return filepath;
    }
    
    /**
     * Get current configuration
     */
    get() {
        if (!this.config) {
            return this.load();
        }
        return this.config;
    }
    
    /**
     * Reload configuration
     */
    reload() {
        this.config = null;
        return this.load();
    }
}

// Export singleton instance
module.exports = new ConfigLoader();
