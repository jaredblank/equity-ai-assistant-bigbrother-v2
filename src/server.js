const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();
const logger = require('./utils/logger');
const { performanceMiddleware, errorHandler, notFoundHandler } = require('./utils/middleware');
const database = require('./config/database');
const aiConfig = require('./config/aiConfig');
const chatRoutes = require('./routes/chatRoutes');
const voiceRoutes = require('./routes/voiceRoutes');
const healthRoutes = require('./routes/healthRoutes');
const app = express();
const PORT = process.env.PORT || 3005;
const HOST = process.env.HOST || 'localhost';
function initializeServer() {
    app.use(helmet({
        contentSecurityPolicy: {
            useDefaults: true,
            directives: {
                "default-src": ["'self'"],
                "script-src": ["'self'", "'unsafe-inline'"],
                "style-src": ["'self'", "'unsafe-inline'"],
                "img-src": ["'self'", "data:", "https:"],
                "connect-src": ["'self'", "https://api.elevenlabs.io"]
            }
        }
    }));
    const corsOptions = {
        origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    };
    app.use(cors(corsOptions));
    app.use(compression());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    app.use(performanceMiddleware);
    logger.info('Server middleware initialized', {
        component: 'Server',
        corsOrigins: corsOptions.origin,
        environment: process.env.NODE_ENV
    });
}
function initializeRoutes() {
    app.use('/api/chat', chatRoutes);
    app.use('/api/voice', voiceRoutes);
    app.use('/api/health', healthRoutes);
    app.get('/', (req, res) => {
        res.json({
            service: 'Big Brother AI Assistant v2',
            version: '2.0.0',
            status: 'operational',
            features: ['conversational-ai', 'voice-synthesis', 'real-estate-assistant'],
            compliance: 'BIG_BROTHER_V2',
            timestamp: new Date().toISOString()
        });
    });
    app.use(notFoundHandler);
    app.use(errorHandler);
    logger.info('Routes initialized', {
        component: 'Server',
        routes: ['/api/chat', '/api/voice', '/api/health']
    });
}
async function initializeDatabase() {
    try {
        await database.connect();
        logger.info('Database connection established', {
            component: 'Database',
            server: process.env.DB_SERVER,
            database: process.env.DB_NAME
        });
    } catch (error) {
        logger.error('Database connection failed', {
            component: 'Database',
            error: error.message,
            stack: error.stack
        });
        // Don't fail startup on database connection issues in development
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Starting without database connection in production', {
                component: 'Database'
            });
        }
    }
}
async function initializeAI() {
    try {
        await aiConfig.validateConfiguration();
        logger.info('AI configuration validated', {
            component: 'AI',
            model: process.env.AI_MODEL,
            elevenlabsConfigured: !!process.env.ELEVENLABS_API_KEY
        });
    } catch (error) {
        logger.error('AI configuration validation failed', {
            component: 'AI',
            error: error.message
        });
        // Don't fail startup on AI config issues - service can still handle health checks
        logger.warn('Starting with reduced AI functionality', {
            component: 'AI'
        });
    }
}
function setupGracefulShutdown(server) {
    const shutdown = async (signal) => {
        logger.info(`Received ${signal}, starting graceful shutdown`, {
            component: 'Server',
            signal
        });
        server.close(async () => {
            try {
                await database.close();
                logger.info('Database connections closed', {
                    component: 'Database'
                });
            } catch (error) {
                logger.error('Error closing database connections', {
                    component: 'Database',
                    error: error.message
                });
            }
            logger.info('Graceful shutdown completed', {
                component: 'Server'
            });
            process.exit(0);
        });
        setTimeout(() => {
            logger.error('Forced shutdown after timeout', {
                component: 'Server'
            });
            process.exit(1);
        }, 30000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}
async function startServer() {
    try {
        // Initialize with graceful degradation
        await initializeDatabase();
        await initializeAI();
        initializeServer();
        initializeRoutes();
        
        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info('Big Brother AI Assistant v2 server started', {
                component: 'Server',
                port: PORT,
                host: '0.0.0.0',
                environment: process.env.NODE_ENV,
                compliance: 'BIG_BROTHER_V2',
                features: ['conversational-ai', 'voice-synthesis', 'real-estate-assistant']
            });
        });
        setupGracefulShutdown(server);
        return server;
    } catch (error) {
        logger.error('Failed to start server', {
            component: 'Server',
            error: error.message,
            stack: error.stack
        });
        process.exit(1);
    }
}
if (require.main === module) {
    startServer();
}
module.exports = app;