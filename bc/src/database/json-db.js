/**
 * Simple JSON File-Based Database
 * Replaces MongoDB with a simple db.json file
 */

const fs = require('fs');
const path = require('path');

class JsonDB {
  constructor(filePath) {
    this.filePath = filePath;
    this.ensureFile();
    this.idCounters = {}; // Track auto-increment IDs per collection
  }

  /**
   * Ensure database file exists
   */
  ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      const initialData = {
        users: [],
        jobs: [],
        places: [],
        apiKeys: []
      };
      fs.writeFileSync(this.filePath, JSON.stringify(initialData, null, 2), 'utf8');
    }
  }

  /**
   * Read database
   */
  read() {
    try {
      const data = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error reading database:', error.message);
      return {
        users: [],
        jobs: [],
        places: [],
        apiKeys: []
      };
    }
  }

  /**
   * Write database (with pretty formatting)
   */
  write(data) {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Error writing database:', error.message);
      return false;
    }
  }

  /**
   * Generate auto-increment ID for a collection
   */
  generateId(collection) {
    const db = this.read();
    const items = db[collection] || [];
    
    if (items.length === 0) {
      return 1;
    }
    
    // Find max ID
    const maxId = items.reduce((max, item) => {
      const itemId = parseInt(item.id) || 0;
      return itemId > max ? itemId : max;
    }, 0);
    
    return maxId + 1;
  }

  /**
   * Find single record
   * @param {string} collection - Collection name
   * @param {object} query - Query object (e.g., { email: 'user@example.com' })
   * @returns {object|null} - Found record or null
   */
  findOne(collection, query) {
    const db = this.read();
    const items = db[collection] || [];
    
    return items.find(item => {
      return Object.keys(query).every(key => {
        // Handle nested properties (e.g., 'userId._id')
        if (key.includes('.')) {
          const keys = key.split('.');
          let value = item;
          for (const k of keys) {
            value = value?.[k];
          }
          return value === query[key];
        }
        
        // Handle MongoDB ObjectId comparison
        if (key === '_id' && item._id) {
          return item._id.toString() === query[key].toString();
        }
        
        return item[key] === query[key];
      });
    }) || null;
  }

  /**
   * Find multiple records
   * @param {string} collection - Collection name
   * @param {object} query - Query object (optional, empty = all)
   * @returns {array} - Array of matching records
   */
  find(collection, query = {}) {
    const db = this.read();
    const items = db[collection] || [];
    
    if (Object.keys(query).length === 0) {
      return items;
    }
    
    return items.filter(item => {
      return Object.keys(query).every(key => {
        // Handle MongoDB ObjectId comparison
        if (key === '_id' || key === 'userId') {
          return item[key]?.toString() === query[key]?.toString();
        }
        return item[key] === query[key];
      });
    });
  }

  /**
   * Insert record
   * @param {string} collection - Collection name
   * @param {object} data - Data to insert
   * @returns {object} - Inserted record with generated _id
   */
  insert(collection, data) {
    const db = this.read();
    
    if (!db[collection]) {
      db[collection] = [];
    }
    
    // Generate ID if not provided
    if (!data._id) {
      data._id = this.generateId(collection);
    }
    
    // Add timestamps
    if (!data.createdAt) {
      data.createdAt = new Date().toISOString();
    }
    if (!data.updatedAt) {
      data.updatedAt = new Date().toISOString();
    }
    
    db[collection].push(data);
    this.write(db);
    
    return data;
  }

  /**
   * Update record(s)
   * @param {string} collection - Collection name
   * @param {object} query - Query to find records
   * @param {object} updates - Updates to apply
   * @param {object} options - Options (e.g., { multi: true })
   * @returns {object} - Result with modifiedCount
   */
  update(collection, query, updates, options = {}) {
    const db = this.read();
    const items = db[collection] || [];
    let modifiedCount = 0;
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const matches = Object.keys(query).every(key => {
        // Handle MongoDB ObjectId comparison
        if (key === '_id' || key === 'userId') {
          return item[key]?.toString() === query[key]?.toString();
        }
        return item[key] === query[key];
      });
      
      if (matches) {
        // Apply updates
        Object.keys(updates).forEach(key => {
          if (key === '$set') {
            Object.assign(items[i], updates[key]);
          } else {
            items[i][key] = updates[key];
          }
        });
        
        // Update timestamp
        items[i].updatedAt = new Date().toISOString();
        modifiedCount++;
        
        // If not multi, stop after first match
        if (!options.multi) {
          break;
        }
      }
    }
    
    if (modifiedCount > 0) {
      db[collection] = items;
      this.write(db);
    }
    
    return { modifiedCount };
  }

  /**
   * Delete record(s)
   * @param {string} collection - Collection name
   * @param {object} query - Query to find records to delete
   * @returns {object} - Result with deletedCount
   */
  delete(collection, query) {
    const db = this.read();
    const items = db[collection] || [];
    const originalLength = items.length;
    
    db[collection] = items.filter(item => {
      return !Object.keys(query).every(key => {
        // Handle MongoDB ObjectId comparison
        if (key === '_id' || key === 'userId') {
          return item[key]?.toString() === query[key]?.toString();
        }
        return item[key] === query[key];
      });
    });
    
    const deletedCount = originalLength - db[collection].length;
    
    if (deletedCount > 0) {
      this.write(db);
    }
    
    return { deletedCount };
  }

  /**
   * Count documents in collection
   * @param {string} collection - Collection name
   * @param {object} query - Query object (optional)
   * @returns {number} - Count of matching documents
   */
  countDocuments(collection, query = {}) {
    const items = this.find(collection, query);
    return items.length;
  }

  /**
   * Advanced query with sorting, limiting, and skipping
   * @param {string} collection - Collection name
   * @param {object} query - Query object
   * @param {object} options - Options (sort, limit, skip)
   * @returns {array} - Array of matching records
   */
  findWithOptions(collection, query = {}, options = {}) {
    let items = this.find(collection, query);
    
    // Sort
    if (options.sort) {
      const sortField = Object.keys(options.sort)[0];
      const sortOrder = options.sort[sortField]; // 1 for asc, -1 for desc
      
      items.sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        
        if (aVal < bVal) return sortOrder === 1 ? -1 : 1;
        if (aVal > bVal) return sortOrder === 1 ? 1 : -1;
        return 0;
      });
    }
    
    // Skip
    if (options.skip) {
      items = items.slice(options.skip);
    }
    
    // Limit
    if (options.limit) {
      items = items.slice(0, options.limit);
    }
    
    return items;
  }

  /**
   * Backup database
   * @param {string} backupDir - Directory to store backups
   */
  backup(backupDir) {
    try {
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const backupPath = path.join(backupDir, `db-backup-${timestamp}.json`);
      
      const data = this.read();
      fs.writeFileSync(backupPath, JSON.stringify(data, null, 2), 'utf8');
      
      // Clean old backups (keep last 7)
      const backupFiles = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('db-backup-'))
        .sort()
        .reverse();
      
      if (backupFiles.length > 7) {
        backupFiles.slice(7).forEach(file => {
          fs.unlinkSync(path.join(backupDir, file));
        });
      }
      
      return backupPath;
    } catch (error) {
      console.error('Backup failed:', error.message);
      return null;
    }
  }
}

// Create singleton instance
const dbPath = path.join(__dirname, 'db.json');
const db = new JsonDB(dbPath);

// Export both the instance and the class
module.exports = db;
module.exports.JsonDB = JsonDB;
