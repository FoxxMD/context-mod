import {Rule, RuleJSONConfig, RuleOptions} from "./index";
import {Comment} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import {
    asComment, boolToString,
    formatNumber,
    triggeredIndicator, windowConfigToWindowCriteria
} from "../util";
import got, {HTTPError} from 'got';
import dayjs from 'dayjs';
import {map as mapAsync} from 'async';
import {
    comparisonTextOp,
    GenericComparison,
    parseGenericValueOrPercentComparison,
} from "../Common/Infrastructure/Comparisons";
import {ActivityWindowConfig, ActivityWindowCriteria} from "../Common/Infrastructure/ActivityWindow";
import {RuleResult} from "../Common/interfaces";
import {SnoowrapActivity} from "../Common/Infrastructure/Reddit";
import {CMError} from "../Utils/Errors";
import objectHash from "object-hash";

const formatConfidence = (val: number) => formatNumber(val * 100, {
    suffix: '%',
    toFixed: 2
});

export class MHSRule extends Rule {

    criteria: MHSCriteria

    historical?: HistoricalMHS;

    ogConfig: MHSConfig

    constructor(options: MHSRuleOptions) {
        super(options);

        if (this.resources.thirdPartyCredentials.mhs?.apiKey === undefined) {
            throw new CMError(`MHS (moderatehatespeech.com) API Key has not been specified. It must be present in the bot config or top-level subreddit 'credentials' property.`);
        }

        const {
            criteria,
            historical,
        } = options;

        this.ogConfig = {
            criteria,
            historical
        };

        const {
            flagged = true,
            confidence = '>= 70',
            testOn = ['body']
        } = criteria || {};

        this.criteria = {
            flagged,
            confidence: confidence !== undefined ? parseGenericValueOrPercentComparison(confidence) : undefined,
            testOn,
        }

        if (options.historical !== undefined) {
            const {
                window,
                criteria: historyCriteria,
                mustMatchCurrent = false,
                totalMatching = '> 0',
            } = options.historical

            let usedCriteria: MHSCriteria;
            if (historyCriteria === undefined) {
                usedCriteria = this.criteria;
            } else {
                const {
                    flagged: historyFlagged = true,
                    confidence: historyConfidence,
                    testOn: historyTestOn = ['body']
                } = historyCriteria || {};
                usedCriteria = {
                    flagged: historyFlagged,
                    confidence: historyConfidence !== undefined ? parseGenericValueOrPercentComparison(historyConfidence) : undefined,
                    testOn: historyTestOn,
                }
            }

            this.historical = {
                criteria: usedCriteria,
                window: windowConfigToWindowCriteria(window),
                mustMatchCurrent,
                totalMatching: parseGenericValueOrPercentComparison(totalMatching),
            };
        }
    }

    getKind(): string {
        return 'mhs';
    }

    getSpecificPremise(): object {
        return this.ogConfig;
    }

    protected async process(item: Submission | Comment): Promise<[boolean, RuleResult]> {

        let ogResult = await this.testActivity(item, this.criteria);
        let historicResults: MHSCriteriaResult[] | undefined;
        let historicalCriteriaTest: string | undefined;

        if (this.historical !== undefined && (!this.historical.mustMatchCurrent || ogResult.passed)) {
            const {
                criteria,
                window,
            } = this.historical;
            const history = await this.resources.getAuthorActivities(item.author, window);

            historicResults = await mapAsync(history, async (x: SnoowrapActivity) => await this.testActivity(x, criteria)); // history.map(x => this.testActivity(x, sentiment));
        }

        const logSummary: string[] = [];

        let triggered = false;
        let humanWindow: string | undefined;
        let historicalPassed: string | undefined;
        let totalMatchingText: string | undefined;

        if (historicResults === undefined) {
            triggered = ogResult.passed;
            logSummary.push(`Current Activity MHS Test: ${ogResult.summary}`);
            if (!triggered && this.historical !== undefined && this.historical.mustMatchCurrent) {
                logSummary.push(`Did not check Historical because 'mustMatchCurrent' is true`);
            }
        } else {
            const {
                totalMatching,
                criteria,
            } = this.historical as HistoricalMHS;

            historicalCriteriaTest = mhsCriteriaTestDisplay(criteria);

            totalMatchingText = totalMatching.displayText;
            const allResults = historicResults
            const passed = allResults.filter(x => x.passed);

            const firstActivity = allResults[0].activity;
            const lastActivity = allResults[allResults.length - 1].activity;

            const humanRange = dayjs.duration(dayjs(firstActivity.created_utc * 1000).diff(dayjs(lastActivity.created_utc * 1000))).humanize();

            humanWindow = `${allResults.length} Activities (${humanRange})`;

            const {operator, value, isPercent} = totalMatching;
            if (isPercent) {
                const passPercentVal = passed.length / allResults.length
                triggered = comparisonTextOp(passPercentVal, operator, (value / 100));
                historicalPassed = `${passed.length} (${formatNumber(passPercentVal)}%)`;
            } else {
                triggered = comparisonTextOp(passed.length, operator, value);
                historicalPassed = `${passed.length}`;
            }
            logSummary.push(`${triggeredIndicator(triggered)} ${historicalPassed} historical activities of ${humanWindow} passed MHS criteria '${historicalCriteriaTest}' which ${triggered ? 'MET' : 'DID NOT MEET'} threshold '${totalMatching.displayText}'`);
        }

        const result = logSummary.join(' || ');
        this.logger.verbose(result);

        return Promise.resolve([triggered, this.getResult(triggered, {
            result,
            data: {
                results: {
                    triggered,
                    criteriaTest: mhsCriteriaTestDisplay(this.criteria),
                    historicalCriteriaTest,
                    window: humanWindow,
                    totalMatching: totalMatchingText
                }
            }
        })]);
    }

    protected async testActivity(a: SnoowrapActivity, criteria: MHSCriteria): Promise<MHSCriteriaResult> {
        const content = [];
        if (asComment(a)) {
            content.push(a.body);
        } else {
            if (criteria.testOn.includes('title')) {
                content.push(a.title);
            }
            if (criteria.testOn.includes('body') && a.is_self) {
                content.push(a.selftext);
            }
        }
        const mhsResult = await this.getMHSResponse(content.join(' '));

        const {
            flagged,
            confidence
        } = criteria;

        let flaggedPassed: boolean | undefined;
        let confPassed: boolean | undefined;

        let summary = [];

        if (confidence !== undefined) {
            const {operator, value} = confidence;
            confPassed = comparisonTextOp(mhsResult.confidence * 100, operator, value);
            summary.push(`Confidence test (${confidence.displayText}) ${confPassed ? 'PASSED' : 'DID NOT PASS'} MHS confidence of ${formatConfidence(mhsResult.confidence)}`)
        }

        if (flagged !== undefined) {
            flaggedPassed = flagged ? mhsResult.class === 'flag' : mhsResult.class === 'normal';
            summary.push(`Flagged pass condition of ${flagged} (${flagged ? 'toxic' : 'normal'}) ${flaggedPassed ? 'MATCHED' : 'DID NOT MATCH'} MHS flag '${mhsResult.class === 'flag' ? 'toxic' : 'normal'}' ${confidence === undefined ? ` (${formatConfidence(mhsResult.confidence)} confidence)` : ''}`);
        }

        const passed = (flaggedPassed === undefined || flaggedPassed) && (confPassed === undefined || confPassed);

        return {
            activity: a,
            criteria,
            mhsResult,
            passed,
            summary: `${triggeredIndicator(passed)} ${summary.join(' | ')}`
        }
    }

    protected async getMHSResponse(content: string): Promise<MHSResponse> {
        const hash = objectHash.sha1({content});
        const key = `mhs-${hash}`;
        if (this.resources.wikiTTL !== false) {
            let res = await this.resources.cache.get(key) as undefined | null | MHSResponse;
            if(res !== undefined && res !== null) {
                // don't cache bad responses
                if(res.response.toLowerCase() === 'success')
                {
                    return res;
                }
            }
            res = await this.callMHS(content);
            if(res.response.toLowerCase() === 'success') {
                await this.resources.cache.set(key, res, {ttl: this.resources.wikiTTL});
            }
            return res;
        }
        return this.callMHS(content);
    }

    protected async callMHS(content: string): Promise<MHSResponse> {
        try {
            return await got.post(`https://api.moderatehatespeech.com/api/v1/moderate/`, {
                headers: {
                    'Content-Type': `application/json`,
                },
                json: {
                    token: this.resources.thirdPartyCredentials.mhs?.apiKey,
                    text: content
                },
            }).json() as MHSResponse;
        } catch (err: any) {
            let error: string | undefined = undefined;
            if (err instanceof HTTPError) {
                error = err.response.statusMessage;
                if (typeof err.response.body === 'string') {
                    error = `(${err.response.statusCode}) ${err.response.body}`;
                }
            }
            throw new CMError(`MHS request failed${error !== undefined ? ` with error: ${error}` : ''}`, {cause: err});
        }
    }
}

const mhsCriteriaTestDisplay = (criteria: MHSCriteria) => {
    const summary = [];
    if (criteria.flagged !== undefined) {
        summary.push(`${criteria.flagged ? 'IS FLAGGED' : 'IS NOT FLAGGED'} as toxic`);
    }
    if (criteria.confidence !== undefined) {
        summary.push(`MHS confidence is ${criteria.confidence.displayText}`);
    }
    return summary.join(' AND ');
}

interface MHSResponse {
    confidence: number
    response: string
    class: 'flag' | 'normal'
}

interface MHSCriteriaResult {
    mhsResult: MHSResponse
    criteria: MHSCriteria
    passed: boolean
    summary: string,
    activity: SnoowrapActivity
}

/**
 * Test the content of Activities from the Author history against MHS criteria
 *
 * If this is defined then the `totalMatching` threshold must pass for the Rule to trigger
 *
 * If `criteria` is defined here it overrides the top-level `criteria` value
 *
 * */
interface HistoricalMHSConfig {
    window: ActivityWindowConfig

    criteria?: MHSCriteriaConfig

    /**
     * When `true` the original Activity being checked MUST pass its criteria before the Rule considers any history
     *
     * @default false
     * */
    mustMatchCurrent?: boolean

    /**
     * A string containing a comparison operator and a value to compare Activities from history that pass the given `criteria` test
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 12`  => greater than 12 activities passed given `criteria` test
     * * EX `<= 10%` => less than 10% of all Activities from history passed given `criteria` test
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * @default "> 0"
     * @examples ["> 0","> 10%"]
     * */
    totalMatching: string
}

interface HistoricalMHS extends Omit<HistoricalMHSConfig, | 'window' | 'totalMatching' | 'criteria'> {
    window: ActivityWindowCriteria
    criteria: MHSCriteria
    totalMatching: GenericComparison
}

/**
 * Criteria used to trigger based on MHS results
 *
 * If both `flagged` and `confidence` are specified then both conditions must pass.
 *
 * By default, only `flagged` is defined as `true`
 * */
interface MHSCriteriaConfig {
    /**
     * Test if MHS considers content flagged as toxic or not
     *
     * @default true
     * */
    flagged?: boolean

    /**
     * A string containing a comparison operator and a value to compare against the confidence returned from MHS
     *
     * The syntax is `(< OR > OR <= OR >=) <number>`
     *
     * * EX `> 50`  => MHS confidence is greater than 50%
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * @examples ["> 50"]
     * */
    confidence?: string
    /**
     * Which content from an Activity to send to MHS
     *
     * Only used if the Activity being tested is a Submission -- Comments can be only tested against their body
     *
     * If more than one type of content is specified then all text is tested together as one string
     *
     * @default ["body"]
     * */
    testOn?: ('title' | 'body')[]
}

interface MHSCriteria extends Omit<MHSCriteriaConfig, 'confidence'> {
    confidence?: GenericComparison
    testOn: ('title' | 'body')[]
}

interface MHSConfig {

    criteria?: MHSCriteriaConfig

    /**
     * run MHS on Activities from the Author history
     *
     * If this is defined then the `totalMatching` threshold must pass for the Rule to trigger
     *
     * If `criteria` is defined here it overrides the top-level `criteria` value
     *
     * */
    historical?: HistoricalMHSConfig
}

export interface MHSRuleOptions extends MHSConfig, RuleOptions {
}

/**
 * Test content of an Activity against the MHS toxicity model for reddit content
 *
 * Running this Rule with no configuration will use a default configuration that will cause the Rule to trigger if MHS flags the content of the Activity as toxic.
 *
 * More info:
 *
 * * https://moderatehatespeech.com/docs/
 * * https://moderatehatespeech.com/
 *
 * */
export interface MHSRuleJSONConfig extends MHSConfig, RuleJSONConfig {
    /**
     * @examples ["mhs"]
     * @default mhs
     * */
    kind: 'mhs'
}

export default MHSRule;
