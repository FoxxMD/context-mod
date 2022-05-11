import {Rule, RuleJSONConfig, RuleOptions} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {
    asSubmission,
    comparisonTextOp, formatNumber,
    parseStringToRegex,
    triggeredIndicator, windowConfigToWindowCriteria
} from "../util";
import {Scores, SentimentIntensityAnalyzer} from 'vader-sentiment';

import dayjs from 'dayjs';
import {CMError, SimpleError} from "../Utils/Errors";
import InvalidRegexError from "../Utils/InvalidRegexError";
import {
    asGenericComparison,
    GenericComparison,
    parseGenericValueComparison, parseGenericValueOrPercentComparison,
    RangedComparison
} from "../Common/Infrastructure/Comparisons";
import {ActivityWindowConfig, ActivityWindowCriteria} from "../Common/Infrastructure/ActivityWindow";
import {StringOperator, VaderSentimentComparison} from "../Common/Infrastructure/Atomic";
import {RuleResult} from "../Common/interfaces";
import {SnoowrapActivity} from "../Common/Infrastructure/Reddit";

export const sentimentQuantifier = {
    'extremely negative': -0.5,
    'very negative': -0.2,
    'negative': -0.05,
    'neutral': 0,
    'positive': 0.05,
    'very positive': 0.2,
    'extremely positive': 0.5,
}

const sentimentQuantifierEntries = Object.entries(sentimentQuantifier);

const scoreToSentimentText = (val: number) => {
    for(let i = 0; i < sentimentQuantifierEntries.length; i++) {
        // hit max score (extremely positive)
        if(i + 1 === sentimentQuantifierEntries.length && val > sentimentQuantifierEntries[i][1]) {
            return sentimentQuantifierEntries[i][0];
        }

        // if score is between (inclusive start) current and next
        if(i + 1 <= sentimentQuantifierEntries.length && val >= sentimentQuantifierEntries[i][1] && val < sentimentQuantifierEntries[i + 1][1]) {
            return sentimentQuantifierEntries[i][0];
        }

        // if neither of those is hit and i = 0 then min score (extremely negative)
        if(i === 0 && val < sentimentQuantifierEntries[i][1]) {
            return sentimentQuantifierEntries[i][0];
        }
    }
    throw new Error('should not hit this!');
}

interface ActivitySentimentResult {
    passes: boolean,
    scores: Scores,
    sentiment: string
    activity: SnoowrapActivity
}

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
                range: [-0.49, 0.49],
                not: true,
            }
        }
        return {
            displayText: 'is neutral (-0.49 to 0.49)',
            range: [-0.49, 0.49],
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

export class SentimentRule extends Rule {

    sentimentVal: string;
    sentiment: GenericComparison | RangedComparison;

    historical?: HistoricalSentiment;

    testOn: ('title' | 'body')[]

    constructor(options: SentimentRuleOptions) {
        super(options);

        this.sentimentVal = options.sentiment;
        this.sentiment = parseTextToNumberComparison(options.sentiment);
        this.testOn = options.testOn ?? ['title', 'body'];

        if(options.historical !== undefined) {
            const {
                window,
                sentiment: historicalSentiment = this.sentimentVal,
                mustMatchCurrent = false,
                totalMatching = '> 0',
            } = options.historical

            this.historical = {
                sentiment: parseTextToNumberComparison(historicalSentiment),
                sentimentVal: historicalSentiment,
                window: windowConfigToWindowCriteria(window),
                mustMatchCurrent,
                totalMatching: parseGenericValueOrPercentComparison(totalMatching),
            };
        }
    }

    getKind(): string {
        return 'sentiment';
    }

    getSpecificPremise(): object {
        return {
            sentiment: this.sentiment,
        }
    }

    protected async process(item: Submission | Comment): Promise<[boolean, RuleResult]> {

        let criteriaResults = [];

        let ogResult = this.testActivity(item, this.sentiment);
        let historicResults: ActivitySentimentResult[] | undefined;

        if(this.historical !== undefined && (!this.historical.mustMatchCurrent || ogResult.passes)) {
            const {
                sentiment = this.sentiment,
                window,
            } = this.historical;
            const history = await this.resources.getAuthorActivities(item.author, window);

            historicResults = history.map(x => this.testActivity(x, sentiment));
        }



        const logSummary: string[] = [];

        const sentimentTest = this.sentiment.displayText;
        const historicalSentimentTest = this.historical !== undefined ? this.historical.sentiment.displayText : undefined;

        let triggered = false;
        let averageScore: number;
        let averageWindowScore: number | undefined;
        let humanWindow: string | undefined;
        let historicalPassed: string | undefined;
        let totalMatchingText: string | undefined;

        if(historicResults === undefined) {
            triggered = ogResult.passes;
            averageScore = ogResult.scores.compound;
            logSummary.push(`${triggeredIndicator(triggered)} Current Activity Sentiment '${ogResult.sentiment} (${ogResult.scores.compound})' ${triggered ? 'PASSED' : 'DID NOT PASS'} sentiment test '${sentimentTest}'`);
            if(!triggered && this.historical !== undefined && this.historical.mustMatchCurrent) {
                logSummary.push(`Did not check Historical because 'mustMatchCurrent' is true`);
            }
        } else {

            const {
                totalMatching,
                sentiment,
            } = this.historical as HistoricalSentiment;

            totalMatchingText = totalMatching.displayText;
            const allResults = historicResults
            const passed = allResults.filter(x => x.passes);
            averageScore = passed.reduce((acc, curr) => acc + curr.scores.compound,0) / passed.length;
            averageWindowScore = allResults.reduce((acc, curr) => acc + curr.scores.compound,0) / allResults.length;

            const firstActivity = allResults[0].activity;
            const lastActivity = allResults[allResults.length - 1].activity;

            const humanRange = dayjs.duration(dayjs(firstActivity.created_utc * 1000).diff(dayjs(lastActivity.created_utc * 1000))).humanize();

            humanWindow = `${allResults.length} Activities (${humanRange})`;

            const {operator, value, isPercent} = totalMatching;
            if(isPercent) {
                const passPercentVal = passed.length/allResults.length
                triggered = comparisonTextOp(passPercentVal, operator, (value/100));
                historicalPassed = `${passed.length} (${formatNumber(passPercentVal)}%)`;
            } else {
                triggered = comparisonTextOp(passed.length, operator, value);
                historicalPassed = `${passed.length}`;
            }
            logSummary.push(`${triggeredIndicator(triggered)} ${historicalPassed} historical activities of ${humanWindow} passed sentiment test '${sentiment.displayText}' which ${triggered ? 'MET' : 'DID NOT MEET'} threshold '${totalMatching.displayText}'`);
        }

        const result = logSummary.join(' || ');
        this.logger.verbose(result);

        return Promise.resolve([triggered, this.getResult(triggered, {
            result,
            data: {
                results: {
                    triggered,
                    sentimentTest,
                    historicalSentimentTest,
                    averageScore,
                    averageWindowScore,
                    window: humanWindow,
                    totalMatching: totalMatchingText
                }
            }
        })]);
    }

    protected testActivity(a: (Submission | Comment), criteria: GenericComparison | RangedComparison): ActivitySentimentResult {
        // determine what content we are testing
        let contents: string[] = [];
        if (asSubmission(a)) {
            for (const l of this.testOn) {
                switch (l) {
                    case 'title':
                        contents.push(a.title);
                        break;
                    case 'body':
                        if (a.is_self) {
                            contents.push(a.selftext);
                        }
                        break;
                }
            }
        } else {
            contents.push(a.body)
        }

        const contentStr = contents.join(' ');
        const scores = SentimentIntensityAnalyzer.polarity_scores(contentStr);
        const textSentimentScore = scoreToSentimentText(scores.compound);

        if (asGenericComparison(criteria)) {
            return {
                passes: comparisonTextOp(scores.compound, criteria.operator, criteria.value),
                scores,
                sentiment: textSentimentScore,
                activity: a
            }
        } else {
            if (criteria.not) {
                return {
                    passes: scores.compound < criteria.range[0] || scores.compound > criteria.range[1],
                    scores,
                    sentiment: textSentimentScore,
                    activity: a
                }
            }
            return {
                passes: scores.compound >= criteria.range[0] || scores.compound <= criteria.range[1],
                scores,
                sentiment: textSentimentScore,
                activity: a
            }
        }
    }
}

/**
 * Test the Sentiment of Activities from the Author history
 *
 * If this is defined then the `totalMatching` threshold must pass for the Rule to trigger
 *
 * If `sentiment` is defined here it overrides the top-level `sentiment` value
 *
 * */
interface HistoricalSentimentConfig {
    window: ActivityWindowConfig

    sentiment?: VaderSentimentComparison

    /**
     * When `true` the original Activity being checked MUST match desired sentiment before the Rule considers any history
     *
     * @default false
     * */
    mustMatchCurrent?: boolean

    /**
     * A string containing a comparison operator and a value to compare Activities from history that pass the given `sentiment` comparison
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 12`  => greater than 12 activities passed given `sentiment` comparison
     * * EX `<= 10%` => less than 10% of all Activities from history passed given `sentiment` comparison
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * @default "> 0"
     * @examples ["> 0","> 10%"]
     * */
    totalMatching: string
}

interface HistoricalSentiment extends Omit<HistoricalSentimentConfig, 'sentiment' | 'window' | 'totalMatching'> {
    sentiment: GenericComparison | RangedComparison,
    sentimentVal: string
    window: ActivityWindowCriteria
    totalMatching: GenericComparison
}

interface SentimentConfig {

    sentiment: VaderSentimentComparison

    /**
     * Test the Sentiment of Activities from the Author history
     *
     * If this is defined then the `totalMatching` threshold must pass for the Rule to trigger
     *
     * If `sentiment` is defined here it overrides the top-level `sentiment` value
     *
     * */
    historical?: HistoricalSentimentConfig

    /**
     * Which content from an Activity to test for `sentiment` against
     *
     * Only used if the Activity being tested is a Submission -- Comments are only tested against their body
     *
     * If more than one type of content is specified then all text is tested together as one string
     *
     * @default ["title", "body"]
     * */
    testOn?: ('title' | 'body')[]
}

export interface SentimentRuleOptions extends SentimentConfig, RuleOptions {
}

/**
 * Test the calculated VADER sentiment for an Activity to determine if the text context is negative, neutral, or positive in tone.
 *
 * More about VADER Sentiment: https://github.com/cjhutto/vaderSentiment
 *
 * */
export interface SentimentRuleJSONConfig extends SentimentConfig, RuleJSONConfig {
    /**
     * @examples ["sentiment"]
     * */
    kind: 'sentiment'
}

export default SentimentRule;
