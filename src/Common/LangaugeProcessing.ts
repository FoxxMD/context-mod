import {Language, SentimentManager} from 'node-nlp';
import {SentimentIntensityAnalyzer} from 'vader-sentiment';
import wink from 'wink-sentiment';
import {SnoowrapActivity} from "./Infrastructure/Reddit";
import {
    asGenericComparison,
    GenericComparison,
    parseGenericValueComparison,
    RangedComparison
} from "./Infrastructure/Comparisons";
import {asSubmission, between, comparisonTextOp} from "../util";
import {CMError, MaybeSeriousErrorWithCause} from "../Utils/Errors";
import InvalidRegexError from "../Utils/InvalidRegexError";
import {StringOperator} from "./Infrastructure/Atomic";

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
    for(const segment of sentimentQuantifierRanges) {
        if(between(val, segment.range[0], segment.range[1], false)) {
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
}

export interface ActivitySentiment {
    results: SentimentResult[]
    score: number
    scoreWeighted: number
    sentiment: string
    sentimentWeighted: string
    activity: SnoowrapActivity
    language: string
}

export interface ActivitySentimentTestResult extends ActivitySentiment {
    passes: boolean
    test: GenericComparison | RangedComparison
}

export interface ActivitySentimentOptions {
    testOn?: ('title' | 'body')[]
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

    if(groups.sentiment === 'neutral') {
        if(negate) {
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
    if(numericVal === undefined) {
        throw new CMError(`Sentiment given did not match any known phrases: '${compoundSentimentText}'`);
    }

    let operator: StringOperator;
    if(negate) {
        operator = numericVal > 0 ? '<' : '>';
    } else {
        operator = numericVal > 0 ? '>=' : '<=';
    }

    return {
        operator,
        value: numericVal,
        isPercent: false,
        displayText: `is${negate ? ' not ': ' '}${compoundSentimentText} (${operator} ${numericVal})`
    }
}

const nlpAnalyzer = new SentimentManager();
const langDetect = new Language();

export const getActivitySentiment = async (item: SnoowrapActivity, options?: ActivitySentimentOptions): Promise<ActivitySentiment> => {

    const {
        testOn = ['body', 'title']
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

    const guess = langDetect.guessBest(contentStr);

    if (availableSentimentLanguages.includes(guess.alpha2)) {
        const results: SentimentResult[] = [];

        const nlpResult = await nlpAnalyzer.process(guess.alpha2, contentStr);

        results.push({
            comparative: nlpResult.comparative,
            type: nlpResult.type as SentimentAnalysisType,
            sentiment: scoreToSentimentText(nlpResult.comparative),
            weight: 1
        });

        if (guess.alpha2 === 'en') {
            const score = SentimentIntensityAnalyzer.polarity_scores(contentStr);
            results.push({
                comparative: score.compound,
                type: 'vader',
                sentiment: scoreToSentimentText(score.compound),
                // may want to weight higher in the future...
                weight: 1
            });

            const winkScore = wink(contentStr);
            // normalizedScore is range of -5 to +5 -- convert to -1 to +1
            const winkAdjusted = (winkScore.normalizedScore * 2) / 10;
            results.push({
                comparative: winkAdjusted,
                type: 'wink',
                sentiment: scoreToSentimentText(winkAdjusted),
                weight: 1
            })
        }

        const score = results.reduce((acc, curr) => acc + curr.comparative, 0) / results.length;
        const sentiment = scoreToSentimentText(score);

        const weightSum = results.reduce((acc, curr) => acc + curr.weight, 0);
        const weightedScores = results.reduce((acc, curr) => acc + (curr.weight * curr.comparative), 0);
        const weightedScore = weightedScores / weightSum;
        const weightedSentiment = scoreToSentimentText(weightedScore);

        return {
            results,
            score,
            sentiment,
            scoreWeighted: weightedScore,
            sentimentWeighted: weightedSentiment,
            activity: item,
            language: guess.language
        }

    } else {
        throw new MaybeSeriousErrorWithCause(`Cannot test sentiment for unsupported language ${guess.language}`);
    }
}

export const testActivitySentiment = async (item: SnoowrapActivity, criteria: SentimentCriteriaTest, options?: ActivitySentimentOptions): Promise<ActivitySentimentTestResult> => {
    const sentimentResult = await getActivitySentiment(item, options);

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
