/**
 * Input Validation Utilities
 * Reusable validation functions for the API
 */

const validateEmail = (email) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
};

const validateKeywords = (keywords) => {
    if (!Array.isArray(keywords)) {
        return { valid: false, error: 'keywords must be an array' };
    }
    
    if (keywords.length === 0) {
        return { valid: false, error: 'keywords cannot be empty' };
    }
    
    if (keywords.length > 50) {
        return { valid: false, error: 'Maximum 50 keywords allowed' };
    }
    
    for (const kw of keywords) {
        if (typeof kw !== 'string' || kw.trim().length === 0) {
            return { valid: false, error: 'All keywords must be non-empty strings' };
        }
        
        if (kw.length > 200) {
            return { valid: false, error: 'Each keyword must be less than 200 characters' };
        }
    }
    
    return { valid: true };
};

const validatePassword = (password) => {
    const MIN_PASSWORD_LENGTH = 8;
    
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
        return { 
            valid: false, 
            error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` 
        };
    }
    
    // Check against common weak passwords
    const weakPasswords = ['password', '12345678', 'admin123', 'qwerty'];
    if (weakPasswords.includes(password.toLowerCase())) {
        return { 
            valid: false, 
            error: 'Password is too weak. Please choose a stronger password.' 
        };
    }
    
    return { valid: true };
};

module.exports = {
    validateEmail,
    validateKeywords,
    validatePassword
};
