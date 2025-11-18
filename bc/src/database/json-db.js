/**
 * Simple JSON Database
 * Provides basic CRUD operations for db.json
 */

const fs = require('fs').promises;
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');

class JsonDB {
  constructor() {
    this.data = { users: [], jobs: [] };
    this.init();
  }

  async init() {
    try {
      const content = await fs.readFile(DB_PATH, 'utf8');
      this.data = JSON.parse(content);
    } catch (error) {
      // If file doesn't exist, create it with default structure
      await this.save();
    }
  }

  async save() {
    await fs.writeFile(DB_PATH, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async insert(collection, item) {
    if (!this.data[collection]) {
      this.data[collection] = [];
    }
    
    // Generate ID if not present
    if (!item.id) {
      item.id = `${collection}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    this.data[collection].push(item);
    await this.save();
    return item;
  }

  async find(collection, query = {}) {
    if (!this.data[collection]) {
      return [];
    }

    return this.data[collection].filter(item => {
      return Object.keys(query).every(key => item[key] === query[key]);
    });
  }

  async findOne(collection, query) {
    const results = await this.find(collection, query);
    return results[0] || null;
  }

  async update(collection, query, updates) {
    if (!this.data[collection]) {
      return null;
    }

    const index = this.data[collection].findIndex(item => {
      return Object.keys(query).every(key => item[key] === query[key]);
    });

    if (index !== -1) {
      this.data[collection][index] = {
        ...this.data[collection][index],
        ...updates
      };
      await this.save();
      return this.data[collection][index];
    }

    return null;
  }

  async delete(collection, query) {
    if (!this.data[collection]) {
      return false;
    }

    const initialLength = this.data[collection].length;
    this.data[collection] = this.data[collection].filter(item => {
      return !Object.keys(query).every(key => item[key] === query[key]);
    });

    if (this.data[collection].length < initialLength) {
      await this.save();
      return true;
    }

    return false;
  }
}

module.exports = new JsonDB();
