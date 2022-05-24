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

declare module '@nlpjs/*' {

    declare interface SentimentResult {
        score: number,
        average: number,
        numWords: number,
        numHits: number,
        type: string,
        language: string
    }

    declare interface NLPSentimentResult extends Omit<SentimentResult, 'language'> {
        vote: string
        locale: string
    }


    declare module '@nlpjs/language' {

        export interface LanguageGuess {
            alpha3: string,
            alpha2: string,
            language: string,
            score: number
        }

        export class Language {
            guess(val: string, allowedList?: string[] | null, limit?: number): LanguageGuess[];

            guessBest(val: string, allowedList?: string[] | null): LanguageGuess;
        }
    }

    declare module '@nlpjs/sentiment' {

        declare interface SentimentPipelineResult {
            utterance: string
            locale: string
            settings: { tag: string }
            tokens: string[]
            sentiment: SentimentResult
        }

        declare interface SentimentPipelineInput {
            utterance: string
            locale: string

            [key: string]: any
        }

        export class SentimentAnalyzer {
            constructor(settings?: { language?: string }, container?: any)

            container: any

            process(srcInput: SentimentPipelineInput, settings?: object): Promise<SentimentPipelineResult>
        }
    }

    declare module '@nlpjs/nlp' {

        declare interface NlpResult {
            locale: string
            language: string
            languageGuessed: boolean
            sentiment: NLPSentimentResult
        }

        export class Nlp {
            settings: any;
            nluManager: any;

            constructor(settings?: { language?: string }, container?: any)

            // locale language languageGuessed sentiment
            process(locale: string, utterance?: string, srcContext?: object, settings?: object): Promise<NlpResult>
            addLanguage(locale: string)
            train(): Promise<any>;

        }
    }

    declare module '@nlpjs/lang-es' {
        export const LangEs: any
    }
    declare module '@nlpjs/lang-en' {
        export const LangEn: any
    }
    declare module '@nlpjs/lang-de' {
        export const LangDe: any
    }
    declare module '@nlpjs/lang-fr' {
        export const LangFr: any
    }
    declare module '@nlpjs/nlu' {
        export const Nlu: any
    }

    declare module '@nlpjs/core' {
        export const Container: any
        export const containerBootstrap: any
    }
}


declare module 'wink-sentiment' {
    function sentiment(phrase: string): { score: number, normalizedScore: number, tokenizedPhrase: any[] };

    export default sentiment;
}
