/**
 * Webhook Service
 * Trigger webhooks for job events
 */

const logger = require('../utils/logger');

// Webhooks storage (should be shared from api-server.js)
let webhooks = new Map();

/**
 * Initialize webhooks storage
 * @param {Map} webhooksMap - Shared webhooks Map from api-server.js
 */
function initWebhooks(webhooksMap) {
    webhooks = webhooksMap;
}

/**
 * Trigger webhooks for job events
 * @param {string} jobId - Job ID
 * @param {string} event - Event type
 * @param {Object} data - Event data
 */
async function triggerWebhooks(jobId, event, data) {
    try {
        // Find all webhooks for this job
        const jobWebhooks = Array.from(webhooks.values())
            .filter(wh => wh.jobId === jobId && wh.events.includes(event));
        
        if (jobWebhooks.length === 0) {
            return;
        }
        
        // Use dynamic import for node-fetch (ESM module)
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        
        // Send webhook to each registered URL
        for (const webhook of jobWebhooks) {
            try {
                const response = await fetch(webhook.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        event,
                        timestamp: new Date().toISOString(),
                        ...data
                    }),
                    timeout: 5000
                });
                
                if (response.ok) {
                    logger.info('Webhook triggered successfully', { 
                        webhookId: webhook.webhookId,
                        jobId,
                        event,
                        url: webhook.url 
                    });
                } else {
                    logger.warn('Webhook request failed', { 
                        webhookId: webhook.webhookId,
                        status: response.status,
                        url: webhook.url
                    });
                }
            } catch (error) {
                logger.error('Webhook trigger error', { 
                    webhookId: webhook.webhookId,
                    error: error.message,
                    url: webhook.url
                });
            }
        }
    } catch (error) {
        logger.error('Webhook system error', { error: error.message });
    }
}

module.exports = {
    initWebhooks,
    triggerWebhooks
};
