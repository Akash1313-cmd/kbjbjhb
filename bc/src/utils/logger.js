const winston = require('winston');
const chalk = require('chalk');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}] ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'logs/app.log' })
  ]
});

// Add all custom methods
logger.header = (text) => {
  const line = '='.repeat(50);
  console.log(chalk.bold.cyan(`\n${line}\n${text}\n${line}\n`));
};

logger.separator = () => {
  console.log(chalk.gray('─'.repeat(50)));
};

logger.success = (text) => {
  console.log(chalk.green(`✓ ${text}`));
};

logger.warning = (text) => {
  console.log(chalk.yellow(`⚠ ${text}`));
};

logger.error = (text) => {
  console.log(chalk.red(`✗ ${text}`));
};

logger.highlight = (text) => {
  console.log(chalk.bold.yellow(text));
};

logger.dim = (text) => {
  console.log(chalk.dim(text));
};

module.exports = logger;
