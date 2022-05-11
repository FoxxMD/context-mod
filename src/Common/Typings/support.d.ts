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

declare module 'winston-null' {
  import TransportStream from "winston-transport";

    export class NullTransport extends TransportStream {

    }
}

declare module 'node-nlp' {
    export class Language {
        guess(val: string, allowedList?: string[] | null, limit: number): {alpha3: string, alpha2: string, language: string, score: number}[];
        guessBest(val: string, allowedList?: string[] | null): {alpha3: string, alpha2: string, language: string, score: number};
    }
    export class SentimentAnalyzer {
        constructor(settings?: {language?: string})
        getSentiment(phrase: string): Promise<{score: number, comparative: score, vote: 'string', numWords: number, numHits: number, type: string, language: string}>
    }

    export class SentimentManager {
        process(locale: string, phrase: string): Promise<{score: number, comparative: score, vote: 'string', numWords: number, numHits: number, type: string, language: string}>
    }
}

declare module 'wink-sentiment' {
    function sentiment(phrase: string): {score: number, normalizedScore: number, tokenizedPhrase: any[]};
    export default sentiment;
}
