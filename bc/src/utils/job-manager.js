/**
 * Job Manager
 * Global state management for jobs, results, and cancellation flags
 */

// In-memory data stores (Maps)
const jobs = new Map();
const results = new Map();
const activeJobsMap = new Map();

// Track cancellation flags and intervals for each job
const jobCancellationFlags = new Map(); // jobId -> boolean
const jobIntervals = new Map(); // jobId -> intervalId

module.exports = {
    jobs,
    results,
    activeJobsMap,
    jobCancellationFlags,
    jobIntervals
};
