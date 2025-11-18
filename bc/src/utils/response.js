/**
 * Standardized API Response Utilities
 * Consistent response format across all endpoints
 */

class ApiResponse {
    static success(data, message = null) {
        return {
            success: true,
            data,
            message
        };
    }
    
    static error(error, statusCode = 400, details = null) {
        return {
            success: false,
            error: error,
            details: details,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = ApiResponse;
