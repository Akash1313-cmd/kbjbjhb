/**
 * WebSocket Handler
 * Manages Socket.IO connections and events
 */

const { results } = require('../utils/job-manager');

/**
 * Initialize WebSocket handlers
 * @param {Object} io - Socket.IO instance
 */
function initializeWebSocket(io) {
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);

        socket.on('subscribe', (jobId) => {
            socket.join(jobId);
            const roomSize = io.sockets.adapter.rooms.get(jobId)?.size || 0;
            console.log(`✅ Client ${socket.id} subscribed to job: ${jobId} (Room now has ${roomSize} client(s))`);
            
            // Send any existing results immediately upon subscription
            if (results.has(jobId)) {
                const jobResults = results.get(jobId);
                Object.keys(jobResults).forEach(keyword => {
                    socket.emit('keyword_results', {
                        jobId,
                        keyword,
                        results: jobResults[keyword],
                        count: jobResults[keyword]?.length || 0,
                        isPartial: false
                    });
                    console.log(`   📤 Sent existing results for "${keyword}" to newly subscribed client`);
                });
            }
        });

        socket.on('unsubscribe', (jobId) => {
            socket.leave(jobId);
            console.log(`Client unsubscribed from job: ${jobId}`);
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });
}

module.exports = {
    initializeWebSocket
};
