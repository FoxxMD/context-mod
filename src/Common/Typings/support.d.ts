declare module 'snoowrap/dist/errors' {

    export interface InvalidUserError extends Error {

    }
    export interface NoCredentialsError extends Error {

    }
    export interface InvalidMethodCallError extends Error {

    }

    export interface RequestError extends Error {
        statusCode: number,
        response: http.IncomingMessage
        error: Error
    }

    export interface StatusCodeError extends RequestError {
        name: 'StatusCodeError',
    }

    export interface RateLimitError extends RequestError {
        name: 'RateLimitError',
    }
}
