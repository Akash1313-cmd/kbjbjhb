/**
 * CAPTCHA Detector - Detect and handle CAPTCHAs
 */

const logger = require('../../utils/scraper-logger');

class CaptchaDetector {
    constructor() {
        this.detectionCount = 0;
        this.lastDetection = null;
    }

    async detect(page) {
        try {
            const html = await page.content();
            return this.checkForCaptcha(html);
        } catch (error) {
            return false;
        }
    }
    
    async detectCaptcha(page) {
        return this.detect(page);
    }
    
    checkForCaptcha(html) {
        if (!html) return false;
        
        const captchaIndicators = [
            'recaptcha',
            'g-recaptcha',
            'captcha',
            'challenge-form',
            'Are you a robot',
            'not a robot',
            'verify you are human'
        ];
        
        const htmlLower = html.toLowerCase();
        const detected = captchaIndicators.some(indicator => htmlLower.includes(indicator));
        
        if (detected) {
            this.detectionCount++;
            this.lastDetection = new Date();
        }
        
        return detected;
    }
    
    shouldStopScraping() {
        return this.detectionCount > 3;
    }
    
    showHelp() {
        logger.warn('CAPTCHA detected! Please manually solve it in the browser window.');
    }

    getCount() {
        return this.detectionCount;
    }

    reset() {
        this.detectionCount = 0;
        this.lastDetection = null;
    }
}

// Singleton instance
const captchaDetector = new CaptchaDetector();

module.exports = {
    CaptchaDetector,
    captchaDetector
};
