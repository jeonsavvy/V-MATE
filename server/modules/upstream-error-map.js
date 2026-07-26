export const mapGeminiApiError = (geminiData) => {
    let errorMessage = '응답을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.';
    let errorCode = 'RESPONSE_SERVICE_UNAVAILABLE';

    if (!geminiData?.error) {
        return { errorMessage, errorCode };
    }

    const upstreamMessage = String(geminiData.error.message || '');

    if (upstreamMessage.includes('API_KEY') || upstreamMessage.includes('API key')) {
        errorMessage = '응답 기능을 지금 사용할 수 없습니다. 잠시 후 다시 시도해주세요.';
    } else if (upstreamMessage.includes('quota') || upstreamMessage.includes('Quota')) {
        errorMessage = '응답 요청이 일시적으로 많습니다. 잠시 후 다시 시도해주세요.';
    } else if (
        upstreamMessage.includes('location is not supported') ||
        upstreamMessage.includes('User location is not supported')
    ) {
        errorMessage = '현재 지역에서는 응답 기능을 사용할 수 없습니다.';
        errorCode = 'RESPONSE_REGION_UNAVAILABLE';
    }

    return { errorMessage, errorCode };
};
