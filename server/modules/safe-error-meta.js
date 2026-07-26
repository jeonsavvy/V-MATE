const SAFE_ERROR_CLASSES = Object.freeze({
    timeout: 'timeout',
    rateLimited: 'rate_limited',
    network: 'network',
    permission: 'permission',
    conflict: 'conflict',
    notFound: 'not_found',
    invalid: 'invalid',
    unavailable: 'unavailable',
    unknown: 'unknown',
});

const readErrorStatus = (error) => {
    const candidates = [
        error?.status,
        error?.statusCode,
        error?.cause?.status,
        error?.cause?.statusCode,
    ];
    for (const candidate of candidates) {
        const parsed = Number(candidate);
        if (Number.isInteger(parsed) && parsed >= 400 && parsed <= 599) {
            return parsed;
        }
    }
    return null;
};

const readErrorSignal = (error) => [
    error?.name,
    error?.code,
    error?.message,
    error?.cause?.name,
    error?.cause?.code,
    error?.cause?.message,
    typeof error === 'string' ? error : '',
].filter(Boolean).join(' ').toLowerCase();

export const classifySafeError = (error) => {
    const statusCode = readErrorStatus(error);
    const signal = readErrorSignal(error);

    if (statusCode === 408 || statusCode === 504 || /(abort|deadline|timed?\s*out|etimedout)/i.test(signal)) {
        return SAFE_ERROR_CLASSES.timeout;
    }
    if (statusCode === 429 || /(rate.?limit|too many requests)/i.test(signal)) {
        return SAFE_ERROR_CLASSES.rateLimited;
    }
    if (/(network|fetch|econn|eai_again|enotfound|socket|tls|dns)/i.test(signal)) {
        return SAFE_ERROR_CLASSES.network;
    }
    if (statusCode === 401 || statusCode === 403 || /(unauthori[sz]ed|forbidden|permission|access denied)/i.test(signal)) {
        return SAFE_ERROR_CLASSES.permission;
    }
    if (statusCode === 409 || /(conflict|duplicate|unique|constraint|23505)/i.test(signal)) {
        return SAFE_ERROR_CLASSES.conflict;
    }
    if (statusCode === 404 || /(not.?found|pgrst116)/i.test(signal)) {
        return SAFE_ERROR_CLASSES.notFound;
    }
    if (statusCode === 400 || statusCode === 422 || /(invalid|malformed|parse|syntax|schema)/i.test(signal)) {
        return SAFE_ERROR_CLASSES.invalid;
    }
    if (statusCode && statusCode >= 500) {
        return SAFE_ERROR_CLASSES.unavailable;
    }
    return SAFE_ERROR_CLASSES.unknown;
};

// Never return raw messages, stacks, provider codes, resource identifiers, or config names.
export const toSafeErrorMeta = (error) => {
    const statusCode = readErrorStatus(error);
    return {
        errorClass: classifySafeError(error),
        ...(statusCode ? { statusCode } : {}),
    };
};
