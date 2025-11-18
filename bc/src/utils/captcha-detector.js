/**
 * 🛡️ CAPTCHA Detector
 * Detects when Google shows bot detection pages
 */

class CaptchaDetector {
    constructor(options = {}) {
        this.totalDetections = 0;
        this.maxDetectionsBeforeStop = options.maxDetectionsBeforeStop || 3;
    }

    /**
     * Detect if current page is CAPTCHA/bot detection
     */
    async detect(page) {
        try {
            const url = page.url();
            const content = await page.content();
            
            // Detection patterns
            const patterns = [
                'unusual traffic from your computer network',
                'not a robot',
                'g.co/bot',
                'google.com/sorry',
                'recaptcha',
                'Our systems have detected'
            ];

            // Check URL
            if (url.includes('google.com/sorry') || url.includes('recaptcha')) {
                this.totalDetections++;
                return true;
            }

            // Check content
            for (const pattern of patterns) {
                if (content.toLowerCase().includes(pattern.toLowerCase())) {
                    this.totalDetections++;
                    return true;
                }
            }

            return false;

        } catch (error) {
            return false;
        }
    }

    /**
     * Backward compatible alias used by scraper code
     */
    async detectCaptcha(page) {
        return this.detect(page);
    }

    /**
     * Provide remediation steps in console to help the operator
     */
    showHelp() {
        console.log('\n🚨 CAPTCHA detected! Tips to recover:');
        console.log('   • Pause scraping for a few minutes to let Google cool down.');
        console.log('   • Reduce parallel workers or enable headless=false to solve manually.');
        console.log('   • Change IP/VPN if the block persists.');
    }

    /**
     * Decide if scraping should stop automatically
     */
    shouldStopScraping() {
        return this.totalDetections >= this.maxDetectionsBeforeStop;
    }

    /**
     * Reset counter
     */
    reset() {
        this.totalDetections = 0;
    }

    /**
     * Get current count
     */
    getCount() {
        return this.totalDetections;
    }
}

// Singleton
const captchaDetector = new CaptchaDetector();

module.exports = { captchaDetector };
