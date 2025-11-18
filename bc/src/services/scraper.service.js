/**
 * Scraper Service
 * Core scraping business logic and job progress tracking
 */

const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { processKeywords } = require('../scraper-pro');
const { jobs, results, activeJobsMap, jobCancellationFlags, jobIntervals } = require('../utils/job-manager');
const { updateJobInMongoDB } = require('./job.service');

/**
 * Update job progress and emit to WebSocket
 * @param {string} jobId - Job ID
 * @param {number} current - Current progress
 * @param {number} total - Total items
 * @param {Object} meta - Additional metadata
 * @param {Object} io - Socket.IO instance
 */
function updateJobProgress(jobId, current, total, meta = {}, io) {
    const job = jobs.get(jobId);
    if (!job) return;
    
    const totalKeywords = typeof total === 'number'
        ? total
        : job.progress?.total || job.keywords?.length || 0;
    const normalizedCurrent = Math.max(0, Math.min(typeof current === 'number' ? current : 0, totalKeywords));
    const percentage = totalKeywords === 0
        ? 0
        : Math.min(100, Math.round((normalizedCurrent / totalKeywords) * 100));
    
    // Calculate total places scraped
    const jobResults = results.get(jobId);
    const placesScraped = jobResults 
        ? Object.values(jobResults).reduce((sum, places) => 
            sum + (Array.isArray(places) ? places.length : 0), 0)
        : 0;

    job.progress = {
        ...(job.progress || {}),
        current: normalizedCurrent,
        keywordsCompleted: Math.floor(normalizedCurrent),  // Should be integer count of completed keywords
        totalKeywords: totalKeywords,
        total: totalKeywords,
        percentage,
        currentKeyword: meta.keyword ?? job.progress?.currentKeyword ?? null,
        lastKeyword: meta.keyword ?? job.progress?.lastKeyword ?? null,
        placesScraped,
        linksFound: meta.linksFound ?? job.progress?.linksFound ?? 0,
        extractedCount: meta.extractedCount ?? job.progress?.extractedCount ?? 0,
        urlProgress: meta.linksFound > 0 ? `${meta.extractedCount || 0}/${meta.linksFound}` : '0/0',
        lastUpdated: new Date().toISOString()
    };
    
    if (typeof meta.resultsCount === 'number') {
        job.progress.lastResultsCount = meta.resultsCount;
    }
    
    if (meta.error) {
        job.progress.error = meta.error;
    } else if (job.progress && job.progress.error) {
        delete job.progress.error;
    }
    
    jobs.set(jobId, job);
    
    if (io) {
        io.to(jobId).emit('job_progress', {
            jobId,
            progress: job.progress,
            error: meta.error || null
        });
    }
}

/**
 * Start a new scraping job
 * @param {string} jobId - Job ID
 * @param {Array} keywords - Keywords to scrape
 * @param {Object} jobConfig - Job configuration
 * @param {Object} config - Application configuration
 * @param {Object} io - Socket.IO instance
 * @param {Function} triggerWebhooks - Webhook trigger function
 */
async function startScrapingJob(jobId, keywords, jobConfig, config, io, triggerWebhooks) {
    const job = jobs.get(jobId);
    job.status = 'in_progress';
    job.startTime = new Date().toISOString();
    job.progress = job.progress || {
        current: 0,
        keywordsCompleted: 0,
        total: keywords.length,
        totalKeywords: keywords.length,
        percentage: 0,
        placesScraped: 0
    };
    jobs.set(jobId, job);
    activeJobsMap.set(jobId, job);
    
    // Initialize cancellation flag as false
    jobCancellationFlags.set(jobId, false);
    
    updateJobProgress(jobId, 0, keywords.length, {}, io);
    
    // Start live polling for partial results (every 3 seconds)
    const livePollingInterval = setInterval(async () => {
        // Check if job is cancelled
        if (jobCancellationFlags.get(jobId)) {
            clearInterval(livePollingInterval);
            jobIntervals.delete(jobId);
            return;
        }
        if (jobs.get(jobId)?.status !== 'in_progress') {
            clearInterval(livePollingInterval);
            return;
        }
        
        // Check all keywords for partial updates from local files
        for (const keyword of keywords) {
            try {
                let keywordResults = null;
                
                // Read from local files only
                const resultsDir = config.outputDir || path.join(__dirname, '../../results');
                const sanitized = keyword.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, '_').substring(0, 50);
                const tempFilePath = path.join(resultsDir, `${sanitized}.temp.json`);
                const finalFilePath = path.join(resultsDir, `${sanitized}.json`);
                
                // Check temp file first, then final file
                if (fs.existsSync(tempFilePath)) {
                    keywordResults = JSON.parse(fs.readFileSync(tempFilePath, 'utf8'));
                } else if (fs.existsSync(finalFilePath)) {
                    keywordResults = JSON.parse(fs.readFileSync(finalFilePath, 'utf8'));
                }
                
                // Emit if we have new data
                if (keywordResults && keywordResults.length > 0) {
                    const currentResults = results.get(jobId) || {};
                    const previousCount = currentResults[keyword]?.length || 0;
                    
                    // Only emit if there's new data
                    if (keywordResults.length > previousCount) {
                        currentResults[keyword] = keywordResults;
                        results.set(jobId, currentResults);
                        
                        // Emit partial results
                        io.to(jobId).emit('keyword_results', {
                            jobId,
                            keyword,
                            results: keywordResults,
                            count: keywordResults.length,
                            isPartial: true,
                            totalKeywords: keywords.length
                        });
                        
                        // Update places count
                        const job = jobs.get(jobId);
                        if (job) {
                            const totalPlaces = Object.values(currentResults).reduce((sum, places) =>
                                sum + (Array.isArray(places) ? places.length : 0), 0
                            );

                            // Update places count only, keep existing progress from callbacks
                            job.progress = {
                                ...(job.progress || {}),
                                placesScraped: totalPlaces,
                                lastUpdated: new Date().toISOString()
                            };

                            jobs.set(jobId, job);

                            console.log(`📊 Live Polling: Updated places count to ${totalPlaces} for "${keyword}" (Source: Local File)`);
                        }
                    }
                }
            } catch (err) {
                // Ignore errors during live polling
            }
        }
    }, 3000); // Poll every 3 seconds for real-time updates
    
    // Store interval for cleanup
    jobIntervals.set(jobId, livePollingInterval);
    
    try {
        // Initialize results storage for this job
        results.set(jobId, {});
        
        // Use normal scraper
        logger.info('Using normal scraper', { jobId, workers: jobConfig?.workers, linkWorkers: jobConfig?.linkWorkers });
        const jobResults = await processKeywords(
            keywords,
            jobConfig?.workers,
            jobConfig?.linkWorkers,
            {
                // Check cancellation before processing each keyword
                shouldCancel: () => jobCancellationFlags.get(jobId) === true,
                // NEW: Handle real-time progress during keyword processing
                onProgress: ({ keyword, index, total, phase, progress, linksFound, extractedCount }) => {
                    const job = jobs.get(jobId);
                    if (!job) return;

                    // Calculate overall progress:
                    // index = Number of fully completed keywords
                    // progress = Current keyword progress (0 to 1)
                    const completedKeywords = index || 0;  // Already the count of completed keywords
                    const currentKeywordProgress = Math.min(1, Math.max(0, progress || 0));  // Clamp between 0 and 1
                    const overallProgress = completedKeywords + currentKeywordProgress;
                    const percentage = Math.min(100, Math.round((overallProgress / total) * 100));

                    // Get current places count from results
                    const jobResults = results.get(jobId) || {};
                    let placesScraped = Object.values(jobResults).reduce((sum, places) =>
                        sum + (Array.isArray(places) ? places.length : 0), 0
                    );
                    
                    // Add extracted count from current keyword if provided
                    if (extractedCount && extractedCount > 0) {
                        // For current keyword being processed
                        const currentKeywordPlaces = jobResults[keyword]?.length || 0;
                        placesScraped = placesScraped - currentKeywordPlaces + extractedCount;
                    }

                    // Update job progress with real data
                    job.progress = {
                        ...(job.progress || {}),
                        current: overallProgress,
                        keywordsCompleted: completedKeywords,  // This is now the actual count of completed keywords!
                        totalKeywords: total,
                        total: total,
                        percentage,
                        currentKeyword: keyword,
                        currentPhase: phase,  // 'extracting_links' or 'extracting_data'
                        placesScraped: extractedCount || placesScraped,  // Use extractedCount (actual places) if provided
                        linksFound: linksFound || 0,  // Total URLs found for current keyword
                        extractedCount: extractedCount || 0,  // Places extracted so far (not URLs!)
                        lastUpdated: new Date().toISOString()
                    };

                    jobs.set(jobId, job);

                    // Emit real-time progress with proper URL count
                    io.to(jobId).emit('job_progress', {
                        jobId,
                        progress: {
                            ...job.progress,
                            urlProgress: linksFound > 0 ? `${extractedCount || 0}/${linksFound}` : '0/0'
                        }
                    });

                    console.log(`📊 Progress: "${keyword}" [${phase}] - URLs: ${extractedCount || 0}/${linksFound || 0}, Places: ${placesScraped}, Overall: ${percentage}%`);
                },
                
                // 🔥 NEW: Handle partial results (every 10 places)
                onPartialResults: async ({ keyword, count }) => {
                    try {
                        console.log(`\n📦 onPartialResults: "${keyword}" - ${count} places (partial update). Emitting temp_file_updated event.`);
                        
                        // Emit an event to notify the frontend that the temporary file has been updated.
                        // The frontend will then be responsible for fetching the updated results.
                        io.to(jobId).emit('temp_file_updated', {
                            jobId,
                            keyword,
                            count
                        });
                        
                        console.log(`   📡 Emitted temp_file_updated for "${keyword}"`);
                        
                        // Optionally, update the job progress with the new count of scraped places.
                        const job = jobs.get(jobId);
                        if (job) {
                            const jobMetadata = results.get(jobId);
                            if (jobMetadata && jobMetadata._metadata) {
                                jobMetadata._metadata.keywords[keyword] = count;
                                const totalPlaces = Object.values(jobMetadata._metadata.keywords).reduce((sum, c) => sum + c, 0);
                                job.progress = {
                                    ...(job.progress || {}),
                                    placesScraped: totalPlaces,
                                    lastUpdated: new Date().toISOString()
                                };
                                jobs.set(jobId, job);
                            }
                        }
                    } catch (err) {
                        console.error(`❌ Error processing partial results for "${keyword}":`, err.message);
                    }
                },
                
                onKeywordComplete: ({ keyword, index, total, resultsCount, error, results: keywordResults }) => {
                    // index is the completed keyword index (0-based), so completed count is index+1
                    const completedCount = index + 1;

                    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                    console.log(`🔔 onKeywordComplete: "${keyword}"`);
                    console.log(`   ⏱️  Index: ${index} → Completed Count: ${completedCount}/${total}`);
                    console.log(`   📊 Places Found: ${resultsCount}`);
                    console.log(`   📦 Results data received: ${keywordResults ? 'YES ✅' : 'NO (fallback to file)'}`);
                    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                    
                    // ✅ FIX: DO NOT WRITE FILES HERE - scraper-pro.js handles all file writing
                    try {
                        let resultsData = null;
                        
                        // Option 1: Use results passed directly from scraper (PREFERRED)
                        if (keywordResults && Array.isArray(keywordResults)) {
                            resultsData = keywordResults;
                            console.log(`✅ Using results data from scraper (${resultsData.length} places)`);
                        }
                        // Option 2: Fallback to reading file (BACKWARD COMPATIBILITY)
                        else {
                            const resultsFilePath = path.join(
                                config.outputDir || path.join(__dirname, '../../results'),
                                keyword.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, '_').substring(0, 50) + '.json'
                            );
                            
                            console.log(`📂 Looking for results file: ${resultsFilePath}`);
                            console.log(`   File exists: ${fs.existsSync(resultsFilePath)}`);
                            
                            if (fs.existsSync(resultsFilePath)) {
                                resultsData = JSON.parse(fs.readFileSync(resultsFilePath, 'utf8'));
                                console.log(`✅ Loaded results from file (${resultsData.length} places)`);
                            } else {
                                console.log(`⚠️ Results file not found - data may be lost!`);
                            }
                        }
                        
                        // LOCAL FILES ONLY: Store metadata in memory for progress tracking
                        if (resultsData && Array.isArray(resultsData) && resultsData.length > 0) {
                            // ✅ LOCAL FILES as PRIMARY storage (saved by scraper-pro.js)
                            // MongoDB is disabled - results loaded from local files when needed
                            console.log(`💾 Local Files: ${resultsData.length} places for "${keyword}" (saved by scraper)`);
                            
                            // MEMORY OPTIMIZATION: Only store metadata, not full data
                            if (!results.has(jobId)) {
                                results.set(jobId, {
                                    _metadata: {
                                        keywords: {},
                                        totalPlaces: 0,
                                        memoryOptimized: true
                                    }
                                });
                            }
                            
                            const jobMetadata = results.get(jobId);
                            if (jobMetadata && jobMetadata._metadata) {
                                jobMetadata._metadata.keywords[keyword] = resultsData.length;
                                jobMetadata._metadata.totalPlaces = Object.values(jobMetadata._metadata.keywords)
                                    .reduce((sum, count) => sum + count, 0);
                                
                                console.log(`💡 Memory optimized: Only metadata stored`);
                                console.log(`   Keywords completed: ${Object.keys(jobMetadata._metadata.keywords).length}/${total}`);
                                console.log(`   Total places: ${jobMetadata._metadata.totalPlaces}`);
                                console.log(`   Memory saved: ~${(resultsData.length * 1024 / 1024).toFixed(2)}MB per keyword`);
                            }
                            
                            // Emit live results via WebSocket (stream, don't store)
                            io.to(jobId).emit('keyword_results', {
                                jobId,
                                keyword,
                                results: resultsData,  // Send data but don't store in memory
                                count: resultsData.length,
                                isPartial: false,
                                completedIndex: completedCount,
                                totalKeywords: total
                            });
                            console.log(`📡 Emitted keyword_results for "${keyword}" (COMPLETED) via WebSocket`);
                        } else {
                            console.log(`⚠️ No results data available for "${keyword}" - skipping save`);
                        }
                    } catch (err) {
                        console.error(`❌ Error processing results for "${keyword}":`, err);
                    }
                    
                    // Update progress with completedCount (not index)
                    updateJobProgress(jobId, completedCount, total, { keyword, resultsCount, error }, io);
                }
            }
        );
        
        // Final results summary
        console.log(`\n💾 Final results summary for job ${jobId}`);
        
        // Check if we're using memory-optimized approach
        const jobMetadata = results.get(jobId);
        let totalPlaces = 0;
        
        if (jobMetadata && jobMetadata._metadata && jobMetadata._metadata.memoryOptimized) {
            // Memory optimized - data already in MongoDB
            totalPlaces = jobMetadata._metadata.totalPlaces;
            console.log(`   ✅ Memory optimized mode: ${Object.keys(jobMetadata._metadata.keywords).length} keywords`);
            console.log(`   💾 All data in MongoDB (not in memory)`);
            console.log(`   📊 Total places: ${totalPlaces}`);
            console.log(`   💡 Memory saved: ~${((totalPlaces * 1024) / 1024 / 1024).toFixed(2)}GB`);
        } else if (jobMetadata) {
            // Fallback: Old approach (if memory optimization wasn't used)
            totalPlaces = Object.values(jobMetadata).reduce((sum, places) => 
                sum + (Array.isArray(places) ? places.length : 0), 0);
            console.log(`   Keywords in results: ${Object.keys(jobMetadata).join(', ')}`);
            console.log(`   Total keywords: ${Object.keys(jobMetadata).length}`);
            Object.keys(jobMetadata).forEach(kw => {
                console.log(`     - "${kw}": ${jobMetadata[kw]?.length || 0} places`);
            });
            console.log(`   ⚠️ Using old approach - all data in memory`);
        } else {
            console.log(`   ⚠️ No results found in memory`);
        }
        
        // Don't accumulate stats globally - let the stats API calculate from jobs
        console.log(`✅ Job ${jobId} completed with ${totalPlaces} total places`);
        
        // Clear live polling interval
        clearInterval(livePollingInterval);
        
        // Check if job was cancelled during execution
        if (jobCancellationFlags.get(jobId)) {
            job.status = 'cancelled';
            job.completedAt = new Date().toISOString();
            logger.info('Job cancelled during execution', { jobId, totalPlaces });
        } else {
            job.status = 'completed';
            job.completedAt = new Date().toISOString();
            job.duration = `${((Date.now() - new Date(job.startTime)) / 60000).toFixed(1)} min`;
            logger.info('Job completed', { jobId, totalPlaces });
        }
        
        job.totalPlaces = totalPlaces;
        job.placesCount = totalPlaces; // Also set placesCount for consistency
        jobs.set(jobId, job);
        activeJobsMap.delete(jobId);
        
        // Clear results from memory after completion to prevent stale data
        // ✅ FIX: Increased timeout to 5 minutes (300000ms) to prevent premature data clearing
        setTimeout(() => {
            if (results.has(jobId)) {
                console.log(`🧹 Clearing job results from memory: ${jobId}`);
                results.delete(jobId);
            }
        }, 300000); // Clear after 5 minutes to allow proper data retrieval
        updateJobProgress(jobId, keywords.length, keywords.length, {}, io);
        
        // Cleanup cancellation tracking
        jobCancellationFlags.delete(jobId);
        
        // Clear any intervals
        if (jobIntervals.has(jobId)) {
            clearInterval(jobIntervals.get(jobId));
            jobIntervals.delete(jobId);
        }
        
        // Update job in MongoDB
        updateJobInMongoDB(jobId, {
            status: job.status,
            completedAt: new Date(),
            totalPlaces: totalPlaces,
            placesCount: totalPlaces,
            progress: job.progress
        });
        
        // Emit appropriate event
        if (job.status === 'cancelled') {
            io.to(jobId).emit('job_cancelled', {
                jobId,
                message: 'Job was cancelled',
                totalPlaces
            });
        } else {
            io.to(jobId).emit('job_completed', {
                jobId,
                status: 'completed',
                totalPlaces
            });
        }
        
        // Trigger webhooks
        await triggerWebhooks(jobId, 'job_completed', {
            jobId,
            status: 'completed',
            totalPlaces,
            completedAt: job.completedAt
        });
        
    } catch (error) {
        // Clear live polling interval on error
        clearInterval(livePollingInterval);
        
        // Check if error was due to cancellation
        if (jobCancellationFlags.get(jobId)) {
            job.status = 'cancelled';
            job.completedAt = new Date().toISOString();
            logger.info('Job cancelled (caught in error handler)', { jobId });
            
            io.to(jobId).emit('job_cancelled', {
                jobId,
                message: 'Job was cancelled'
            });
        } else {
            logger.error('Job failed', { jobId, error: error.message });
            job.status = 'failed';
            job.error = error.message;
            job.completedAt = new Date().toISOString();
            
            io.to(jobId).emit('job_failed', {
                jobId,
                error: error.message
            });
            
            // Trigger webhooks for failures
            await triggerWebhooks(jobId, 'job_failed', {
                jobId,
                status: 'failed',
                error: error.message,
                failedAt: new Date().toISOString()
            });
        }
        
        jobs.set(jobId, job);
        activeJobsMap.delete(jobId);
        
        // Cleanup cancellation tracking
        jobCancellationFlags.delete(jobId);
        
        // Clear any intervals
        if (jobIntervals.has(jobId)) {
            clearInterval(jobIntervals.get(jobId));
            jobIntervals.delete(jobId);
        }
        
        updateJobProgress(
            jobId,
            job.progress?.current ?? 0,
            job.progress?.total ?? keywords.length,
            { error: error.message },
            io
        );
    }
}

module.exports = {
    updateJobProgress,
    startScrapingJob
};
