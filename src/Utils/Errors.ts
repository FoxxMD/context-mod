import {RateLimitError, RequestError, StatusCodeError} from 'snoowrap/dist/errors';


export const isRateLimitError = (err: any): err is RateLimitError => {
    return isRequestError(err) && err.name === 'RateLimitError';
}

export const isScopeError = (err: any): boolean => {
    if(isStatusError(err)) {
        const authHeader = err.response.headers['www-authenticate'];
        return authHeader !== undefined && authHeader.includes('insufficient_scope');
    }
    return false;
}

export const getScopeError = (err: any): string | undefined => {
    if(isScopeError(err)) {
        return err.response.headers['www-authenticate'];
    }
    return undefined;
}

export const isStatusError = (err: any): err is StatusCodeError => {
    return isRequestError(err) && err.name === 'StatusCodeError';
}

export const isRequestError = (err: any): err is RequestError => {
    return typeof err === 'object' && err.response !== undefined;
}
