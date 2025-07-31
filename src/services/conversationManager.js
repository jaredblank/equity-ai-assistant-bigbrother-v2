// @compliance BIG_BROTHER_V2
const { v4: uuidv4 } = require('uuid');
const database = require('../config/database');
const logger = require('../utils/logger');
const { getSystemPrompt } = require('../config/aiConfig');
class ConversationManager {
    constructor() {
        this.maxConversationLength = parseInt(process.env.AI_CONVERSATION_MEMORY_LIMIT) || 20;
        this.dataRetentionDays = parseInt(process.env.DATA_RETENTION_DAYS) || 90;
    }
    async createConversation(userId, metadata = {}) {
        const timer = logger.performance('create-conversation', 'ConversationManager');
        const conversationId = uuidv4();
        try {
            const query = `INSERT INTO Conversations (conversation_id, user_id, created_at, updated_at, status, metadata, message_count) VALUES (@conversationId, @userId, GETDATE(), GETDATE(), 'active', @metadata, 0)`;
            await database.executeQuery(query, { conversationId, userId: userId || 'anonymous', metadata: JSON.stringify(metadata) }, 'create-conversation');
            timer.end('Conversation created');
            logger.conversationLog(userId, conversationId, 'conversation_created', { conversationId, metadata });
            return { conversationId, userId: userId || 'anonymous', status: 'active', createdAt: new Date(), metadata, messageCount: 0 };
        } catch (error) {
            timer.endWithError(error, 'Failed to create conversation');
            logger.error('Failed to create conversation', { component: 'ConversationManager', userId, error: error.message, stack: error.stack });
            throw error;
        }
    }
    async getConversation(conversationId) {
        const timer = logger.performance('get-conversation', 'ConversationManager');
        try {
            const query = `SELECT conversation_id, user_id, created_at, updated_at, status, metadata, message_count FROM Conversations WHERE conversation_id = @conversationId AND status != 'deleted'`;
            const result = await database.executeQuery(query, { conversationId }, 'get-conversation');
            if (!result.recordset || result.recordset.length === 0) {
                timer.end('Conversation not found');
                return null;
            }
            const conversation = result.recordset[0];
            timer.end('Conversation retrieved');
            return { conversationId: conversation.conversation_id, userId: conversation.user_id, createdAt: conversation.created_at, updatedAt: conversation.updated_at, status: conversation.status, metadata: JSON.parse(conversation.metadata || '{}'), messageCount: conversation.message_count };
        } catch (error) {
            timer.endWithError(error, 'Failed to get conversation');
            logger.error('Failed to get conversation', { component: 'ConversationManager', conversationId, error: error.message });
            throw error;
        }
    }
    async addMessage(conversationId, role, content, metadata = {}) {
        const timer = logger.performance('add-message', 'ConversationManager');
        const messageId = uuidv4();
        try {
            const query = `BEGIN TRANSACTION; INSERT INTO Messages (message_id, conversation_id, role, content, created_at, metadata, token_count) VALUES (@messageId, @conversationId, @role, @content, GETDATE(), @metadata, @tokenCount); UPDATE Conversations SET message_count = message_count + 1, updated_at = GETDATE() WHERE conversation_id = @conversationId; COMMIT TRANSACTION;`;
            const tokenCount = this.estimateTokenCount(content);
            await database.executeQuery(query, { messageId, conversationId, role, content, metadata: JSON.stringify(metadata), tokenCount }, 'add-message');
            timer.end('Message added to conversation');
            logger.conversationLog(null, messageId, 'message_added', { conversationId, role, contentLength: content.length, tokenCount });
            return { messageId, conversationId, role, content, createdAt: new Date(), metadata, tokenCount };
        } catch (error) {
            timer.endWithError(error, 'Failed to add message');
            logger.error('Failed to add message', { component: 'ConversationManager', conversationId, role, error: error.message });
            throw error;
        }
    }
    async getConversationHistory(conversationId, limit = null, offset = 0) {
        const timer = logger.performance('get-conversation-history', 'ConversationManager');
        const messageLimit = limit || this.maxConversationLength;
        try {
            const query = `SELECT TOP (@limit) message_id, role, content, created_at, metadata, token_count FROM Messages WHERE conversation_id = @conversationId ORDER BY created_at DESC OFFSET @offset ROWS`;
            const result = await database.executeQuery(query, { conversationId, limit: messageLimit, offset }, 'get-conversation-history');
            const messages = result.recordset.map(msg => ({ messageId: msg.message_id, role: msg.role, content: msg.content, createdAt: msg.created_at, metadata: JSON.parse(msg.metadata || '{}'), tokenCount: msg.token_count })).reverse();
            timer.addMetadata('messageCount', messages.length);
            timer.end('Conversation history retrieved');
            return messages;
        } catch (error) {
            timer.endWithError(error, 'Failed to get conversation history');
            logger.error('Failed to get conversation history', { component: 'ConversationManager', conversationId, error: error.message });
            throw error;
        }
    }
    async buildConversationContext(conversationId, includeSystemPrompt = true) {
        const timer = logger.performance('build-conversation-context', 'ConversationManager');
        try {
            const messages = await this.getConversationHistory(conversationId);
            const context = [];
            if (includeSystemPrompt) context.push({ role: 'system', content: getSystemPrompt('conversation') });
            messages.forEach(msg => context.push({ role: msg.role, content: msg.content }));
            timer.addMetadata('contextLength', context.length);
            timer.end('Conversation context built');
            return context;
        } catch (error) {
            timer.endWithError(error, 'Failed to build conversation context');
            throw error;
        }
    }
    async updateConversationStatus(conversationId, status, metadata = null) {
        const timer = logger.performance('update-conversation-status', 'ConversationManager');
        try {
            let query = `UPDATE Conversations SET status = @status, updated_at = GETDATE()`;
            const params = { conversationId, status };
            if (metadata) { query += `, metadata = @metadata`; params.metadata = JSON.stringify(metadata); }
            query += ` WHERE conversation_id = @conversationId`;
            const result = await database.executeQuery(query, params, 'update-conversation-status');
            if (result.rowsAffected[0] === 0) throw new Error('Conversation not found');
            timer.end('Conversation status updated');
            logger.conversationLog(null, conversationId, 'status_updated', { conversationId, newStatus: status });
        } catch (error) {
            timer.endWithError(error, 'Failed to update conversation status');
            logger.error('Failed to update conversation status', { component: 'ConversationManager', conversationId, status, error: error.message });
            throw error;
        }
    }
    async getUserConversations(userId, limit = 10, offset = 0) {
        const timer = logger.performance('get-user-conversations', 'ConversationManager');
        try {
            const query = `SELECT conversation_id, created_at, updated_at, status, metadata, message_count FROM Conversations WHERE user_id = @userId AND status != 'deleted' ORDER BY updated_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`;
            const result = await database.executeQuery(query, { userId, limit, offset }, 'get-user-conversations');
            const conversations = result.recordset.map(conv => ({ conversationId: conv.conversation_id, createdAt: conv.created_at, updatedAt: conv.updated_at, status: conv.status, metadata: JSON.parse(conv.metadata || '{}'), messageCount: conv.message_count }));
            timer.addMetadata('conversationCount', conversations.length);
            timer.end('User conversations retrieved');
            return conversations;
        } catch (error) {
            timer.endWithError(error, 'Failed to get user conversations');
            throw error;
        }
    }
    async cleanupOldConversations() {
        const timer = logger.performance('cleanup-conversations', 'ConversationManager');
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.dataRetentionDays);
            const query = `UPDATE Conversations SET status = 'deleted', updated_at = GETDATE() WHERE created_at < @cutoffDate AND status != 'deleted'`;
            const result = await database.executeQuery(query, { cutoffDate }, 'cleanup-conversations');
            timer.addMetadata('cleanedCount', result.rowsAffected[0]);
            timer.end('Conversation cleanup completed');
            logger.info('Conversation cleanup completed', { component: 'ConversationManager', cleanedCount: result.rowsAffected[0], cutoffDate });
            return result.rowsAffected[0];
        } catch (error) {
            timer.endWithError(error, 'Conversation cleanup failed');
            throw error;
        }
    }
    estimateTokenCount(text) {
        return Math.ceil(text.length / 4);
    }
}
module.exports = ConversationManager;