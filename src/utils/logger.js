const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    verbose: 4,
    debug: 5,
    silly: 6
};
const LOG_COLORS = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    verbose: 'cyan',
    debug: 'blue',
    silly: 'grey'
};
winston.addColors(LOG_COLORS);
const aiOperationFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, component, operation, duration, ...meta }) => {
        const logEntry = {
            timestamp,
            level: level.toUpperCase(),
            component: component || 'UNKNOWN',
            message,
            ...meta
        };
        if (operation) {
            logEntry.operation = operation;
        }
        if (duration !== undefined) {
            logEntry.duration_ms = duration;
            logEntry.performance_category = categorizePerformance(operation, duration);
        }
        return JSON.stringify(logEntry);
    })
);
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message, component, operation, duration, ...meta }) => {
        let logMessage = `${timestamp} [${level}] ${component || 'APP'}: ${message}`;
        if (operation && duration !== undefined) {
            logMessage += ` (${operation}: ${duration}ms)`;
        }
        if (Object.keys(meta).length > 0) {
            logMessage += ` ${JSON.stringify(meta)}`;
        }
        return logMessage;
    })
);
function categorizePerformance(operation, duration) {
    const thresholds = {
        'ai-chat': { good: 2000, acceptable: 5000 },
        'voice-synthesis': { good: 3000, acceptable: 8000 },
        'database-query': { good: 100, acceptable: 500 },
        'conversation-processing': { good: 1000, acceptable: 3000 },
        'broker-service': { good: 500, acceptable: 2000 },
        'default': { good: 1000, acceptable: 3000 }
    };
    const threshold = thresholds[operation] || thresholds.default;
    if (duration <= threshold.good) return 'EXCELLENT';
    if (duration <= threshold.acceptable) return 'ACCEPTABLE';
    return 'POOR';
}
function createTransports() {
    const transports = [];
    const logLevel = process.env.LOG_LEVEL || 'info';
    const maxFiles = process.env.LOG_MAX_FILES || '30';
    const maxSize = process.env.LOG_MAX_SIZE || '20m';
    
    // Always add console transport for production environments
    transports.push(new winston.transports.Console({
        level: process.env.NODE_ENV === 'development' ? 'debug' : logLevel,
        format: process.env.NODE_ENV === 'development' ? consoleFormat : aiOperationFormat
    }));
    
    // Only add file transports if explicitly enabled in production
    if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_FILE_LOGGING === 'true') {
        try {
            const logsDir = path.join(process.cwd(), 'logs');
            transports.push(new DailyRotateFile({
                filename: path.join(logsDir, 'bigbrother-ai-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                level: logLevel,
                format: aiOperationFormat,
                maxFiles,
                maxSize,
                zippedArchive: true
            }));
            transports.push(new DailyRotateFile({
                filename: path.join(logsDir, 'bigbrother-ai-error-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                level: 'error',
                format: aiOperationFormat,
                maxFiles,
                maxSize,
                zippedArchive: true
            }));
            if (process.env.ENABLE_PERFORMANCE_LOGGING === 'true') {
                transports.push(new DailyRotateFile({
                    filename: path.join(logsDir, 'bigbrother-ai-performance-%DATE%.log'),
                    datePattern: 'YYYY-MM-DD',
                    level: 'info',
                    format: aiOperationFormat,
                    maxFiles,
                    maxSize,
                    zippedArchive: true,
                    filter: (info) => info.operation && info.duration_ms !== undefined
                }));
            }
        } catch (error) {
            console.warn('File logging setup failed, using console only:', error.message);
        }
    }
    
    return transports;
}
const logger = winston.createLogger({
    levels: LOG_LEVELS,
    transports: createTransports(),
    exitOnError: false,
    defaultMeta: {
        service: 'bigbrother-ai-assistant-v2',
        version: '2.0.0',
        compliance: 'BIG_BROTHER_V2'
    }
});
class PerformanceTimer {
    constructor(operation, component) {
        this.operation = operation;
        this.component = component;
        this.startTime = Date.now();
        this.metadata = {};
    }
    addMetadata(key, value) {
        this.metadata[key] = value;
        return this;
    }
    end(message = 'Operation completed', level = 'info') {
        const duration = Date.now() - this.startTime;
        logger.log(level, message, {
            component: this.component,
            operation: this.operation,
            duration,
            ...this.metadata
        });
        return duration;
    }
    endWithError(error, message = 'Operation failed') {
        const duration = Date.now() - this.startTime;
        logger.error(message, {
            component: this.component,
            operation: this.operation,
            duration,
            error: error.message,
            stack: error.stack,
            ...this.metadata
        });
        return duration;
    }
}
logger.performance = (operation, component) => new PerformanceTimer(operation, component);
logger.aiOperation = (operation, component, metadata = {}) => {
    return logger.info(`AI operation started: ${operation}`, {
        component,
        operation,
        ...metadata
    });
};
logger.conversationLog = (userId, messageId, type, metadata = {}) => {
    if (process.env.CONVERSATION_LOGGING === 'true') {
        logger.info('Conversation activity', {
            component: 'Conversation',
            userId,
            messageId,
            type,
            ...metadata
        });
    }
};
logger.voiceSynthesisLog = (voiceId, textLength, metadata = {}) => {
    if (process.env.VOICE_SYNTHESIS_LOGGING === 'true') {
        logger.info('Voice synthesis activity', {
            component: 'VoiceSynthesis',
            voiceId,
            textLength,
            ...metadata
        });
    }
};
module.exports = logger;