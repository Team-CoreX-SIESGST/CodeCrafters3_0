const DEFAULT_CALENDLY_URL = "https://calendly.com/suthakaranburaj";

const normalizeUrl = (value, fallback) => {
    if (typeof value !== 'string') {
        return fallback;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return fallback;
    }
    return trimmed.replace(/\/+$/, '');
};

const CALENDLY_BASE_URL = normalizeUrl(
    process.env.CALENDLY_BASE_URL,
    DEFAULT_CALENDLY_URL
);
const CALENDLY_VIDEO_URL = normalizeUrl(
    process.env.CALENDLY_VIDEO_URL,
    CALENDLY_BASE_URL
);
const CALENDLY_AUDIO_URL = normalizeUrl(
    process.env.CALENDLY_AUDIO_URL,
    CALENDLY_BASE_URL
);

export const getCalendlyLink = (callType) => {
    if (callType === 'AUDIO_CALL') {
        return CALENDLY_AUDIO_URL;
    }
    if (callType === 'VIDEO_CALL') {
        return CALENDLY_VIDEO_URL;
    }
    return CALENDLY_BASE_URL;
};
