export const mapGeminiApiError = (geminiData) => {
    let errorMessage = 'Failed to get response from Gemini API';
    let errorCode = 'UPSTREAM_MODEL_ERROR';

    if (!geminiData?.error) {
        return { errorMessage, errorCode };
    }

    const upstreamMessage = String(geminiData.error.message || '');

    if (upstreamMessage.includes('API_KEY') || upstreamMessage.includes('API key')) {
        errorMessage = 'Invalid or expired API key. Please check your GOOGLE_API_KEY in runtime secrets.';
    } else if (upstreamMessage.includes('quota') || upstreamMessage.includes('Quota')) {
        errorMessage = 'API quota exceeded. Please check your Google Cloud billing.';
    } else if (
        upstreamMessage.includes('location is not supported') ||
        upstreamMessage.includes('User location is not supported')
    ) {
        errorMessage = 'Gemini API is not available in this server region. Deploy backend in a supported region or switch provider.';
        errorCode = 'UPSTREAM_LOCATION_UNSUPPORTED';
    } else if (upstreamMessage) {
        errorMessage = upstreamMessage;
    }

    return { errorMessage, errorCode };
};
