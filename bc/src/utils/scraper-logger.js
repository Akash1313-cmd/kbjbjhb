const chalk = require('chalk');
const readline = require('readline');

// Helper to format context object into a readable string
const formatContext = (context) => {
  if (!context || Object.keys(context).length === 0) {
    return '';
  }
  // Simple key-value pair formatting
  return ' ' + chalk.dim(Object.entries(context).map(([key, value]) => `${key}=${value}`).join(' '));
};

// State for the progress bar
let lastProgressMessage = '';
let progressTimeout = null;

const logger = {
  info(message, context) {
    this.clearProgress();
    process.stdout.write(chalk.blue('ℹ ') + message + formatContext(context) + '\n');
  },

  success(message, context) {
    this.clearProgress();
    process.stdout.write(chalk.green('✅ ') + message + formatContext(context) + '\n');
  },

  warn(message, context) {
    this.clearProgress();
    process.stdout.write(chalk.yellow('⚠️ ') + message + formatContext(context) + '\n');
  },

  error(message, context) {
    this.clearProgress();
    process.stderr.write(chalk.red('❌ ') + message + formatContext(context) + '\n');
  },

  debug(message, context) {
    if (process.env.DEBUG_SCRAPER) {
      this.clearProgress();
      process.stdout.write(chalk.magenta('🐞 ') + message + formatContext(context) + '\n');
    }
  },

  /**
   * Displays a single, overwriting progress line.
   * Call with null to clear the line.
   * @param {string | null} message
   */
  progress(message) {
    if (message === null) {
      this.clearProgress();
      return;
    }
    // Clear any existing timeout to avoid flicker
    if (progressTimeout) {
      clearTimeout(progressTimeout);
      progressTimeout = null;
    }
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(chalk.cyan('⏳ ') + message);
    lastProgressMessage = message;
  },

  // Clears the progress line so other logs can be printed cleanly
  clearProgress() {
    if (lastProgressMessage) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      lastProgressMessage = '';
    }
  },
  
  header(message) {
    this.clearProgress();
    process.stdout.write('\n' + chalk.bold.cyanBright(message) + '\n');
  },
  
  separator() {
    this.clearProgress();
    process.stdout.write(chalk.dim('—'.repeat(process.stdout.columns || 40)) + '\n');
  }
};

module.exports = logger;
