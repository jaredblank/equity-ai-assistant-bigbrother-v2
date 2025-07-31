// @compliance BIG_BROTHER_V2
const logger = require('../utils/logger');
const AI_CONFIG = {
    model: process.env.AI_MODEL || 'gpt-4-turbo-preview',
    temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.7,
    maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 1000,
    systemPromptVersion: process.env.AI_SYSTEM_PROMPT_VERSION || 'v2.0',
    conversationMemoryLimit: parseInt(process.env.AI_CONVERSATION_MEMORY_LIMIT) || 20,
    responseTimeout: parseInt(process.env.AI_RESPONSE_TIMEOUT) || 30000
};
const ELEVENLABS_CONFIG = {
    apiKey: process.env.ELEVENLABS_API_KEY,
    apiUrl: process.env.ELEVENLABS_API_URL || 'https://api.elevenlabs.io/v1',
    defaultVoiceId: process.env.ELEVENLABS_VOICE_ID,
    defaultModelId: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
    defaultSettings: {
        stability: parseFloat(process.env.ELEVENLABS_STABILITY) || 0.75,
        similarityBoost: parseFloat(process.env.ELEVENLABS_SIMILARITY_BOOST) || 0.75,
        style: parseFloat(process.env.ELEVENLABS_STYLE) || 0.0,
        useSpeakerBoost: process.env.ELEVENLABS_USE_SPEAKER_BOOST === 'true'
    },
    requestTimeout: 30000,
    maxRetries: 3,
    retryDelay: 1000
};
const SYSTEM_PROMPTS = {
    'v2.0': {
        base: `You are Rachel, a knowledgeable real estate assistant. Help with property searches, market analysis, viewings, and guidance. Be professional, warm, patient with first-time buyers, efficient with investors. Ask clarifying questions, provide actionable information, respect privacy, never guarantee values.`,
        conversation: `Continue as Rachel, the real estate assistant. Maintain consistency with conversation history and adapt based on client's experience level, preferences, communication style, and process stage. Reference previous points, ask follow-ups, provide next steps.`,
        error: `I apologize for the technical issue. As Rachel, I can help with property searches, market analysis, viewings, process guidance, and agent connections. Please rephrase your question.`
    }
};
const VOICE_CONFIG = {
    supportedFormats: ['mp3_44100_128', 'mp3_22050_32', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100'],
    supportedModels: ['eleven_monolingual_v1', 'eleven_multilingual_v1', 'eleven_multilingual_v2', 'eleven_turbo_v2'],
    defaultFormat: 'mp3_44100_128',
    maxTextLength: 5000,
    minTextLength: 1,
    qualitySettings: {
        high: { stability: 0.8, similarityBoost: 0.8, style: 0.2 },
        medium: { stability: 0.75, similarityBoost: 0.75, style: 0.0 },
        fast: { stability: 0.7, similarityBoost: 0.7, style: 0.0 }
    }
};
const PERFORMANCE_THRESHOLDS = {
    aiResponse: { excellent: 2000, acceptable: 5000, poor: 10000 },
    voiceSynthesis: { excellent: 3000, acceptable: 8000, poor: 15000 },
    conversationProcessing: { excellent: 1000, acceptable: 3000, poor: 6000 }
};
async function validateConfiguration() {
    const timer = logger.performance('config-validation', 'AIConfig');
    try {
        const issues = [];
        if (!AI_CONFIG.model) issues.push('AI_MODEL not configured');
        if (AI_CONFIG.temperature < 0 || AI_CONFIG.temperature > 2) issues.push('AI_TEMPERATURE must be between 0 and 2');
        if (AI_CONFIG.maxTokens < 100 || AI_CONFIG.maxTokens > 4000) issues.push('AI_MAX_TOKENS must be between 100 and 4000');
        if (!ELEVENLABS_CONFIG.apiKey) issues.push('ELEVENLABS_API_KEY not configured');
        if (!ELEVENLABS_CONFIG.defaultVoiceId) issues.push('ELEVENLABS_VOICE_ID not configured');
        const s = ELEVENLABS_CONFIG.defaultSettings;
        if (s.stability < 0 || s.stability > 1) issues.push('ELEVENLABS_STABILITY must be between 0 and 1');
        if (s.similarityBoost < 0 || s.similarityBoost > 1) issues.push('ELEVENLABS_SIMILARITY_BOOST must be between 0 and 1');
        if (s.style < 0 || s.style > 1) issues.push('ELEVENLABS_STYLE must be between 0 and 1');
        if (!SYSTEM_PROMPTS[AI_CONFIG.systemPromptVersion]) issues.push(`System prompt version ${AI_CONFIG.systemPromptVersion} not found`);
        if (issues.length > 0) {
            const error = new Error(`Configuration validation failed: ${issues.join(', ')}`);
            timer.endWithError(error);
            throw error;
        }
        timer.end('Configuration validation completed');
        logger.info('AI configuration validated successfully', { component: 'AIConfig', model: AI_CONFIG.model, promptVersion: AI_CONFIG.systemPromptVersion, voiceConfigured: !!ELEVENLABS_CONFIG.apiKey });
    } catch (error) {
        timer.endWithError(error, 'Configuration validation failed');
        throw error;
    }
}
function getSystemPrompt(type = 'base', version = null) {
    const promptVersion = version || AI_CONFIG.systemPromptVersion;
    const prompts = SYSTEM_PROMPTS[promptVersion];
    if (!prompts) {
        logger.error('System prompt version not found', { component: 'AIConfig', version: promptVersion, type });
        return SYSTEM_PROMPTS['v2.0'][type] || SYSTEM_PROMPTS['v2.0'].base;
    }
    return prompts[type] || prompts.base;
}
function getVoiceSettings(quality = 'medium', customSettings = {}) {
    const baseSettings = VOICE_CONFIG.qualitySettings[quality] || VOICE_CONFIG.qualitySettings.medium;
    return { ...ELEVENLABS_CONFIG.defaultSettings, ...baseSettings, ...customSettings };
}
function getPerformanceThreshold(operation) {
    return PERFORMANCE_THRESHOLDS[operation] || { excellent: 1000, acceptable: 3000, poor: 6000 };
}
module.exports = {
    AI_CONFIG,
    ELEVENLABS_CONFIG,
    VOICE_CONFIG,
    SYSTEM_PROMPTS,
    PERFORMANCE_THRESHOLDS,
    validateConfiguration,
    getSystemPrompt,
    getVoiceSettings,
    getPerformanceThreshold
};