const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const performanceMiddleware = (req, res, next) => {
    req.requestId = uuidv4();
    req.startTime = Date.now();
    res.setHeader('X-Request-ID', req.requestId);
    logger.info('Incoming request', {
        component: 'Middleware',
        requestId: req.requestId,
        method: req.method,
        url: req.originalUrl,
        userAgent: req.get('User-Agent'),
        ip: req.ip || req.connection.remoteAddress,
        contentLength: req.get('Content-Length') || 0
    });
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
        const duration = Date.now() - req.startTime;
        const contentLength = res.get('Content-Length') || 0;
        logger.info('Request completed', {
            component: 'Middleware',
            requestId: req.requestId,
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration,
            contentLength,
            performance_category: categorizeRequestPerformance(req.originalUrl, duration)
        });
        originalEnd.call(this, chunk, encoding);
    };
    next();
};
function categorizeRequestPerformance(url, duration) {
    const thresholds = {
        '/api/voice': { good: 5000, acceptable: 10000 },
        '/api/chat': { good: 2000, acceptable: 5000 },
        '/api/health': { good: 100, acceptable: 500 },
        'default': { good: 1000, acceptable: 3000 }
    };
    const routeThreshold = Object.keys(thresholds).find(route => 
        route !== 'default' && url.includes(route)
    );
    const threshold = thresholds[routeThreshold] || thresholds.default;
    if (duration <= threshold.good) return 'EXCELLENT';
    if (duration <= threshold.acceptable) return 'ACCEPTABLE';
    return 'POOR';
}
const createRateLimit = (windowMs, max, message, skipSuccessfulRequests = false) => {
    return rateLimit({
        windowMs,
        max,
        message: {
            error: 'Rate limit exceeded',
            message,
            retryAfter: Math.ceil(windowMs / 1000)
        },
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests,
        handler: (req, res) => {
            logger.warn('Rate limit exceeded', {
                component: 'RateLimit',
                requestId: req.requestId,
                ip: req.ip,
                url: req.originalUrl,
                method: req.method
            });
            res.status(429).json({
                error: 'Rate limit exceeded',
                message,
                retryAfter: Math.ceil(windowMs / 1000)
            });
        }
    });
};
const apiRateLimit = createRateLimit(
    parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
    parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    'Too many requests, please try again later'
);
const voiceRateLimit = createRateLimit(
    parseInt(process.env.RATE_LIMIT_VOICE_WINDOW_MS) || 60000, // 1 minute
    parseInt(process.env.RATE_LIMIT_VOICE_MAX_REQUESTS) || 10,
    'Voice synthesis rate limit exceeded, please wait before making more requests'
);
const chatRateLimit = createRateLimit(
    300000, // 5 minutes
    50,
    'Chat rate limit exceeded, please slow down your requests'
);
const requestValidation = (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
        const contentType = req.get('Content-Type');
        if (!contentType || !contentType.includes('application/json')) {
            logger.warn('Invalid Content-Type', {
                component: 'Validation',
                requestId: req.requestId,
                contentType,
                method: req.method,
                url: req.originalUrl
            });
            return res.status(400).json({
                error: 'Invalid Content-Type',
                message: 'Content-Type must be application/json'
            });
        }
    }
    const contentLength = parseInt(req.get('Content-Length') || '0');
    if (contentLength > 10 * 1024 * 1024) { // 10MB limit
        logger.warn('Request too large', {
            component: 'Validation',
            requestId: req.requestId,
            contentLength,
            url: req.originalUrl
        });
        return res.status(413).json({
            error: 'Request too large',
            message: 'Request body exceeds 10MB limit'
        });
    }
    next();
};
const errorHandler = (error, req, res, next) => {
    const requestId = req.requestId || 'unknown';
    const statusCode = error.statusCode || error.status || 500;
    const errorResponse = {
        error: error.name || 'Internal Server Error',
        message: error.message || 'An unexpected error occurred',
        requestId,
        timestamp: new Date().toISOString()
    };
    if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = error.stack;
    }
    logger.error('Request error', {
        component: 'ErrorHandler',
        requestId,
        error: error.message,
        stack: error.stack,
        statusCode,
        method: req.method,
        url: req.originalUrl,
        userAgent: req.get('User-Agent'),
        ip: req.ip
    });
    res.status(statusCode).json(errorResponse);
};
const notFoundHandler = (req, res) => {
    const requestId = req.requestId || 'unknown';
    logger.warn('Route not found', {
        component: 'NotFound',
        requestId,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip
    });
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        requestId,
        timestamp: new Date().toISOString()
    });
};
const healthCheckBypass = (req, res, next) => {
    if (req.originalUrl.startsWith('/api/health')) {
        return next();
    }
    next();
};
const complianceMiddleware = (req, res, next) => {
    res.setHeader('X-Compliance-Level', 'BIG_BROTHER_V2');
    res.setHeader('X-Service-Version', '2.0.0');
    res.setHeader('X-Audit-Enabled', process.env.AUDIT_LOGGING || 'true');
    if (process.env.AUDIT_LOGGING === 'true') {
        logger.info('Compliance audit log', {
            component: 'Compliance',
            requestId: req.requestId,
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            timestamp: new Date().toISOString(),
            userAgent: req.get('User-Agent')
        });
    }
    next();
};
module.exports = {
    performanceMiddleware,
    apiRateLimit,
    voiceRateLimit,
    chatRateLimit,
    requestValidation,
    errorHandler,
    notFoundHandler,
    healthCheckBypass,
    complianceMiddleware
};