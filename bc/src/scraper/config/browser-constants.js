/**
 * Browser constants and Chrome arguments
 */

const BASE_CHROME_ARGS = [
    // Core stability args
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-features=AudioServiceOutOfProcess',
    '--disable-features=RendererCodeIntegrity',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-notifications',
    '--disable-offer-store-unmasked-wallet-cards',
    '--disable-popup-blocking',
    '--disable-print-preview',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-speech-api',
    '--disable-sync',
    '--disable-blink-features=AutomationControlled',
    '--disable-automation',
    '--hide-scrollbars',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-pings',
    '--no-sandbox',
    '--password-store=basic',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--disable-setuid-sandbox',
    '--disable-features=TranslateUI',
    
    // Production memory optimization
    '--memory-pressure-off',
    '--max-old-space-size=1024',  // Increased for stability
    '--disable-gpu',
    '--disable-gpu-sandbox',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor',
    
    // Production performance flags
    '--aggressive-cache-discard',
    '--disable-background-mode',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-accessibility',
    '--disable-features=CalculateNativeWinOcclusion',
    '--force-color-profile=srgb',
    
    // Additional production flags
    '--no-first-run',
    '--disable-features=Translate',
    '--disable-features=BlinkGenPropertyTrees'
];

const BROWSER_LAUNCH_MIN_DELAY_MS = Math.max(0, parseInt(process.env.BROWSER_LAUNCH_MIN_DELAY_MS || '0', 10));
const BROWSER_LAUNCH_MAX_DELAY_MS = Math.max(
    BROWSER_LAUNCH_MIN_DELAY_MS,
    parseInt(process.env.BROWSER_LAUNCH_MAX_DELAY_MS || process.env.BROWSER_LAUNCH_MIN_DELAY_MS || '0', 10)
);

module.exports = {
    BASE_CHROME_ARGS,
    BROWSER_LAUNCH_MIN_DELAY_MS,
    BROWSER_LAUNCH_MAX_DELAY_MS
};
