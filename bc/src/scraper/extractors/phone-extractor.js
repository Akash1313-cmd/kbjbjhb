/**
 * Phone number extraction utilities
 */

const phoneValidator = require('../../utils/phone-validator');
const { CONFIG } = require('../config/config-loader');

/**
 * Extract phone numbers from text with international support
 * @param {string} text - Text to extract phone numbers from
 * @param {string} country - Country code (default: 'IN')
 * @returns {Array<string>} Array of phone numbers
 */
function extractPhoneNumbers(text, country = 'IN') {
    // Use the new international phone validator
    const phones = phoneValidator.extractPhoneNumbers(text, country);
    
    // Fallback to old pattern if no phones found
    if (phones.length === 0 && CONFIG.phonePattern) {
        const matches = text.matchAll(CONFIG.phonePattern);
        const seen = new Set();
        
        for (const match of matches) {
            let clean = match[0].replace(/[\s-]/g, '');
            if (clean.startsWith('0')) clean = clean.substring(1);
            if (!seen.has(clean) && clean.length === 10) {
                seen.add(clean);
                phones.push(clean);
            }
        }
    }
    
    return phones;
}

/**
 * Extract ONLY business phone number from specific elements (not entire page)
 * @param {Page} page - Puppeteer page instance
 * @returns {Promise<Array<string>>} Array of phone numbers
 */
async function extractBusinessPhone(page) {
    try {
        const phones = await page.evaluate(() => {
            const phoneNumbers = [];
            
            // Method 1: Phone button with aria-label
            const phoneButtons = document.querySelectorAll('button[data-item-id*="phone"], button[aria-label*="Phone"], button[aria-label*="phone"]');
            for (const btn of phoneButtons) {
                const ariaLabel = btn.getAttribute('aria-label') || '';
                const text = btn.textContent || '';
                const combined = ariaLabel + ' ' + text;
                
                // Extract only phone-like patterns
                const phonePattern = /(?:\+?\d{1,4}[\s-]?)?(?:\(?\d{1,4}\)?[\s-]?)?[\d\s-]{8,15}/g;
                const matches = combined.match(phonePattern);
                if (matches) {
                    phoneNumbers.push(...matches);
                }
            }
            
            // Method 2: Specific phone containers
            const phoneContainers = document.querySelectorAll('[data-tooltip*="phone"], [class*="phone"], .rogA2c');
            for (const container of phoneContainers) {
                const text = container.textContent || '';
                const phonePattern = /(?:\+?\d{1,4}[\s-]?)?(?:\(?\d{1,4}\)?[\s-]?)?[\d\s-]{8,15}/g;
                const matches = text.match(phonePattern);
                if (matches) {
                    phoneNumbers.push(...matches);
                }
            }
            
            // Return unique phone numbers (first 3 max)
            const unique = [...new Set(phoneNumbers)];
            return unique.slice(0, 3); // Limit to 3 phone numbers max
        });
        
        // Clean and validate extracted phones
        const cleanedPhones = [];
        const seenPhones = new Set(); // Track duplicates after cleaning
        
        for (const phone of phones) {
            let cleaned = phone.replace(/[^0-9+]/g, '');
            
            // Remove leading 0 from phone numbers (except if it's international format with +)
            if (cleaned.startsWith('0') && !cleaned.startsWith('+')) {
                cleaned = cleaned.substring(1);
            }
            
            // Only accept if length is reasonable (8-15 digits) and not duplicate
            if (cleaned.length >= 8 && cleaned.length <= 15 && !seenPhones.has(cleaned)) {
                cleanedPhones.push(cleaned);
                seenPhones.add(cleaned);
            }
        }
        
        return cleanedPhones;
    } catch (error) {
        return [];
    }
}

module.exports = {
    extractPhoneNumbers,
    extractBusinessPhone
};
