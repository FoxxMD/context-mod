import {containerBootstrap} from '@nlpjs/core';
import {Language} from '@nlpjs/language';
import {Nlp} from '@nlpjs/nlp';
import {SentimentIntensityAnalyzer} from 'vader-sentiment';
import wink from 'wink-sentiment';
import {SnoowrapActivity} from "./Infrastructure/Reddit";
import {
    asGenericComparison,
    GenericComparison,
    parseGenericValueComparison,
    RangedComparison
} from "./Infrastructure/Comparisons";
import {asSubmission, between, comparisonTextOp, formatNumber} from "../util";
import {CMError, MaybeSeriousErrorWithCause} from "../Utils/Errors";
import InvalidRegexError from "../Utils/InvalidRegexError";
import {StringOperator} from "./Infrastructure/Atomic";
import {LangEs} from "@nlpjs/lang-es";
import {LangDe} from "@nlpjs/lang-de";
import {LangEn} from "@nlpjs/lang-en";
import {LangFr} from "@nlpjs/lang-fr";

export type SentimentAnalysisType = 'vader' | 'afinn' | 'senticon' | 'pattern' | 'wink';

export const sentimentQuantifier = {
    'extremely negative': -0.6,
    'very negative': -0.3,
    'negative': -0.1,
    'neutral': 0,
    'positive': 0.1,
    'very positive': 0.3,
    'extremely positive': 0.6,
}

export const sentimentQuantifierRanges = [
    {
        range: [Number.MIN_SAFE_INTEGER, -0.6],
        quant: 'extremely negative'
    },
    {
        range: [-0.6, -0.3],
        quant: 'very negative'
    },
    {
        range: [-0.3, -0.1],
        quant: 'negative'
    },
    {
        range: [-0.1, 0.1],
        quant: 'neutral'
    },
    {
        range: [0.1, 0.3],
        quant: 'positive'
    },
    {
        range: [0.3, 0.6],
        quant: 'very positive'
    },
    {
        range: [0.6, Number.MAX_SAFE_INTEGER],
        quant: 'extremely positive'
    }
]

const scoreToSentimentText = (val: number) => {
    for (const segment of sentimentQuantifierRanges) {
        if (between(val, segment.range[0], segment.range[1], false, true)) {
            return segment.quant;
        }
    }
    throw new Error('should not hit this!');
}

export interface SentimentResult {
    comparative: number
    type: SentimentAnalysisType
    sentiment: string
    weight: number
    tokens: number
    matchedTokens?: number,
    usableResult: true | string
}

export interface ActivitySentiment {
    results: SentimentResult[]
    score: number
    scoreWeighted: number
    sentiment: string
    sentimentWeighted: string
    activity: SnoowrapActivity
    locale: string
    guessedLanguage: string
    guessedLanguageConfidence: number
    usedLanguage: string
    usableScore: boolean
    reason?: string
}

export interface ActivitySentimentTestResult extends ActivitySentiment {
    passes: boolean
    test: GenericComparison | RangedComparison
}

export interface ActivitySentimentOptions {
    testOn?: ('title' | 'body')[]
    /**
     * Make the analyzer assume a language if it cannot determine one itself.
     *
     * This is very useful for the analyzer when it is parsing short pieces of content. For example, if you know your subreddit is majority english speakers this will make the analyzer return "neutral" sentiment instead of "not detected language".
     *
     * */
    languageHint?: string
}

export type SentimentCriteriaTest = GenericComparison | RangedComparison;

export const availableSentimentLanguages = ['en', 'es', 'de', 'fr'];

export const textComparison = /(?<not>not)?\s*(?<modifier>very|extremely)?\s*(?<sentiment>positive|neutral|negative)/i;

export const parseTextToNumberComparison = (val: string): RangedComparison | GenericComparison => {

    let genericError: Error | undefined;
    try {
        return parseGenericValueComparison(val);
    } catch (e) {
        genericError = e as Error;
        // now try text match
    }

    const matches = val.match(textComparison);
    if (matches === null) {
        const textError = new InvalidRegexError(textComparison, val);
        throw new CMError(`Sentiment value did not match a valid numeric comparison or valid text: \n ${genericError.message} \n ${textError.message}`);
    }
    const groups = matches.groups as any;

    const negate = groups.not !== undefined && groups.not !== '';

    if (groups.sentiment === 'neutral') {
        if (negate) {
            return {
                displayText: 'not neutral (not -0.49 to 0.49)',
                range: [-1, 1],
                not: true,
            }
        }
        return {
            displayText: 'is neutral (-0.49 to 0.49)',
            range: [-1, 1],
            not: false
        }
    }

    const compoundSentimentText = `${groups.modifier !== undefined && groups.modifier !== '' ? `${groups.modifier} ` : ''}${groups.sentiment}`.toLocaleLowerCase();
    // @ts-ignore
    const numericVal = sentimentQuantifier[compoundSentimentText] as number;
    if (numericVal === undefined) {
        throw new CMError(`Sentiment given did not match any known phrases: '${compoundSentimentText}'`);
    }

    let operator: StringOperator;
    if (negate) {
        operator = numericVal > 0 ? '<' : '>';
    } else {
        operator = numericVal > 0 ? '>=' : '<=';
    }

    return {
        operator,
        value: numericVal,
        isPercent: false,
        displayText: `is${negate ? ' not ' : ' '}${compoundSentimentText} (${operator} ${numericVal})`
    }
}

let nlp: Nlp;
let container: any;

const bootstrapNlp = async () => {

    container = await containerBootstrap();
    container.use(Language);
    container.use(Nlp);
    container.use(LangEs);
    container.use(LangDe);
    container.use(LangEn);
    container.use(LangFr);
    nlp = container.get('nlp');
    nlp.settings.autoSave = false;
    nlp.addLanguage('en');
    nlp.addLanguage('es');
    nlp.addLanguage('de');
    nlp.addLanguage('fr');
    nlp.nluManager.guesser.processExtraSentences();
    await nlp.train();
}

export const getActivitySentiment = async (item: SnoowrapActivity, options?: ActivitySentimentOptions): Promise<ActivitySentiment> => {

    const {
        testOn = ['body', 'title'],
        languageHint,
    } = options || {};

    // determine what content we are testing
    let contents: string[] = [];
    if (asSubmission(item)) {
        for (const l of testOn) {
            switch (l) {
                case 'title':
                    contents.push(item.title);
                    break;
                case 'body':
                    if (item.is_self) {
                        contents.push(item.selftext);
                    }
                    break;
            }
        }
    } else {
        contents.push(item.body)
    }

    const contentStr = contents.join(' ');

    if (nlp === undefined) {
        await bootstrapNlp();
    }

    const lang = container.get('Language') as Language;
    // would like to improve this https://github.com/axa-group/nlp.js/issues/761
    const guesses = lang.guess(contentStr, null, 4);
    const bestLang = guesses[0];
    const guess = guesses.find(x => availableSentimentLanguages.includes(x.alpha2)) || {
        alpha2: undefined,
        language: undefined
    };

    let usedLanguage = guess.alpha2 ?? bestLang.alpha2;

    const spaceNormalizedTokens = contentStr.trim().split(' ').filter(x => x !== ''.trim());

    const isShortContent = spaceNormalizedTokens.length <= 4;

    const results: SentimentResult[] = [];

    const nlpResult = await nlp.process(guess.alpha2 ?? 'en', contentStr);

    results.push({
        comparative: nlpResult.sentiment.average,
        type: nlpResult.sentiment.type as SentimentAnalysisType,
        sentiment: scoreToSentimentText(nlpResult.sentiment.average),
        weight: 1,
        matchedTokens: nlpResult.sentiment.numHits,
        tokens: nlpResult.sentiment.numWords,
        usableResult: guess.alpha2 !== undefined ? true : (nlpResult.sentiment.numHits / nlpResult.sentiment.numWords) >= 0.5 ? true : `${isShortContent ? 'Content was too short to guess language' : 'Unsupported language'} and less than 50% of tokens matched`,
    });

    if (isShortContent || (guess.alpha2 ?? languageHint) === 'en') {

        // neg post neu are ratios of *recognized* tokens in the content
        // when neu is close to 1 its either extremely neutral or no tokens were recognized
        const vaderScore = SentimentIntensityAnalyzer.polarity_scores(contentStr);
        const vaderRes: SentimentResult = {
            comparative: vaderScore.compound,
            type: 'vader',
            sentiment: scoreToSentimentText(vaderScore.compound),
            // may want to weight higher in the future...
            weight: 1,
            tokens: spaceNormalizedTokens.length,
            usableResult: (guess.alpha2 ?? languageHint) === 'en' ? true : (vaderScore.neu < 0.5 ? true : `Unable to guess language and unable to determine if more than 50% of tokens are negative or not matched`)
        };
        results.push(vaderRes);

        const winkScore = wink(contentStr);
        const matchedTokens = winkScore.tokenizedPhrase.filter(x => x.score !== undefined);
        const matchedMeaningfulTokens = winkScore.tokenizedPhrase.filter(x => x.tag === 'word' || x.tag === 'emoji');
        // normalizedScore is range of -5 to +5 -- convert to -1 to +1
        const winkAdjusted = (winkScore.normalizedScore * 2) / 10;
        const winkRes: SentimentResult = {
            comparative: winkAdjusted,
            type: 'wink',
            sentiment: scoreToSentimentText(winkAdjusted),
            weight: 1,
            matchedTokens: matchedTokens.length,
            tokens: winkScore.tokenizedPhrase.length,
            usableResult: (guess.alpha2 ?? languageHint) === 'en' ? true : ((matchedTokens.length / matchedMeaningfulTokens.length) > 0.5 ? true : 'Unable to guess language and less than 50% of tokens matched')
        };
        results.push(winkRes);

        if(vaderRes.usableResult || winkRes.usableResult) {
            // since we are confident enough to use one of these then we are assuming language is mostly english
            usedLanguage = 'en';
        }
    }

    const score = results.reduce((acc, curr) => acc + curr.comparative, 0) / results.length;
    const sentiment = scoreToSentimentText(score);

    const weightSum = results.reduce((acc, curr) => acc + curr.weight, 0);
    const weightedScores = results.reduce((acc, curr) => acc + (curr.weight * curr.comparative), 0);
    const weightedScore = weightedScores / weightSum;
    const weightedSentiment = scoreToSentimentText(weightedScore);

    const actSentResult: ActivitySentiment = {
        results,
        score,
        sentiment,
        scoreWeighted: weightedScore,
        sentimentWeighted: weightedSentiment,
        activity: item,
        locale: bestLang.alpha2,
        guessedLanguage: bestLang.language,
        guessedLanguageConfidence: formatNumber(bestLang.score),
        usedLanguage,
        usableScore: results.filter(x => x.usableResult === true).length > 0,
    }

    if (!actSentResult.usableScore) {
        if (isShortContent) {
            actSentResult.reason = 'Content may be supported language but was too short to guess accurately and no algorithm matched enough tokens to be considered confident.';
        } else {
            actSentResult.reason = 'Unsupported language'
        }
    }

    return actSentResult;
}

export const testActivitySentiment = async (item: SnoowrapActivity, criteria: SentimentCriteriaTest, options?: ActivitySentimentOptions): Promise<ActivitySentimentTestResult> => {
    const sentimentResult = await getActivitySentiment(item, options);

    if (!sentimentResult.usableScore) {
        return {
            passes: false,
            test: criteria,
            ...sentimentResult,
        }
    }

    if (asGenericComparison(criteria)) {
        return {
            passes: comparisonTextOp(sentimentResult.scoreWeighted, criteria.operator, criteria.value),
            test: criteria,
            ...sentimentResult,
        }
    } else {
        if (criteria.not) {
            return {
                passes: sentimentResult.scoreWeighted < criteria.range[0] || sentimentResult.scoreWeighted > criteria.range[1],
                test: criteria,
                ...sentimentResult,
            }
        }
        return {
            passes: sentimentResult.scoreWeighted >= criteria.range[0] || sentimentResult.scoreWeighted <= criteria.range[1],
            test: criteria,
            ...sentimentResult,
        }
    }
}
