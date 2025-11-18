/**
 * Post-install setup script
 * Runs automatically after npm install
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n🔧 Running post-install setup...\n');

// 1. Install Puppeteer browser
try {
    console.log('📦 Installing Puppeteer browser (Chrome)...');
    execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
    console.log('✅ Browser installed!\n');
} catch (error) {
    console.log('⚠️ Browser installation skipped (may already exist)\n');
}

// 2. Check config file
const configPath = path.join(__dirname, '../config/config.json');
if (fs.existsSync(configPath)) {
    console.log('📝 Config file found: config.json\n');
} else {
    console.log('⚠️ Config file not found (will use defaults)\n');
}

// 3. Create output directory
const outputDir = path.join(__dirname, '..', 'results');
try {
    if (!fs.existsSync(outputDir)) {
        console.log('📁 Creating output directory...');
        fs.mkdirSync(outputDir, { recursive: true });
        console.log(`✅ Output directory created: ${outputDir}\n`);
    } else {
        console.log(`📁 Output directory exists: ${outputDir}\n`);
    }
} catch (error) {
    console.log('⚠️ Could not create output directory (will be created on first run)\n');
}

console.log('✅ Post-install setup complete!\n');
console.log('Run the application:');
console.log('  npm start         - Start API server');
console.log('  npm run scrape    - Run scraper\n');
