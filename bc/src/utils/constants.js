/**
 * Application Constants
 * Centralized configuration values
 */

module.exports = {
    // Scraper constants
    SCROLL_AMOUNT: 5000,
    SCROLL_DELAY_MIN: 1000,
    SCROLL_DELAY_MAX: 2000,
    MAX_SCROLL_IDLE_TIME_SECONDS: 60,
    MAX_CONSECUTIVE_NO_NEW_LINKS: 3,
    PAGE_LOAD_WAIT: 3000,
    PLACE_LOAD_WAIT: 1500,
    
    // Browser constants
    BROWSER_RESTART_INTERVAL: 40,
    DEFAULT_VIEWPORT_WIDTH: 400,
    DEFAULT_VIEWPORT_HEIGHT: 900,
    DEFAULT_TIMEOUT: 30000,
    NAVIGATION_TIMEOUT: 45000,
    
    // Worker constants
    DEFAULT_WORKERS: 5,
    MIN_WORKERS: 1,
    MAX_WORKERS: 999,  // Unlimited support
    WORKER_QUEUE_CHECK_INTERVAL: 300,
    
    // Retry constants
    DEFAULT_RETRY_ATTEMPTS: 3,
    RETRY_BASE_DELAY: 1000,
    
    // API constants
    DEFAULT_PAGE_SIZE: 10,
    MAX_PAGE_SIZE: 100,
    
    // File paths
    PROGRESS_FILE: 'scraper-progress.json',
    ERROR_LOG_FILE: 'scraper-errors.log',
    
    // Regex patterns
    PHONE_PATTERN: /\b(?:\+91[\s-]?|0)(?:\d[\s-]?){10}\b/g,
    
    // XPath selectors
    XPATH_PRICE_RANGE: '//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[2]/div[1]/div/div[2]/div/div[2]',
    XPATH_SCROLLER_1: '//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[2]/div[1]',
    XPATH_SCROLLER_2: '//*[@id="QA0Szd"]/div/div/div[1]/div[2]/div/div[1]/div/div/div[1]/div[1]',
    
    // Config validation
    ALLOWED_CONFIG_KEYS: [
        'headless',
        'parallelWorkers',
        'maxWorkers',
        'minWorkers',
        'scrollTimeout',
        'retryAttempts',
        'enableResume',
        'enableErrorLogging',
        'smartScrolling',
        'browserRestartInterval',
        'linkExtractionWorkers',
        'maxLinksPerKeyword',
        'timeout'
    ]
};
