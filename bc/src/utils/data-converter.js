/**
 * Data Converter Utilities
 * CSV and other format converters
 */

/**
 * Convert job results data to CSV format
 * @param {Object} data - Results data with keyword -> places mapping
 * @returns {string} CSV formatted data
 */
function convertToCSV(data) {
    // Simple CSV converter
    const headers = ['Name', 'Phone', 'Rating', 'Reviews', 'Category', 'Address', 'Website'];
    const rows = [];
    
    for (const [keyword, places] of Object.entries(data)) {
        for (const place of places) {
            rows.push([
                place.name,
                place.phone,
                place.rating,
                place.reviews,
                place.category,
                place.address,
                place.website
            ].map(v => `"${v}"`).join(','));
        }
    }
    
    return [headers.join(','), ...rows].join('\n');
}

module.exports = {
    convertToCSV
};
