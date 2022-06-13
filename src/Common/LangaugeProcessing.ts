import {containerBootstrap} from '@nlpjs/core';
import {Language, LanguageGuess, LanguageType} from '@nlpjs/language';
import {Nlp} from '@nlpjs/nlp';
import {SentimentIntensityAnalyzer} from 'vader-sentiment';
import wink from 'wink-sentiment';
import {SnoowrapActivity} from "./Infrastructure/Reddit";
import {
    asGenericComparison, comparisonTextOp,
    GenericComparison,
    parseGenericValueComparison,
    RangedComparison
} from "./Infrastructure/Comparisons";
import {asSubmission, between, formatNumber} from "../util";
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

export interface StringSentiment {
    results: SentimentResult[]
    score: number
    scoreWeighted: number
    sentiment: string
    sentimentWeighted: string
    guessedLanguage: LanguageGuessResult
    usedLanguage: LanguageType
    usableScore: boolean
    reason?: string
}

export interface ActivitySentiment extends StringSentiment {
    activity: SnoowrapActivity
}

export interface StringSentimentTestResult extends StringSentiment {
    passes: boolean
    test: GenericComparison | RangedComparison
}

export interface ActivitySentimentTestResult extends StringSentimentTestResult {
    activity: SnoowrapActivity
}

export interface ActivitySentimentOptions {
    testOn?: ('title' | 'body')[]
    /**
     * Make the analyzer assume a language if it cannot determine one itself.
     *
     * This is very useful for the analyzer when it is parsing short pieces of content. For example, if you know your subreddit is majority english speakers this will make the analyzer return "neutral" sentiment instead of "not detected language".
     *
     * Defaults to 'en'
     *
     * @example ["en"]
     * @default en
     * */
    defaultLanguage?: string | null | false

    /**
     * Helps the analyzer coerce a low confidence language guess into a known-used languages in two ways:
     *
     * If the analyzer's
     *   * *best* guess is NOT one of these
     *     * but it did guess one of these
     *     * and its guess is above requiredLanguageConfidence score then use the hinted language instead of best guess
     *   * OR text content is very short (4 words or less)
     *     * and the best guess was below the requiredLanguageConfidence score
     *     * and none of guesses was a hinted language then use the defaultLanguage
     *
     * Defaults to popular romance languages: ['en', 'es', 'de', 'fr']
     *
     * @example [["en", "es", "de", "fr"]]
     * @default ["en", "es", "de", "fr"]
     * */
    languageHints?: string[]

    /**
     * Required confidence to use a guessed language as the best guess. Score from 0 to 1.
     *
     * Defaults to 0.9
     *
     * @example [0.9]
     * @default 0.9
     * */
    requiredLanguageConfidence?: number
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
                displayText: 'not neutral (not -0.1 to 0.1)',
                range: [-0.1, 0.1],
                not: true,
            }
        }
        return {
            displayText: 'is neutral (-0.1 to 0.1)',
            range: [-0.1, 0.1],
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

export const getNlp = async () => {
    if (nlp === undefined) {
        await bootstrapNlp();
    }

    return nlp;
}

export const getActivityContent = (item: SnoowrapActivity, options?: ActivitySentimentOptions): string => {
    const {
        testOn = ['body', 'title'],
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

    return contents.join(' ');
}

export const getLanguageTypeFromValue = async (val: string): Promise<LanguageType> => {

    if (nlp === undefined) {
        await bootstrapNlp();
    }

    const langObj = container.get('Language') as Language;

    const cleanVal = val.trim().toLocaleLowerCase();

    const foundLang = Object.values(langObj.languagesAlpha2).find(x => x.alpha2 === cleanVal || x.alpha3 === cleanVal || x.name.toLocaleLowerCase() === cleanVal);
    if (foundLang === undefined) {
        throw new MaybeSeriousErrorWithCause(`Could not find Language with identifier '${val}'`, {isSerious: false});
    }
    const {alpha2, alpha3, name: language} = foundLang;
    return {
        alpha2,
        alpha3,
        language
    };
}

export interface LanguageGuessResult {
    bestGuess: LanguageGuess
    guesses: LanguageGuess[]
    requiredConfidence: number
    sparse: boolean
    language: LanguageType
    usedDefault: boolean
}

export const getContentLanguage = async (content: string, options?: ActivitySentimentOptions): Promise<LanguageGuessResult> => {

    const {
        defaultLanguage = 'en',
        requiredLanguageConfidence = 0.9,
        languageHints = availableSentimentLanguages
    } = options || {};

    if (nlp === undefined) {
        await bootstrapNlp();
    }

    const spaceNormalizedTokens = content.trim().split(' ').filter(x => x !== ''.trim());

    const lang = container.get('Language') as Language;
    // would like to improve this https://github.com/axa-group/nlp.js/issues/761
    const guesses = lang.guess(content, null, 4);
    let bestLang = guesses[0];
    const shortContent = spaceNormalizedTokens.length <= 4;

    const altBest = languageHints.includes(bestLang.alpha2) ? undefined : guesses.find(x => x.score >= requiredLanguageConfidence && languageHints.includes(x.alpha2));

    // coerce best guess into a supported language that has a good enough confidence
    if(!shortContent && altBest !== undefined) {
        bestLang = altBest;
    }

    let usedLang: LanguageType = bestLang;
    let usedDefault = false;

    if (typeof defaultLanguage === 'string' && (bestLang.score < requiredLanguageConfidence || (shortContent && !languageHints.includes(bestLang.alpha2)))) {
        usedLang = await getLanguageTypeFromValue(defaultLanguage);
        usedDefault = true;
    }

    return {
        guesses,
        bestGuess: bestLang,
        requiredConfidence: requiredLanguageConfidence,
        sparse: shortContent,
        language: usedLang,
        usedDefault
    }
}

export const getActivitySentiment = async (item: SnoowrapActivity, options?: ActivitySentimentOptions): Promise<ActivitySentiment> => {

    const result = await getStringSentiment(getActivityContent(item, options), options);

    return {
        ...result,
        activity: item
    }
}

export const getStringSentiment = async (contentStr: string, options?: ActivitySentimentOptions): Promise<StringSentiment> => {

    const langResult = await getContentLanguage(contentStr, options);

    let usedLanguage: LanguageType = langResult.language;

    const spaceNormalizedTokens = contentStr.trim().split(' ').filter(x => x !== ''.trim());

    const results: SentimentResult[] = [];

    const nlpResult = await nlp.process(langResult.language.alpha2, contentStr);

    results.push({
        comparative: nlpResult.sentiment.average,
        type: nlpResult.sentiment.type as SentimentAnalysisType,
        sentiment: scoreToSentimentText(nlpResult.sentiment.average),
        weight: 1,
        matchedTokens: nlpResult.sentiment.numHits,
        tokens: nlpResult.sentiment.numWords,
        usableResult: availableSentimentLanguages.includes(langResult.language.alpha2) ? true : (nlpResult.sentiment.numHits / nlpResult.sentiment.numWords) >= 0.5 ? true : `${langResult.sparse ? 'Content was too short to guess language' : 'Unsupported language'} and less than 50% of tokens matched`,
    });

    // only run vader/wink if either
    //
    // * content was short which means we aren't confident on language guess
    // * OR language is english (guessed or explicitly set as language fallback by user due to low confidence)
    //
    if (langResult.sparse || langResult.language.alpha2 === 'en') {

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
            usableResult: langResult.language.alpha2 === 'en' ? true : (vaderScore.neu < 0.5 ? true : `Unable to guess language and unable to determine if more than 50% of tokens are negative or not matched`)
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
            usableResult: langResult.language.alpha2 === 'en' ? true : ((matchedTokens.length / matchedMeaningfulTokens.length) > 0.5 ? true : 'Unable to guess language and less than 50% of tokens matched')
        };
        results.push(winkRes);

        if ((vaderRes.usableResult == true || winkRes.usableResult === true) && usedLanguage.alpha2 !== 'en') {
            // since we are confident enough to use one of these then we are assuming language is mostly english
            usedLanguage = await getLanguageTypeFromValue('en');
        }
    }

    const score = results.reduce((acc, curr) => acc + curr.comparative, 0) / results.length;
    const sentiment = scoreToSentimentText(score);

    const weightSum = results.reduce((acc, curr) => acc + curr.weight, 0);
    const weightedScores = results.reduce((acc, curr) => acc + (curr.weight * curr.comparative), 0);
    const weightedScore = weightedScores / weightSum;
    const weightedSentiment = scoreToSentimentText(weightedScore);

    const actSentResult: StringSentiment = {
        results,
        score,
        sentiment,
        scoreWeighted: weightedScore,
        sentimentWeighted: weightedSentiment,
        guessedLanguage: langResult,
        usedLanguage,
        usableScore: results.filter(x => x.usableResult === true).length > 0,
    }

    if (!actSentResult.usableScore) {
        if (actSentResult.guessedLanguage.sparse) {
            actSentResult.reason = 'Content may be supported language but was too short to guess accurately and no algorithm matched enough tokens to be considered confident.';
        } else {
            actSentResult.reason = 'Unsupported language'
        }
    }

    return actSentResult;
}

export const testActivitySentiment = async (item: SnoowrapActivity, criteria: SentimentCriteriaTest, options?: ActivitySentimentOptions): Promise<ActivitySentimentTestResult> => {
    const sentimentResult = await getActivitySentiment(item, options);

    const testResult = testSentiment(sentimentResult, criteria);

    return {
        ...testResult,
        activity: item
    }
}

export const testSentiment = (sentimentResult: StringSentiment, criteria: SentimentCriteriaTest): StringSentimentTestResult => {

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
