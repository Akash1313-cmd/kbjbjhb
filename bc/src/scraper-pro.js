/**
 * Google Maps Scraper - Professional Edition
 * 
 * Modular architecture - Main entry point
 * All scraping logic has been organized into focused modules
 */

// Core orchestration
const { processKeywords } = require('./scraper/core/processor');

// Extractors
const { extractPhoneNumbers } = require('./scraper/extractors/phone-extractor');

// Core scraping functions
const { extractPlaceLinksStreaming } = require('./scraper/core/link-extractor');
const { scrapePlaceInTab } = require('./scraper/core/data-scraper');

// Utilities
const { saveToJSON, loadKeywordsFromFile } = require('./scraper/utils/file-operations');
const { clearPageData } = require('./scraper/browser/cleaner');

// Middleware
const { setupRequestInterception } = require('./scraper/middleware/request-interceptor');

/**
 * Main CLI entry point
 */
async function main() {
    // Check for command line argument (keywords file)
    const keywordsFile = process.argv[2] || 'keywords.txt';
    
    let keywords = loadKeywordsFromFile(keywordsFile);
    
    // Fallback to hardcoded keywords if file not found
    if (!keywords) {
        console.log('📝 Using default keywords...');
        keywords = [
            'restaurants in Mumbai',
            'coffee shops in Delhi',
            'hotels in Bangalore'
        ];
    } else {
        console.log(`📂 Loaded ${keywords.length} keywords from ${keywordsFile}`);
    }
    
    try {
        await processKeywords(keywords);
    } catch (error) {
        console.error('\n💥 Fatal Error:', error);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

// Export API functions for backward compatibility
module.exports = { 
    processKeywords, 
    extractPhoneNumbers,
    // Export for pipeline mode
    setupRequestInterception,
    extractPlaceLinksStreaming,
    scrapePlaceInTab,
    saveToJSON,
    clearPageData
};
