// @compliance BIG_BROTHER_V2
const axios = require('axios');
const FormData = require('form-data');
const logger = require('../utils/logger');
const { ELEVENLABS_CONFIG, AI_CONFIG, getSystemPrompt, getVoiceSettings } = require('../config/aiConfig');
const ConversationManager = require('./conversationManager');
class AIService {
    constructor() {
        this.conversationManager = new ConversationManager();
        this.elevenlabsClient = this.createElevenLabsClient();
        this.requestCount = 0;
        this.startTime = Date.now();
    }
    createElevenLabsClient() {
        return axios.create({
            baseURL: ELEVENLABS_CONFIG.apiUrl,
            timeout: ELEVENLABS_CONFIG.requestTimeout,
            headers: {
                'xi-api-key': ELEVENLABS_CONFIG.apiKey,
                'Content-Type': 'application/json'
            }
        });
    }
    async processChatMessage(message, conversationId = null, userId = null, context = {}) {
        const timer = logger.performance('ai-chat', 'AIService');
        this.requestCount++;
        try {
            let conversation = null;
            let conversationContext = [];
            if (conversationId) {
                conversation = await this.conversationManager.getConversation(conversationId);
                if (!conversation) {
                    throw new Error('Conversation not found');
                }
                conversationContext = await this.conversationManager.buildConversationContext(conversationId);
            } else {
                conversation = await this.conversationManager.createConversation(userId, context);
                conversationId = conversation.conversationId;
                conversationContext = [{
                    role: 'system',
                    content: getSystemPrompt('base')
                }];
            }
            await this.conversationManager.addMessage(
                conversationId, 
                'user', 
                message, 
                { context, timestamp: new Date().toISOString() }
            );
            conversationContext.push({
                role: 'user',
                content: message
            });
            const aiResponse = await this.generateAIResponse(conversationContext, context);
            await this.conversationManager.addMessage(
                conversationId,
                'assistant',
                aiResponse.content,
                {
                    model: AI_CONFIG.model,
                    temperature: AI_CONFIG.temperature,
                    responseTime: aiResponse.responseTime,
                    tokenCount: aiResponse.tokenCount
                }
            );
            timer.addMetadata('conversationId', conversationId);
            timer.addMetadata('responseLength', aiResponse.content.length);
            timer.end('Chat message processed');
            logger.conversationLog(userId, conversationId, 'message_processed', {
                messageLength: message.length,
                responseLength: aiResponse.content.length,
                responseTime: aiResponse.responseTime
            });
            return {
                conversationId,
                response: aiResponse.content,
                metadata: {
                    model: AI_CONFIG.model,
                    responseTime: aiResponse.responseTime,
                    tokenCount: aiResponse.tokenCount,
                    messageCount: conversation.messageCount + 2
                }
            };
        } catch (error) {
            timer.endWithError(error, 'Chat message processing failed');
            logger.error('Failed to process chat message', {
                component: 'AIService',
                conversationId,
                userId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }
    async generateAIResponse(conversationContext, context = {}) {
        const timer = logger.performance('ai-response-generation', 'AIService');
        const startTime = Date.now();
        try {
            const response = await this.simulateAIResponse(conversationContext, context);
            const responseTime = Date.now() - startTime;
            const tokenCount = this.estimateTokenCount(response);
            timer.addMetadata('responseTime', responseTime);
            timer.addMetadata('tokenCount', tokenCount);
            timer.end('AI response generated');
            return {
                content: response,
                responseTime,
                tokenCount,
                model: AI_CONFIG.model
            };
        } catch (error) {
            timer.endWithError(error, 'AI response generation failed');
            return {
                content: getSystemPrompt('error'),
                responseTime: Date.now() - startTime,
                tokenCount: 100,
                model: AI_CONFIG.model,
                error: true
            };
        }
    }
    async simulateAIResponse(conversationContext, context) {
        const userMessage = conversationContext[conversationContext.length - 1]?.content || '';
        if (userMessage.toLowerCase().includes('property') || userMessage.toLowerCase().includes('house')) {
            return "I'd be happy to help you with your property search! To provide you with the best recommendations, I'd like to know more about what you're looking for. What type of property interests you - residential, commercial, or investment? Also, do you have a preferred location or price range in mind?";
        }
        if (userMessage.toLowerCase().includes('price') || userMessage.toLowerCase().includes('market')) {
            return "Market analysis is one of my specialties! Property values can vary significantly based on location, property type, and current market conditions. To give you accurate pricing information, could you tell me the specific area you're interested in? I can provide recent sales data and market trends for that location.";
        }
        if (userMessage.toLowerCase().includes('schedule') || userMessage.toLowerCase().includes('viewing')) {
            return "I can absolutely help you schedule property viewings! I work with a network of experienced real estate agents who can arrange showings at your convenience. What properties are you interested in viewing, and what days/times work best for you?";
        }
        if (userMessage.toLowerCase().includes('agent') || userMessage.toLowerCase().includes('realtor')) {
            return "I'd be pleased to connect you with one of our qualified real estate agents! Our agents specialize in different areas and property types. What type of real estate services do you need, and what's your preferred location? This will help me match you with the most suitable agent.";
        }
        return "Hello! I'm Rachel, your real estate assistant. I'm here to help you with property searches, market analysis, scheduling viewings, and connecting you with the right real estate professionals. What can I assist you with today?";
    }
    async synthesizeVoice(text, voiceId = null, voiceSettings = null, outputFormat = 'mp3_44100_128') {
        const timer = logger.performance('voice-synthesis', 'AIService');
        const actualVoiceId = voiceId || ELEVENLABS_CONFIG.defaultVoiceId;
        const settings = voiceSettings || ELEVENLABS_CONFIG.defaultSettings;
        try {
            const requestData = {
                text: text,
                model_id: ELEVENLABS_CONFIG.defaultModelId,
                voice_settings: settings
            };
            const response = await this.elevenlabsClient.post(
                `/text-to-speech/${actualVoiceId}`,
                requestData,
                {
                    headers: {
                        'Accept': 'audio/mpeg',
                        'Content-Type': 'application/json'
                    },
                    responseType: 'arraybuffer'
                }
            );
            timer.addMetadata('textLength', text.length);
            timer.addMetadata('voiceId', actualVoiceId);
            timer.addMetadata('audioSize', response.data.length);
            timer.end('Voice synthesis completed');
            logger.voiceSynthesisLog(actualVoiceId, text.length, {
                outputFormat,
                audioSize: response.data.length,
                model: ELEVENLABS_CONFIG.defaultModelId
            });
            return {
                audioBuffer: Buffer.from(response.data),
                format: outputFormat,
                voiceId: actualVoiceId,
                textLength: text.length,
                audioSize: response.data.length
            };
        } catch (error) {
            timer.endWithError(error, 'Voice synthesis failed');
            logger.error('Voice synthesis failed', {
                component: 'AIService',
                voiceId: actualVoiceId,
                textLength: text.length,
                error: error.response?.data || error.message,
                stack: error.stack
            });
            throw error;
        }
    }
    async getAvailableVoices() {
        const timer = logger.performance('get-voices', 'AIService');
        try {
            const response = await this.elevenlabsClient.get('/voices');
            const voices = response.data.voices.map(voice => ({
                voiceId: voice.voice_id,
                name: voice.name,
                category: voice.category,
                description: voice.description,
                previewUrl: voice.preview_url,
                available: true
            }));
            timer.addMetadata('voiceCount', voices.length);
            timer.end('Available voices retrieved');
            return voices;
        } catch (error) {
            timer.endWithError(error, 'Failed to get available voices');
            logger.error('Failed to get available voices', {
                component: 'AIService',
                error: error.response?.data || error.message
            });
            throw error;
        }
    }
    getServiceStats() {
        return {
            requestCount: this.requestCount,
            uptime: Date.now() - this.startTime,
            averageRequestsPerMinute: (this.requestCount / ((Date.now() - this.startTime) / 60000)).toFixed(2),
            elevenlabsConfigured: !!ELEVENLABS_CONFIG.apiKey,
            aiModel: AI_CONFIG.model,
            defaultVoice: ELEVENLABS_CONFIG.defaultVoiceId
        };
    }
    estimateTokenCount(text) {
        return Math.ceil(text.length / 4);
    }
    validateVoiceSettings(settings) {
        const errors = [];
        if (settings.stability !== undefined && (settings.stability < 0 || settings.stability > 1)) {
            errors.push('Stability must be between 0 and 1');
        }
        if (settings.similarityBoost !== undefined && (settings.similarityBoost < 0 || settings.similarityBoost > 1)) {
            errors.push('Similarity boost must be between 0 and 1');
        }
        if (settings.style !== undefined && (settings.style < 0 || settings.style > 1)) {
            errors.push('Style must be between 0 and 1');
        }
        return errors;
    }
}
module.exports = AIService;