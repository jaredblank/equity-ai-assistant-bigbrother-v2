// @compliance BIG_BROTHER_V2
const sql = require('mssql');
const logger = require('../utils/logger');
const DB_CONFIG = {
    server: process.env.DB_SERVER,
    port: parseInt(process.env.DB_PORT) || 1433, 
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: true,
        instanceName: process.env.DB_INSTANCE_NAME || undefined
    },
    connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000,
    requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT) || 30000,
    pool: {
        max: parseInt(process.env.DB_POOL_MAX) || 10,
        min: parseInt(process.env.DB_POOL_MIN) || 2,
        idleTimeoutMillis: 30000,
        acquireTimeoutMillis: 60000,
        createTimeoutMillis: 30000,
        destroyTimeoutMillis: 5000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 200
    }
};
let connectionPool = null;
let isConnected = false;
async function connect() {
    const timer = logger.performance('database-connect', 'Database');
    try {
        if (isConnected && connectionPool) {
            timer.end('Database already connected');
            return connectionPool;
        }
        validateConfig();
        connectionPool = new sql.ConnectionPool(DB_CONFIG);
        connectionPool.on('connect', () => logger.info('Database connection established', { component: 'Database', server: DB_CONFIG.server, database: DB_CONFIG.database }));
        connectionPool.on('close', () => { logger.warn('Database connection closed', { component: 'Database' }); isConnected = false; });
        connectionPool.on('error', (error) => { logger.error('Database connection error', { component: 'Database', error: error.message, stack: error.stack }); isConnected = false; });
        await connectionPool.connect();
        isConnected = true;
        timer.end('Database connection established');
        await testConnection();
        return connectionPool;
    } catch (error) {
        timer.endWithError(error, 'Database connection failed');
        logger.error('Failed to connect to database', { component: 'Database', server: DB_CONFIG.server, database: DB_CONFIG.database, error: error.message, stack: error.stack });
        throw error;
    }
}
function validateConfig() {
    const missing = ['server', 'database', 'user', 'password'].filter(field => !DB_CONFIG[field]);
    if (missing.length > 0) throw new Error(`Missing required database configuration: ${missing.join(', ')}`);
}
async function testConnection() {
    const timer = logger.performance('database-test', 'Database');
    try {
        const result = await new sql.Request(connectionPool).query('SELECT 1 as test, GETDATE() as timestamp');
        if (result.recordset && result.recordset.length > 0) {
            timer.end('Database connection test successful');
            logger.info('Database connection test passed', { component: 'Database', timestamp: result.recordset[0].timestamp });
        } else {
            throw new Error('Connection test returned no results');
        }
    } catch (error) {
        timer.endWithError(error, 'Database connection test failed');
        throw error;
    }
}
async function executeQuery(query, params = {}, operation = 'query') {
    const timer = logger.performance('database-query', 'Database');
    timer.addMetadata('operation', operation);
    timer.addMetadata('paramCount', Object.keys(params).length);
    try {
        if (!isConnected || !connectionPool) await connect();
        const request = new sql.Request(connectionPool);
        for (const [key, value] of Object.entries(params)) request.input(key, value);
        const result = await request.query(query);
        timer.addMetadata('rowsAffected', result.rowsAffected[0] || 0);
        timer.addMetadata('recordCount', result.recordset?.length || 0);
        timer.end(`Database ${operation} completed`);
        logger.info(`Database ${operation} executed`, { component: 'Database', operation, rowsAffected: result.rowsAffected[0] || 0, recordCount: result.recordset?.length || 0 });
        return result;
    } catch (error) {
        timer.endWithError(error, `Database ${operation} failed`);
        logger.error(`Database ${operation} error`, { component: 'Database', operation, error: error.message, query: query.substring(0, 200) + (query.length > 200 ? '...' : ''), stack: error.stack });
        throw error;
    }
}
async function executeStoredProcedure(procedureName, params = {}) {
    const timer = logger.performance('database-procedure', 'Database');
    timer.addMetadata('procedure', procedureName);
    timer.addMetadata('paramCount', Object.keys(params).length);
    try {
        if (!isConnected || !connectionPool) await connect();
        const request = new sql.Request(connectionPool);
        for (const [key, value] of Object.entries(params)) request.input(key, value);
        const result = await request.execute(procedureName);
        timer.addMetadata('rowsAffected', result.rowsAffected[0] || 0);
        timer.addMetadata('recordCount', result.recordset?.length || 0);
        timer.end('Stored procedure executed');
        logger.info('Stored procedure executed', { component: 'Database', procedure: procedureName, rowsAffected: result.rowsAffected[0] || 0, recordCount: result.recordset?.length || 0 });
        return result;
    } catch (error) {
        timer.endWithError(error, 'Stored procedure failed');
        logger.error('Stored procedure error', { component: 'Database', procedure: procedureName, error: error.message, stack: error.stack });
        throw error;
    }
}
async function getHealthStatus() {
    const timer = logger.performance('database-health', 'Database');
    try {
        const healthInfo = {
            connected: isConnected,
            poolSize: connectionPool?.pool?.size || 0,
            poolAvailable: connectionPool?.pool?.available || 0,
            poolPending: connectionPool?.pool?.pending || 0,
            server: DB_CONFIG.server,
            database: DB_CONFIG.database
        };
        if (isConnected) {
            const testResult = await executeQuery('SELECT GETDATE() as timestamp', {}, 'health-check');
            healthInfo.lastQuery = testResult.recordset[0].timestamp;
            healthInfo.status = 'healthy';
        } else {
            healthInfo.status = 'disconnected';
        }
        timer.end('Database health check completed');
        return healthInfo;
    } catch (error) {
        timer.endWithError(error, 'Database health check failed');
        return { connected: false, status: 'error', error: error.message, server: DB_CONFIG.server, database: DB_CONFIG.database };
    }
}
async function close() {
    const timer = logger.performance('database-close', 'Database');
    try {
        if (connectionPool) {
            await connectionPool.close();
            connectionPool = null;
            isConnected = false;
            timer.end('Database connection closed');
            logger.info('Database connection closed', { component: 'Database' });
        }
    } catch (error) {
        timer.endWithError(error, 'Database close failed');
        logger.error('Error closing database connection', { component: 'Database', error: error.message });
        throw error;
    }
}
module.exports = {
    connect, close, executeQuery, executeStoredProcedure, getHealthStatus,
    isConnected: () => isConnected, getPool: () => connectionPool, sql
};