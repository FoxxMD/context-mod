import {StatusCodeError} from "../Common/interfaces";


export const isRateLimitError = (err: any) => {
    return typeof err === 'object' && err.name === 'RateLimitError';
}

export const isScopeError = (err: any): boolean => {
    if(typeof err === 'object' && err.name === 'StatusCodeError' && err.response !== undefined) {
        const authHeader = err.response.headers['www-authenticate'];
        return authHeader !== undefined && authHeader.includes('insufficient_scope');
    }
    return false;
}

export const isStatusError = (err: any): err is StatusCodeError => {
    return typeof err === 'object' && err.name === 'StatusCodeError' && err.response !== undefined;
}
