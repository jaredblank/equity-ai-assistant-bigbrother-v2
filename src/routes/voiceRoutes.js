const express = require('express');
const { voiceRateLimit, complianceMiddleware } = require('../utils/middleware');
const { validateVoiceSynthesis } = require('../utils/validators');
const logger = require('../utils/logger');
const AIService = require('../services/aiService');
const { getVoiceSettings } = require('../config/aiConfig');
const router = express.Router();
const aiService = new AIService();
router.post('/synthesize', voiceRateLimit, complianceMiddleware, validateVoiceSynthesis, async (req, res) => {
    const timer = logger.performance('voice-synthesize-endpoint', 'VoiceRoutes');
    try {
        const { text, voiceId, voiceSettings, outputFormat, modelId } = req.body;
        timer.addMetadata('textLength', text.length);
        timer.addMetadata('voiceId', voiceId || 'default');
        timer.addMetadata('outputFormat', outputFormat || 'mp3_44100_128');
        if (voiceSettings) {
            const validationErrors = aiService.validateVoiceSettings(voiceSettings);
            if (validationErrors.length > 0) {
                return res.status(400).json({ success: false, error: 'Invalid Voice Settings', message: 'Voice settings validation failed', details: validationErrors, requestId: req.requestId });
            }
        }
        const finalVoiceSettings = voiceSettings || getVoiceSettings('medium');
        const result = await aiService.synthesizeVoice(text, voiceId, finalVoiceSettings, outputFormat || 'mp3_44100_128');
        timer.addMetadata('audioSize', result.audioSize);
        timer.addMetadata('actualVoiceId', result.voiceId);
        timer.end('Voice synthesis completed successfully');
        const mimeTypes = { 'mp3_44100_128': 'audio/mpeg', 'mp3_22050_32': 'audio/mpeg', 'pcm_16000': 'audio/wav', 'pcm_22050': 'audio/wav', 'pcm_24000': 'audio/wav', 'pcm_44100': 'audio/wav' };
        const mimeType = mimeTypes[result.format] || 'audio/mpeg';
        const fileExtension = result.format.startsWith('mp3') ? 'mp3' : 'wav';
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Content-Length', result.audioSize);
        res.setHeader('X-Voice-ID', result.voiceId);
        res.setHeader('X-Text-Length', result.textLength);
        res.setHeader('X-Audio-Format', result.format);
        res.setHeader('Content-Disposition', `attachment; filename="synthesis.${fileExtension}"`);
        res.send(result.audioBuffer);
    } catch (error) {
        timer.endWithError(error, 'Voice synthesis failed');
        logger.error('Voice synthesis endpoint error', { component: 'VoiceRoutes', requestId: req.requestId, textLength: req.body?.text?.length || 0, error: error.message, stack: error.stack });
        res.status(500).json({ success: false, error: 'Voice Synthesis Failed', message: 'Unable to synthesize voice at this time', requestId: req.requestId });
    }
});
router.post('/chat-and-speak', voiceRateLimit, complianceMiddleware, async (req, res) => {
    const timer = logger.performance('chat-and-speak-endpoint', 'VoiceRoutes');
    try {
        const { message, conversationId, userId, context, voiceId, voiceSettings, outputFormat } = req.body;
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid Message', message: 'Message is required and cannot be empty', requestId: req.requestId });
        }
        timer.addMetadata('messageLength', message.length);
        timer.addMetadata('hasConversationId', !!conversationId);
        const chatResult = await aiService.processChatMessage(message, conversationId, userId, context || {});
        timer.addMetadata('responseLength', chatResult.response.length);
        timer.addMetadata('conversationId', chatResult.conversationId);
        const finalVoiceSettings = voiceSettings || getVoiceSettings('medium');
        const voiceResult = await aiService.synthesizeVoice(chatResult.response, voiceId, finalVoiceSettings, outputFormat || 'mp3_44100_128');
        timer.addMetadata('audioSize', voiceResult.audioSize);
        timer.end('Chat and speak completed successfully');
        res.json({ success: true, conversationId: chatResult.conversationId, response: chatResult.response, audio: { data: voiceResult.audioBuffer.toString('base64'), format: voiceResult.format, size: voiceResult.audioSize, voiceId: voiceResult.voiceId }, metadata: { ...chatResult.metadata, voiceSynthesis: { textLength: voiceResult.textLength, audioSize: voiceResult.audioSize, format: voiceResult.format }, requestId: req.requestId, timestamp: new Date().toISOString() } });
    } catch (error) {
        timer.endWithError(error, 'Chat and speak failed');
        logger.error('Chat and speak endpoint error', { component: 'VoiceRoutes', requestId: req.requestId, messageLength: req.body?.message?.length || 0, error: error.message, stack: error.stack });
        res.status(500).json({ success: false, error: 'Chat and Speak Failed', message: 'Unable to process message and synthesize voice', requestId: req.requestId });
    }
});
router.get('/voices', complianceMiddleware, async (req, res) => {
    const timer = logger.performance('get-voices-endpoint', 'VoiceRoutes');
    try {
        const voices = await aiService.getAvailableVoices();
        timer.addMetadata('voiceCount', voices.length);
        timer.end('Available voices retrieved');
        res.json({ success: true, voices, totalCount: voices.length, requestId: req.requestId });
    } catch (error) {
        timer.endWithError(error, 'Get voices failed');
        logger.error('Get voices endpoint error', { component: 'VoiceRoutes', requestId: req.requestId, error: error.message });
        res.status(500).json({ success: false, error: 'Voice Retrieval Failed', message: 'Unable to retrieve available voices', requestId: req.requestId });
    }
});
router.get('/settings/presets', complianceMiddleware, async (req, res) => {
    const timer = logger.performance('get-voice-presets-endpoint', 'VoiceRoutes');
    try {
        const presets = { high_quality: getVoiceSettings('high'), medium_quality: getVoiceSettings('medium'), fast_generation: getVoiceSettings('fast'), custom_example: { stability: 0.85, similarityBoost: 0.9, style: 0.1, useSpeakerBoost: true } };
        timer.end('Voice presets retrieved');
        res.json({ success: true, presets, description: { high_quality: 'Best quality, slower generation', medium_quality: 'Balanced quality and speed', fast_generation: 'Faster generation, good quality', custom_example: 'Example custom settings' }, requestId: req.requestId });
    } catch (error) {
        timer.endWithError(error, 'Get voice presets failed');
        logger.error('Get voice presets endpoint error', { component: 'VoiceRoutes', requestId: req.requestId, error: error.message });
        res.status(500).json({ success: false, error: 'Presets Retrieval Failed', message: 'Unable to retrieve voice presets', requestId: req.requestId });
    }
});
router.get('/stats', complianceMiddleware, async (req, res) => {
    const timer = logger.performance('get-voice-stats-endpoint', 'VoiceRoutes');
    try {
        const aiStats = aiService.getServiceStats();
        timer.end('Voice statistics retrieved');
        res.json({ success: true, statistics: { ...aiStats, service: 'voice', version: '2.0.0', compliance: 'BIG_BROTHER_V2', supportedFormats: ['mp3_44100_128', 'mp3_22050_32', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100'] }, requestId: req.requestId });
    } catch (error) {
        timer.endWithError(error, 'Get voice statistics failed');
        logger.error('Get voice statistics endpoint error', { component: 'VoiceRoutes', requestId: req.requestId, error: error.message });
        res.status(500).json({ success: false, error: 'Statistics Retrieval Failed', message: 'Unable to retrieve voice statistics', requestId: req.requestId });
    }
});
module.exports = router;