// @compliance BIG_BROTHER_V2
const Joi = require('joi');
const logger = require('./logger');
const VALIDATION_PATTERNS = {
    UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    SQL_INJECTION: /('|(\\)|;|--|\/\*|\*\/|xp_|sp_|exec|execute|select|insert|update|delete|drop|create|alter)/i,
    HTML_TAGS: /<[^>]*>/g,
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    PHONE: /^\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}$/
};
function sanitizeString(value) {
    if (typeof value !== 'string') return value;
    let sanitized = value.replace(VALIDATION_PATTERNS.HTML_TAGS, '');
    sanitized = sanitized.trim();
    if (VALIDATION_PATTERNS.SQL_INJECTION.test(sanitized)) {
        throw new Error('Potentially malicious input detected');
    }
    return sanitized;
}
const customJoi = Joi.extend({
    type: 'string',
    base: Joi.string(),
    messages: {
        'string.sanitized': 'Input contains potentially malicious content'
    },
    rules: {
        sanitized: {
            method() {
                return this.$_addRule({ name: 'sanitized' });
            },
            validate(value, helpers) {
                try {
                    return sanitizeString(value);
                } catch (error) {
                    return helpers.error('string.sanitized');
                }
            }
        }
    }
});
const chatMessageSchema = customJoi.object({
    message: customJoi.string()
        .sanitized()
        .min(1)
        .max(2000)
        .required()
        .messages({
            'string.min': 'Message cannot be empty',
            'string.max': 'Message cannot exceed 2000 characters'
        }),
    conversationId: customJoi.string()
        .pattern(VALIDATION_PATTERNS.UUID)
        .optional()
        .messages({
            'string.pattern.base': 'Invalid conversation ID format'
        }),
    userId: customJoi.string()
        .sanitized()
        .min(1)
        .max(100)
        .optional(),
    context: customJoi.object({
        propertyType: customJoi.string().valid('residential', 'commercial', 'land', 'investment').optional(),
        location: customJoi.string().sanitized().max(200).optional(),
        priceRange: customJoi.object({
            min: customJoi.number().min(0).optional(),
            max: customJoi.number().min(0).optional()
        }).optional(),
        urgency: customJoi.string().valid('low', 'medium', 'high', 'urgent').optional()
    }).optional(),
    metadata: customJoi.object().optional()
});
const voiceSynthesisSchema = customJoi.object({
    text: customJoi.string()
        .sanitized()
        .min(1)
        .max(5000)
        .required()
        .messages({
            'string.min': 'Text cannot be empty',
            'string.max': 'Text cannot exceed 5000 characters'
        }),
    voiceId: customJoi.string()
        .alphanum()
        .min(10)
        .max(50)
        .optional()
        .messages({
            'string.alphanum': 'Voice ID must contain only alphanumeric characters'
        }),
    voiceSettings: customJoi.object({
        stability: customJoi.number().min(0).max(1).optional(),
        similarityBoost: customJoi.number().min(0).max(1).optional(),
        style: customJoi.number().min(0).max(1).optional(),
        useSpeakerBoost: customJoi.boolean().optional()
    }).optional(),
    outputFormat: customJoi.string()
        .valid('mp3_44100_128', 'mp3_22050_32', 'pcm_16000', 'pcm_22050', 'pcm_24000', 'pcm_44100')
        .optional()
        .default('mp3_44100_128'),
    modelId: customJoi.string()
        .valid('eleven_monolingual_v1', 'eleven_multilingual_v1', 'eleven_multilingual_v2', 'eleven_turbo_v2')
        .optional()
});
const conversationHistorySchema = customJoi.object({
    conversationId: customJoi.string()
        .pattern(VALIDATION_PATTERNS.UUID)
        .required(),
    limit: customJoi.number()
        .integer()
        .min(1)
        .max(100)
        .optional()
        .default(20),
    offset: customJoi.number()
        .integer()
        .min(0)
        .optional()
        .default(0),
    includeMetadata: customJoi.boolean()
        .optional()
        .default(false)
});
const brokerServiceSchema = customJoi.object({
    action: customJoi.string()
        .valid('search_properties', 'get_market_analysis', 'schedule_showing', 'get_agent_info')
        .required(),
    parameters: customJoi.object({
        location: customJoi.string().sanitized().max(200).optional(),
        propertyType: customJoi.string().valid('residential', 'commercial', 'land', 'investment').optional(),
        minPrice: customJoi.number().min(0).optional(),
        maxPrice: customJoi.number().min(0).optional(),
        bedrooms: customJoi.number().integer().min(0).max(20).optional(),
        bathrooms: customJoi.number().min(0).max(20).optional(),
        squareFootage: customJoi.object({
            min: customJoi.number().min(0).optional(),
            max: customJoi.number().min(0).optional()
        }).optional(),
        clientName: customJoi.string().sanitized().max(100).optional(),
        clientEmail: customJoi.string().pattern(VALIDATION_PATTERNS.EMAIL).optional(),
        clientPhone: customJoi.string().pattern(VALIDATION_PATTERNS.PHONE).optional(),
        preferredDate: customJoi.date().min('now').optional(),
        timeSlot: customJoi.string().valid('morning', 'afternoon', 'evening').optional()
    }).optional()
});
const healthCheckSchema = customJoi.object({
    detailed: customJoi.boolean().optional().default(false),
    includeMetrics: customJoi.boolean().optional().default(false)
});
function createValidationMiddleware(schema, property = 'body') {
    return (req, res, next) => {
        const timer = logger.performance('input-validation', 'Validator');
        try {
            const { error, value } = schema.validate(req[property], {
                abortEarly: false,
                stripUnknown: true,
                convert: true
            });
            if (error) {
                timer.endWithError(error, 'Validation failed');
                const validationErrors = error.details.map(detail => ({
                    field: detail.path.join('.'),
                    message: detail.message,
                    value: detail.context?.value
                }));
                logger.warn('Validation failed', {
                    component: 'Validator',
                    requestId: req.requestId,
                    errors: validationErrors,
                    property
                });
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Input validation failed',
                    details: validationErrors,
                    requestId: req.requestId
                });
            }
            req[property] = value;
            timer.end('Validation completed');
            next();
        } catch (validationError) {
            timer.endWithError(validationError, 'Validation exception');
            logger.error('Validation exception', {
                component: 'Validator',
                requestId: req.requestId,
                error: validationError.message,
                stack: validationError.stack
            });
            res.status(500).json({
                error: 'Validation Error',
                message: 'Internal validation error',
                requestId: req.requestId
            });
        }
    };
}
const validateChatMessage = createValidationMiddleware(chatMessageSchema);
const validateVoiceSynthesis = createValidationMiddleware(voiceSynthesisSchema);
const validateConversationHistory = createValidationMiddleware(conversationHistorySchema, 'query');
const validateBrokerService = createValidationMiddleware(brokerServiceSchema);
const validateHealthCheck = createValidationMiddleware(healthCheckSchema, 'query');
module.exports = {
    chatMessageSchema,
    voiceSynthesisSchema,
    conversationHistorySchema,
    brokerServiceSchema,
    healthCheckSchema,
    validateChatMessage,
    validateVoiceSynthesis,
    validateConversationHistory,
    validateBrokerService,
    validateHealthCheck,
    sanitizeString,
    VALIDATION_PATTERNS
};