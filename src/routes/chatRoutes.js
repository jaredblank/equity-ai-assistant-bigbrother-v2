const express = require('express');
const { chatRateLimit, complianceMiddleware } = require('../utils/middleware');
const { validateChatMessage, validateConversationHistory } = require('../utils/validators');
const logger = require('../utils/logger');
const AIService = require('../services/aiService');
const ConversationManager = require('../services/conversationManager');
const router = express.Router();
const aiService = new AIService();
const conversationManager = new ConversationManager();
router.post('/message', chatRateLimit, complianceMiddleware, validateChatMessage, async (req, res) => {
    const timer = logger.performance('chat-message-endpoint', 'ChatRoutes');
    try {
        const { message, conversationId, userId, context, metadata } = req.body;
        timer.addMetadata('messageLength', message.length);
        timer.addMetadata('hasConversationId', !!conversationId);
        timer.addMetadata('hasUserId', !!userId);
        const result = await aiService.processChatMessage(message, conversationId, userId, context || {});
        timer.addMetadata('responseLength', result.response.length);
        timer.addMetadata('conversationId', result.conversationId);
        timer.end('Chat message processed successfully');
        res.json({ success: true, conversationId: result.conversationId, response: result.response, metadata: { ...result.metadata, requestId: req.requestId, timestamp: new Date().toISOString() } });
    } catch (error) {
        timer.endWithError(error, 'Chat message processing failed');
        logger.error('Chat message endpoint error', { component: 'ChatRoutes', requestId: req.requestId, error: error.message, stack: error.stack });
        res.status(500).json({ success: false, error: 'Chat Processing Failed', message: 'Unable to process your message at this time', requestId: req.requestId });
    }
});
router.get('/conversation/:conversationId', complianceMiddleware, async (req, res) => {
    const timer = logger.performance('get-conversation-endpoint', 'ChatRoutes');
    const { conversationId } = req.params;
    try {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
            return res.status(400).json({ success: false, error: 'Invalid Conversation ID', message: 'Conversation ID must be a valid UUID', requestId: req.requestId });
        }
        const conversation = await conversationManager.getConversation(conversationId);
        if (!conversation) {
            timer.end('Conversation not found');
            return res.status(404).json({ success: false, error: 'Conversation Not Found', message: 'The specified conversation does not exist', requestId: req.requestId });
        }
        timer.addMetadata('conversationId', conversationId);
        timer.addMetadata('messageCount', conversation.messageCount);
        timer.end('Conversation details retrieved');
        res.json({ success: true, conversation, requestId: req.requestId });
    } catch (error) {
        timer.endWithError(error, 'Get conversation failed');
        logger.error('Get conversation endpoint error', { component: 'ChatRoutes', requestId: req.requestId, conversationId, error: error.message });
        res.status(500).json({ success: false, error: 'Conversation Retrieval Failed', message: 'Unable to retrieve conversation details', requestId: req.requestId });
    }
});
router.get('/conversation/:conversationId/history', complianceMiddleware, validateConversationHistory, async (req, res) => {
    const timer = logger.performance('get-conversation-history-endpoint', 'ChatRoutes');
    const { conversationId } = req.params;
    const { limit, offset, includeMetadata } = req.query;
    try {
        const messages = await conversationManager.getConversationHistory(conversationId, parseInt(limit) || 20, parseInt(offset) || 0);
        const filteredMessages = messages.map(msg => {
            const message = { messageId: msg.messageId, role: msg.role, content: msg.content, createdAt: msg.createdAt };
            if (includeMetadata === 'true') {
                message.metadata = msg.metadata;
                message.tokenCount = msg.tokenCount;
            }
            return message;
        });
        timer.addMetadata('conversationId', conversationId);
        timer.addMetadata('messageCount', filteredMessages.length);
        timer.end('Conversation history retrieved');
        res.json({ success: true, conversationId, messages: filteredMessages, pagination: { limit: parseInt(limit) || 20, offset: parseInt(offset) || 0, total: filteredMessages.length }, requestId: req.requestId });
    } catch (error) {
        timer.endWithError(error, 'Get conversation history failed');
        logger.error('Get conversation history endpoint error', { component: 'ChatRoutes', requestId: req.requestId, conversationId, error: error.message });
        res.status(500).json({ success: false, error: 'History Retrieval Failed', message: 'Unable to retrieve conversation history', requestId: req.requestId });
    }
});
router.put('/conversation/:conversationId/status', complianceMiddleware, async (req, res) => {
    const timer = logger.performance('update-conversation-status-endpoint', 'ChatRoutes');
    const { conversationId } = req.params;
    const { status, metadata } = req.body;
    try {
        const validStatuses = ['active', 'paused', 'completed', 'archived'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid Status', message: `Status must be one of: ${validStatuses.join(', ')}`, requestId: req.requestId });
        }
        await conversationManager.updateConversationStatus(conversationId, status, metadata);
        timer.addMetadata('conversationId', conversationId);
        timer.addMetadata('newStatus', status);
        timer.end('Conversation status updated');
        res.json({ success: true, conversationId, status, updatedAt: new Date().toISOString(), requestId: req.requestId });
    } catch (error) {
        timer.endWithError(error, 'Update conversation status failed');
        logger.error('Update conversation status endpoint error', { component: 'ChatRoutes', requestId: req.requestId, conversationId, status, error: error.message });
        res.status(500).json({ success: false, error: 'Status Update Failed', message: 'Unable to update conversation status', requestId: req.requestId });
    }
});
router.get('/conversations/user/:userId', complianceMiddleware, async (req, res) => {
    const timer = logger.performance('get-user-conversations-endpoint', 'ChatRoutes');
    const { userId } = req.params;
    const { limit = 10, offset = 0 } = req.query;
    try {
        const conversations = await conversationManager.getUserConversations(userId, parseInt(limit), parseInt(offset));
        timer.addMetadata('userId', userId);
        timer.addMetadata('conversationCount', conversations.length);
        timer.end('User conversations retrieved');
        res.json({ success: true, userId, conversations, pagination: { limit: parseInt(limit), offset: parseInt(offset), total: conversations.length }, requestId: req.requestId });
    } catch (error) {
        timer.endWithError(error, 'Get user conversations failed');
        logger.error('Get user conversations endpoint error', { component: 'ChatRoutes', requestId: req.requestId, userId, error: error.message });
        res.status(500).json({ success: false, error: 'User Conversations Retrieval Failed', message: 'Unable to retrieve user conversations', requestId: req.requestId });
    }
});
router.get('/stats', complianceMiddleware, async (req, res) => {
    const timer = logger.performance('get-chat-stats-endpoint', 'ChatRoutes');
    try {
        const aiStats = aiService.getServiceStats();
        timer.end('Chat statistics retrieved');
        res.json({ success: true, statistics: { ...aiStats, service: 'chat', version: '2.0.0', compliance: 'BIG_BROTHER_V2' }, requestId: req.requestId });
    } catch (error) {
        timer.endWithError(error, 'Get chat statistics failed');
        logger.error('Get chat statistics endpoint error', { component: 'ChatRoutes', requestId: req.requestId, error: error.message });
        res.status(500).json({ success: false, error: 'Statistics Retrieval Failed', message: 'Unable to retrieve chat statistics', requestId: req.requestId });
    }
});
module.exports = router;