const LOG_LEVEL_PRIORITY = {
    silent: 0,
    error: 1,
    warn: 2,
    info: 3,
    debug: 4,
};

const SENSITIVE_KEY_PATTERN = /(api[-_]?key|token|secret|authorization|cookie|password|passwd|session)/i;
const GEMINI_KEY_PATTERN = /AIza[0-9A-Za-z\-_]{20,}/g;
const REDACTED_TEXT = '[REDACTED]';

const normalizeLogLevel = (value) => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return LOG_LEVEL_PRIORITY[normalized] ? normalized : normalized === 'silent' ? 'silent' : '';
};

export const getServerLogLevel = () => {
    const explicitLevel = normalizeLogLevel(process.env.V_MATE_LOG_LEVEL || process.env.LOG_LEVEL);
    if (explicitLevel) {
        return explicitLevel;
    }

    if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
        return 'warn';
    }

    return 'info';
};

const isSensitiveKey = (key) => SENSITIVE_KEY_PATTERN.test(String(key || ''));

const redactSensitiveString = (value) => String(value).replace(GEMINI_KEY_PATTERN, REDACTED_TEXT);

export const sanitizeLogMetadata = (value, key = '', seen = new WeakSet()) => {
    if (value === null || typeof value === 'undefined') {
        return value;
    }

    if (isSensitiveKey(key)) {
        return REDACTED_TEXT;
    }

    if (typeof value === 'string') {
        return redactSensitiveString(value);
    }

    if (typeof value !== 'object') {
        return value;
    }

    if (seen.has(value)) {
        return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeLogMetadata(item, '', seen));
    }

    const sanitized = {};
    for (const [childKey, childValue] of Object.entries(value)) {
        sanitized[childKey] = sanitizeLogMetadata(childValue, childKey, seen);
    }
    return sanitized;
};

const shouldLog = (level) => {
    const currentLevel = getServerLogLevel();
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[currentLevel];
};

const emit = (level, message, metadata) => {
    if (!shouldLog(level)) {
        return;
    }

    const formattedMessage = String(message || '');
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (typeof metadata === 'undefined') {
        sink(formattedMessage);
        return;
    }

    sink(formattedMessage, sanitizeLogMetadata(metadata));
};

export const logServerError = (message, metadata) => emit('error', message, metadata);
export const logServerWarn = (message, metadata) => emit('warn', message, metadata);
export const logServerInfo = (message, metadata) => emit('info', message, metadata);
export const logServerDebug = (message, metadata) => emit('debug', message, metadata);
