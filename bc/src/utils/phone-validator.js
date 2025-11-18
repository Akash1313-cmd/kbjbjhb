/**
 * International Phone Number Validation
 * Supports multiple countries and formats
 */

const PHONE_PATTERNS = {
    // India
    IN: {
        pattern: /(?:\+91|91|0)?[\s-]?[6-9]\d{9}/g,
        minLength: 10,
        maxLength: 13,
        format: (digits) => `+91 ${digits.slice(-10).slice(0, 5)} ${digits.slice(-5)}`
    },
    
    // USA/Canada
    US: {
        pattern: /(?:\+1|1)?[\s-]?\(?[2-9]\d{2}\)?[\s-]?\d{3}[\s-]?\d{4}/g,
        minLength: 10,
        maxLength: 11,
        format: (digits) => `+1 ${digits.slice(-10).slice(0, 3)} ${digits.slice(-7, -4)} ${digits.slice(-4)}`
    },
    
    // UK
    GB: {
        pattern: /(?:\+44|44|0)?[\s-]?\d{10}/g,
        minLength: 10,
        maxLength: 13,
        format: (digits) => `+44 ${digits.slice(-10)}`
    },
    
    // Australia
    AU: {
        pattern: /(?:\+61|61|0)?[\s-]?[2-478]\d{8}/g,
        minLength: 9,
        maxLength: 11,
        format: (digits) => `+61 ${digits.slice(-9)}`
    },
    
    // UAE
    AE: {
        pattern: /(?:\+971|971|0)?[\s-]?5[0-9]{8}/g,
        minLength: 9,
        maxLength: 12,
        format: (digits) => `+971 ${digits.slice(-9)}`
    },
    
    // Generic international
    INTL: {
        pattern: /\+\d{1,4}[\s-]?\d{6,14}/g,
        minLength: 7,
        maxLength: 15,
        format: (digits) => digits
    }
};

/**
 * Extract phone numbers from text with international support
 */
function extractPhoneNumbers(text, country = 'IN') {
    const phones = new Set();
    
    // Try specific country pattern first
    if (PHONE_PATTERNS[country]) {
        const pattern = PHONE_PATTERNS[country].pattern;
        const matches = text.matchAll(new RegExp(pattern.source, 'g'));
        
        for (const match of matches) {
            const cleaned = cleanPhoneNumber(match[0]);
            if (isValidPhone(cleaned, country)) {
                phones.add(cleaned);
            }
        }
    }
    
    // If no matches, try all patterns
    if (phones.size === 0) {
        for (const [code, config] of Object.entries(PHONE_PATTERNS)) {
            const matches = text.matchAll(new RegExp(config.pattern.source, 'g'));
            
            for (const match of matches) {
                const cleaned = cleanPhoneNumber(match[0]);
                if (isValidPhone(cleaned, code)) {
                    phones.add(cleaned);
                }
            }
        }
    }
    
    return Array.from(phones);
}

/**
 * Clean phone number
 */
function cleanPhoneNumber(phone) {
    return phone.replace(/[\s()-]/g, '');
}

/**
 * Validate phone number for specific country
 */
function isValidPhone(phone, country = 'IN') {
    const config = PHONE_PATTERNS[country];
    if (!config) return false;
    
    const digits = phone.replace(/\D/g, '');
    return digits.length >= config.minLength && digits.length <= config.maxLength;
}

/**
 * Format phone number for display
 */
function formatPhone(phone, country = 'IN') {
    const config = PHONE_PATTERNS[country];
    if (!config) return phone;
    
    const digits = phone.replace(/\D/g, '');
    return config.format(digits);
}

/**
 * Detect phone number country
 */
function detectCountry(phone) {
    const cleaned = cleanPhoneNumber(phone);
    
    for (const [code, config] of Object.entries(PHONE_PATTERNS)) {
        if (new RegExp(config.pattern).test(phone) && isValidPhone(cleaned, code)) {
            return code;
        }
    }
    
    return 'UNKNOWN';
}

module.exports = {
    extractPhoneNumbers,
    cleanPhoneNumber,
    isValidPhone,
    formatPhone,
    detectCountry,
    PHONE_PATTERNS
};
