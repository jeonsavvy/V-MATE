export const resolveChatHandlerContext = async ({
    chatHandlerContext,
    resolverInput = {},
    onError,
}) => {
    if (typeof chatHandlerContext === 'function') {
        try {
            const context = await chatHandlerContext(resolverInput);
            return context && typeof context === 'object' ? context : {};
        } catch (error) {
            if (typeof onError === 'function') {
                onError(error);
            }
            return {};
        }
    }

    return chatHandlerContext && typeof chatHandlerContext === 'object'
        ? chatHandlerContext
        : {};
};

export const mergeChatHandlerContexts = (runtimeContext = {}, configuredContext = {}) => {
    const merged = {
        ...(runtimeContext && typeof runtimeContext === 'object' ? runtimeContext : {}),
        ...(configuredContext && typeof configuredContext === 'object' ? configuredContext : {}),
    };

    const checkRateLimit = configuredContext?.checkRateLimit ?? runtimeContext?.checkRateLimit;
    if (typeof checkRateLimit === 'function') {
        merged.checkRateLimit = checkRateLimit;
    } else {
        delete merged.checkRateLimit;
    }

    const promptCache = configuredContext?.promptCache ?? runtimeContext?.promptCache;
    if (promptCache && typeof promptCache === 'object') {
        merged.promptCache = promptCache;
    } else {
        delete merged.promptCache;
    }

    return merged;
};
