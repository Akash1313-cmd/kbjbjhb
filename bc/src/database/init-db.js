/**
 * Database Initialization
 * Initialize db.json and create default admin user if needed
 */

const db = require('./json-db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

/**
 * Initialize database with default data
 */
async function initDatabase() {
  console.log('🔧 Initializing JSON database...');
  
  try {
    // Check if admin user exists
    const adminUser = db.findOne('users', { email: 'admin@example.com' });
    
    if (!adminUser) {
      console.log('📝 Creating default admin user...');
      
      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);
      
      // Generate API key
      const apiKey = crypto.randomBytes(16).toString('hex');
      
      // Create admin user
      const admin = db.insert('users', {
        name: 'Administrator',
        email: 'admin@example.com',
        password: hashedPassword,
        role: 'admin',
        plan: 'enterprise',
        jobsCreated: 0,
        totalPlacesScraped: 0,
        apiKey: apiKey,
        authProvider: 'local',
        isActive: true,
        lastLogin: null
      });
      
      console.log('✅ Default admin user created');
      console.log('   Email: admin@example.com');
      console.log('   Password: admin123');
      console.log('   API Key:', apiKey);
    } else {
      console.log('✅ Admin user already exists');
    }
    
    // Setup backup directory
    const backupDir = path.join(__dirname, '..', '..', 'database', 'backups');
    console.log('📦 Backup directory:', backupDir);
    
    console.log('✅ Database initialization complete');
    
    return true;
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    return false;
  }
}

// Auto-initialize if run directly
if (require.main === module) {
  initDatabase()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { initDatabase };
