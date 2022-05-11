declare module 'vader-sentiment' {
    export const REGEX_REMOVE_PUNCTUATION: RegExp;
    export const B_INCR: number;
    export const B_DECR: number;
    export const C_INCR: number;
    export const N_SCALER: number;
    export const PUNC_LIST: string[];
    export const NEGATE: string[];
    export const BOOSTER_DICT: Record<string, number>;
    export const SPECIAL_CASE_IDIOMS: Record<string, number>;

    export interface Scores {
        neg: number
        neu: number
        pos: number
        compound: number
    }

    export function negated(input_words: string[], include_nt: boolean = true): boolean;
    export function normalize(score: number, alpha: number): number;
    export function allcap_differential(words: string[]): boolean;
    export function scalar_inc_dec(word: string, valence: number, is_cap_diff: boolean): number
    export function is_upper_function(word: string): boolean

    export class SentiText {
        public text: string;
        public words_and_emoticons: string[];
        public is_cap_diff: boolean;

        constructor(text: string);

        get_words_plus_punc(): Record<string, string>;
        get_words_and_emoticons(): string[];
    }

    export class SentimentIntensityAnalyzer {

        static polarity_scores(text: string): Scores;
        static sentiment_valence(valence: number, sentiText: SentiText, item: string, index: number, sentiments: number[]);
        static least_check(valence: number, words_and_emoticons: string[], index: number): number;
        static but_check(words_and_emoticons: string[], sentiments: number[]): number[]
        static idioms_check(valence: number, words_and_emoticons: string[], index: number): number;
        static never_check(valence: number, words_and_emoticons: string[], start_i: number, index: number): number
        static punctuation_emphasis(sum_s: any, text: string);
        static amplify_ep(text: string): number;
        static amplify_qm(text: string): number;
        static sift_sentiment_scores(sentiments: number[]): number[];
        static score_valence(sentiments: number[], text: string): Scores;
    }
}
