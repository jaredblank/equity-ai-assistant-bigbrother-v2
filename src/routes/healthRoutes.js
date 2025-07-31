const express = require('express');
const { healthCheckBypass, complianceMiddleware } = require('../utils/middleware');
const { validateHealthCheck } = require('../utils/validators');
const logger = require('../utils/logger');
const database = require('../config/database');
const { validateConfiguration } = require('../config/aiConfig');
const AIService = require('../services/aiService');
const BrokerService = require('../services/brokerService');
const router = express.Router();
const aiService = new AIService();
const brokerService = new BrokerService();
router.get('/', healthCheckBypass, complianceMiddleware, async (req, res) => {
    const timer = logger.performance('basic-health-check', 'HealthRoutes');
    try {
        const healthStatus = { status: 'healthy', service: 'Big Brother AI Assistant v2', version: '2.0.0', compliance: 'BIG_BROTHER_V2', timestamp: new Date().toISOString(), uptime: process.uptime(), environment: process.env.NODE_ENV || 'development' };
        timer.end('Basic health check completed');
        res.json(healthStatus);
    } catch (error) {
        timer.endWithError(error, 'Basic health check failed');
        logger.error('Basic health check failed', { component: 'HealthRoutes', requestId: req.requestId, error: error.message });
        res.status(503).json({ status: 'unhealthy', service: 'Big Brother AI Assistant v2', error: error.message, timestamp: new Date().toISOString() });
    }
});
router.get('/detailed', healthCheckBypass, complianceMiddleware, validateHealthCheck, async (req, res) => {
    const timer = logger.performance('detailed-health-check', 'HealthRoutes');
    const { detailed, includeMetrics } = req.query;
    try {
        const healthChecks = await Promise.allSettled([checkDatabaseHealth(), checkAIServiceHealth(), checkBrokerServiceHealth(), checkSystemResources()]);
        const [dbHealth, aiHealth, brokerHealth, systemHealth] = healthChecks;
        const overallStatus = healthChecks.every(check => check.status === 'fulfilled' && check.value.status === 'healthy') ? 'healthy' : 'degraded';
        const healthStatus = {
            status: overallStatus, service: 'Big Brother AI Assistant v2', version: '2.0.0', compliance: 'BIG_BROTHER_V2', timestamp: new Date().toISOString(), uptime: process.uptime(), environment: process.env.NODE_ENV || 'development',
            components: {
                database: dbHealth.status === 'fulfilled' ? dbHealth.value : { status: 'unhealthy', error: dbHealth.reason?.message },
                aiService: aiHealth.status === 'fulfilled' ? aiHealth.value : { status: 'unhealthy', error: aiHealth.reason?.message },
                brokerService: brokerHealth.status === 'fulfilled' ? brokerHealth.value : { status: 'unhealthy', error: brokerHealth.reason?.message },
                system: systemHealth.status === 'fulfilled' ? systemHealth.value : { status: 'unhealthy', error: systemHealth.reason?.message }
            }
        };
        if (includeMetrics === 'true') healthStatus.metrics = await getSystemMetrics();
        timer.addMetadata('overallStatus', overallStatus);
        timer.addMetadata('componentCount', Object.keys(healthStatus.components).length);
        timer.end('Detailed health check completed');
        res.status(overallStatus === 'healthy' ? 200 : 503).json(healthStatus);
    } catch (error) {
        timer.endWithError(error, 'Detailed health check failed');
        logger.error('Detailed health check failed', { component: 'HealthRoutes', requestId: req.requestId, error: error.message, stack: error.stack });
        res.status(503).json({ status: 'unhealthy', service: 'Big Brother AI Assistant v2', error: 'Health check system failure', message: error.message, timestamp: new Date().toISOString() });
    }
});
router.get('/readiness', healthCheckBypass, async (req, res) => {
    const timer = logger.performance('readiness-check', 'HealthRoutes');
    try {
        const isReady = await Promise.all([database.isConnected(), checkAIConfigurationValid()]).then(results => results.every(result => result === true));
        if (isReady) {
            timer.end('Readiness check passed');
            res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
        } else {
            timer.end('Readiness check failed');
            res.status(503).json({ status: 'not ready', timestamp: new Date().toISOString() });
        }
    } catch (error) {
        timer.endWithError(error, 'Readiness check failed');
        res.status(503).json({ status: 'not ready', error: error.message, timestamp: new Date().toISOString() });
    }
});
router.get('/liveness', healthCheckBypass, async (req, res) => {
    const timer = logger.performance('liveness-check', 'HealthRoutes');
    try {
        const memoryUsage = process.memoryUsage();
        const isAlive = memoryUsage.heapUsed < (512 * 1024 * 1024);
        if (isAlive) {
            timer.end('Liveness check passed');
            res.status(200).json({ status: 'alive', uptime: process.uptime(), timestamp: new Date().toISOString() });
        } else {
            timer.end('Liveness check failed - memory limit exceeded');
            res.status(503).json({ status: 'unhealthy', reason: 'Memory limit exceeded', memoryUsage: memoryUsage.heapUsed, timestamp: new Date().toISOString() });
        }
    } catch (error) {
        timer.endWithError(error, 'Liveness check failed');
        res.status(503).json({ status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() });
    }
});
async function checkDatabaseHealth() {
    const timer = logger.performance('database-health-check', 'HealthCheck');
    try {
        const dbHealth = await database.getHealthStatus();
        timer.end('Database health check completed');
        return { status: dbHealth.connected ? 'healthy' : 'unhealthy', connected: dbHealth.connected, server: dbHealth.server, database: dbHealth.database, poolSize: dbHealth.poolSize, poolAvailable: dbHealth.poolAvailable, lastQuery: dbHealth.lastQuery };
    } catch (error) {
        timer.endWithError(error, 'Database health check failed');
        throw error;
    }
}
async function checkAIServiceHealth() {
    const timer = logger.performance('ai-service-health-check', 'HealthCheck');
    try {
        const aiStats = aiService.getServiceStats();
        timer.end('AI service health check completed');
        return { status: 'healthy', elevenlabsConfigured: aiStats.elevenlabsConfigured, aiModel: aiStats.aiModel, requestCount: aiStats.requestCount, uptime: aiStats.uptime, averageRequestsPerMinute: aiStats.averageRequestsPerMinute };
    } catch (error) {
        timer.endWithError(error, 'AI service health check failed');
        throw error;
    }
}
async function checkBrokerServiceHealth() {
    const timer = logger.performance('broker-service-health-check', 'HealthCheck');
    try {
        const brokerStats = await brokerService.getServiceStats();
        timer.end('Broker service health check completed');
        return { status: 'healthy', activeListings: brokerStats.activeListings, activeAgents: brokerStats.activeAgents, averageListingPrice: brokerStats.averageListingPrice, brokerLicense: brokerStats.brokerLicense, lastUpdated: brokerStats.lastUpdated };
    } catch (error) {
        timer.endWithError(error, 'Broker service health check failed');
        throw error;
    }
}
async function checkSystemResources() {
    const timer = logger.performance('system-resources-check', 'HealthCheck');
    try {
        const memoryUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        timer.end('System resources check completed');
        return { status: 'healthy', memory: { used: memoryUsage.heapUsed, total: memoryUsage.heapTotal, external: memoryUsage.external, rss: memoryUsage.rss }, cpu: { user: cpuUsage.user, system: cpuUsage.system }, uptime: process.uptime(), pid: process.pid };
    } catch (error) {
        timer.endWithError(error, 'System resources check failed');
        throw error;
    }
}
async function getSystemMetrics() {
    const timer = logger.performance('system-metrics', 'HealthCheck');
    try {
        const memoryUsage = process.memoryUsage();
        const metrics = {
            nodejs: { version: process.version, uptime: process.uptime(), memoryUsage, platform: process.platform, arch: process.arch },
            system: { loadAverage: require('os').loadavg(), freeMemory: require('os').freemem(), totalMemory: require('os').totalmem(), cpuCount: require('os').cpus().length },
            application: { requestCount: aiService.getServiceStats().requestCount, databaseConnected: database.isConnected(), configurationValid: await checkAIConfigurationValid() }
        };
        timer.end('System metrics collected');
        return metrics;
    } catch (error) {
        timer.endWithError(error, 'System metrics collection failed');
        throw error;
    }
}
async function checkAIConfigurationValid() {
    try {
        await validateConfiguration();
        return true;
    } catch (error) {
        return false;
    }
}
module.exports = router;