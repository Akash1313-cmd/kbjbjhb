/**
 * Setup verification script
 * Run manually: npm run setup
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
    console.log('\n🔍 Checking system setup...\n');

    let allGood = true;

    // Check 1: Node version
    const nodeVersion = process.version;
    console.log(`📌 Node.js: ${nodeVersion}`);
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion < 16) {
        console.log('   ❌ Need Node.js 16+');
        allGood = false;
    } else {
        console.log('   ✅ Version OK\n');
    }

    // Check 2: Puppeteer installation
    console.log('📌 Puppeteer:');
    try {
        require('puppeteer');
        console.log('   ✅ Package installed\n');
    } catch (error) {
        console.log('   ❌ Package missing - run: npm install\n');
        allGood = false;
    }

    // Check 3: Puppeteer browser
    console.log('📌 Chrome browser:');
    try {
        const puppeteer = require('puppeteer');
        // Try to get the executable path - if it exists, browser is installed
        const executablePath = puppeteer.executablePath();
        if (executablePath && fs.existsSync(executablePath)) {
            console.log('   ✅ Browser installed\n');
        } else {
            console.log('   ❌ Browser missing - run: npx puppeteer browsers install chrome\n');
            allGood = false;
        }
    } catch (error) {
        // Browser might still be installed even if executablePath fails
        // Check common cache locations
        const homedir = require('os').homedir();
        const cachePaths = [
            path.join(homedir, '.cache', 'puppeteer'),
            path.join(homedir, 'AppData', 'Local', 'ms-playwright'),
            path.join(process.cwd(), 'node_modules', 'puppeteer', '.local-chromium')
        ];
        
        const browserFound = cachePaths.some(p => fs.existsSync(p));
        if (browserFound) {
            console.log('   ✅ Browser cache found\n');
        } else {
            console.log('   ⚠️ Browser check inconclusive (will download on first run)\n');
        }
    }

    // Check 4: Config file
    console.log('📌 Configuration:');
    const configPath = path.join(__dirname, '../config/config.json');
    if (fs.existsSync(configPath)) {
        console.log('   ✅ config.json exists\n');
    } else {
        console.log('   ⚠️ config.json missing (will use defaults)\n');
    }

    // Check 5: Output directory
    console.log('📌 Output directory:');
    const outputDir = path.join(__dirname, '..', 'results');
    if (fs.existsSync(outputDir)) {
        console.log(`   ✅ ${outputDir}\n`);
    } else {
        console.log('   ⚠️ Will be created on first run\n');
    }

    // Check 6: Dependencies
    console.log('📌 Required packages:');
    const requiredPackages = ['express', 'puppeteer', 'xlsx', 'socket.io', 'cors'];
    let missingPackages = [];
    for (const pkg of requiredPackages) {
        try {
            require.resolve(pkg);
        } catch (e) {
            missingPackages.push(pkg);
        }
    }
    if (missingPackages.length === 0) {
        console.log('   ✅ All dependencies installed\n');
    } else {
        console.log(`   ❌ Missing: ${missingPackages.join(', ')}\n`);
        allGood = false;
    }

    // Summary
    console.log('═'.repeat(50));
    if (allGood) {
        console.log('\n✅ All systems ready!\n');
        console.log('Start the application:');
        console.log('  npm start         - API server');
        console.log('  npm run scrape    - Normal scraper\n');
    } else {
        console.log('\n⚠️ Some checks failed. Please fix the issues above.\n');
        process.exit(1);
    }
})();
