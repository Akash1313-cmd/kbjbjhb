/**
 * Export Service
 * Convert results to CSV/Excel formats
 */

const ExcelJS = require('exceljs');

class ExportService {
  /**
   * Convert results to CSV format
   * @param {Object} results - Results object with keywords as keys
   * @returns {String} CSV formatted string
   */
  toCSV(results) {
    const rows = [];
    rows.push(['Name', 'Phone', 'Address', 'Rating', 'Reviews', 'Website', 'Keyword']);
    
    for (const [keyword, places] of Object.entries(results)) {
      for (const place of places) {
        rows.push([
          this.escapeCSV(place.name || ''),
          this.escapeCSV(place.phone || ''),
          this.escapeCSV(place.address || ''),
          place.rating || '',
          place.reviews || '',
          this.escapeCSV(place.website || ''),
          this.escapeCSV(keyword)
        ]);
      }
    }
    
    return rows.map(row => row.join(',')).join('\n');
  }

  /**
   * Escape CSV special characters
   * @param {String} str - String to escape
   * @returns {String} Escaped string
   */
  escapeCSV(str) {
    if (typeof str !== 'string') return str;
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * Convert results to Excel format
   * @param {Object} results - Results object with keywords as keys
   * @returns {Promise<Buffer>} Excel file buffer
   */
  async toExcel(results) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Results');
    
    // Define columns
    worksheet.columns = [
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Phone', key: 'phone', width: 20 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Reviews', key: 'reviews', width: 10 },
      { header: 'Website', key: 'website', width: 30 },
      { header: 'Keyword', key: 'keyword', width: 25 }
    ];
    
    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };
    
    // Add data rows
    for (const [keyword, places] of Object.entries(results)) {
      for (const place of places) {
        worksheet.addRow({
          name: place.name || '',
          phone: place.phone || '',
          address: place.address || '',
          rating: place.rating || '',
          reviews: place.reviews || '',
          website: place.website || '',
          keyword
        });
      }
    }
    
    return await workbook.xlsx.writeBuffer();
  }
}

module.exports = new ExportService();
