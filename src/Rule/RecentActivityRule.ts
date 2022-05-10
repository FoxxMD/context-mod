import {Rule, RuleJSONConfig, RuleOptions} from "./index";
import {VoteableContent} from "snoowrap";
import Submission from "snoowrap/dist/objects/Submission";
import Comment from "snoowrap/dist/objects/Comment";
import as from 'async';
import pMap from 'p-map';
// @ts-ignore
import subImageMatch from 'matches-subimage';
import {
    activityWindowText,
    asSubmission, bitsToHexLength,
    // blockHashImage,
    compareImages,
    comparisonTextOp, convertSubredditsRawToStrong,
    FAIL,
    formatNumber,
    getActivitySubredditName, imageCompareMaxConcurrencyGuess,
    //getImageDataFromUrl,
    isSubmission,
    isValidImageURL,
    objectToStringSummary,
    parseGenericValueOrPercentComparison, parseRedditEntity,
    parseStringToRegex,
    parseSubredditName,
    parseUsableLinkIdentifier,
    PASS, sleep,
    toStrongSubredditState, windowConfigToWindowCriteria
} from "../util";
import {
    //ImageData,
    ImageDetection,
    ReferenceSubmission, RuleResult, StrongImageDetection
} from "../Common/interfaces";
import ImageData from "../Common/ImageData";
import {blockhash, hammingDistance} from "../Common/blockhash/blockhash";
import leven from "leven";
import {
    CommentState,
    StrongSubredditCriteria,
    SubmissionState,
    SubredditCriteria
} from "../Common/Infrastructure/Filters/FilterCriteria";
import {ActivityWindow, ActivityWindowConfig} from "../Common/Infrastructure/ActivityWindow";

const parseLink = parseUsableLinkIdentifier();

export class RecentActivityRule extends Rule {
    window: ActivityWindowConfig;
    thresholds: ActivityThreshold[];
    useSubmissionAsReference: boolean | undefined;
    imageDetection: StrongImageDetection
    lookAt?: 'comments' | 'submissions';

    constructor(options: RecentActivityRuleOptions) {
        super(options);
        const {
            window = 15,
            useSubmissionAsReference,
            imageDetection,
            lookAt,
        } = options || {};

        const {
            enable = false,
            fetchBehavior = 'extension',
            threshold = 5,
            hash = {},
            pixel = {},
        } = imageDetection || {};

        const {
            enable: hEnable = true,
            bits = 16,
            ttl = 60,
            hardThreshold = threshold,
            softThreshold
        } = hash || {};

        const {
            enable: pEnable = true,
            threshold: pThreshold = threshold,
        } = pixel || {};

        this.imageDetection = {
            enable,
            fetchBehavior,
            threshold,
            hash: {
                enable: hEnable,
                hardThreshold,
                softThreshold,
                bits,
                ttl,
            },
            pixel: {
                enable: pEnable,
                threshold: pThreshold
            }
        };
        this.lookAt = lookAt;
        if(this.lookAt !== undefined) {
            this.logger.warn(`'lookAt' is deprecated and will be removed in a future version. Use 'window.fetch' instead`);
        }
        this.useSubmissionAsReference = useSubmissionAsReference;
        this.window = window;
        this.thresholds = options.thresholds;
    }

    getKind(): string {
        return 'recent';
    }

    getSpecificPremise(): object {
        return {
            window: this.window,
            thresholds: this.thresholds,
            useSubmissionAsReference: this.useSubmissionAsReference,
            lookAt: this.lookAt
        }
    }

    async process(item: Submission | Comment): Promise<[boolean, RuleResult]> {
        let activities;

        // ACID is a bitch
        // reddit may not return the activity being checked in the author's recent history due to availability/consistency issues or *something*
        // so make sure we add it in if config is checking the same type and it isn't included
        // TODO refactor this for SubredditState everywhere branch
        let shouldIncludeSelf = true;
        const strongWindow = windowConfigToWindowCriteria(this.window);
        const {
            filterOn: {
                post: {
                    subreddits: {
                        include = [],
                        exclude = []
                    } = {},
                } = {},
            } = {}
        } = strongWindow;
        // typeof x === string -- a patch for now...technically this is all it supports but eventually will need to be able to do any SubredditState
        if (include.length > 0 && !include.some(x => x.name !== undefined && x.name.toLocaleLowerCase() === item.subreddit.display_name.toLocaleLowerCase())) {
            shouldIncludeSelf = false;
        } else if (exclude.length > 0 && exclude.some(x => x.name !== undefined && x.name.toLocaleLowerCase() === item.subreddit.display_name.toLocaleLowerCase())) {
            shouldIncludeSelf = false;
        }

        if(strongWindow.fetch === undefined && this.lookAt !== undefined) {
            switch(this.lookAt) {
                case 'comments':
                    strongWindow.fetch = 'comment';
                    break;
                case 'submissions':
                    strongWindow.fetch = 'submission';
            }
        }

        activities = await this.resources.getAuthorActivities(item.author, strongWindow);

        switch (strongWindow.fetch) {
            case 'comment':
                if (shouldIncludeSelf && item instanceof Comment && !activities.some(x => x.name === item.name)) {
                    activities.unshift(item);
                }
                break;
            case 'submission':
                if (shouldIncludeSelf && item instanceof Submission && !activities.some(x => x.name === item.name)) {
                    activities.unshift(item);
                }
                break;
            default:
                if (shouldIncludeSelf && !activities.some(x => x.name === item.name)) {
                    activities.unshift(item);
                }
                break;
        }

        let viableActivity = activities;
        // if config does not specify reference then we set the default based on whether the item is a submission or not
        // -- this is essentially the same as defaulting reference to true BUT eliminates noisy "can't use comment as reference" log statement when item is a comment
        let inferredSubmissionAsRef = this.useSubmissionAsReference;
        if(inferredSubmissionAsRef === undefined) {
            inferredSubmissionAsRef = isSubmission(item);
        }
        if (inferredSubmissionAsRef) {
            if (!asSubmission(item)) {
                this.logger.warn('Cannot use post as reference because triggered item is not a Submission');
            } else if (item.is_self) {
                this.logger.warn('Cannot use post as reference because triggered Submission is not a link type');
            } else {
                const itemId = item.id;
                const referenceUrl = await item.url;
                const usableUrl = parseLink(referenceUrl);
                let filteredActivity: (Submission|Comment)[] = [];
                let analysisTimes: number[] = [];
                let referenceImage: ImageData | undefined;
                if (this.imageDetection.enable) {
                    try {
                        referenceImage = ImageData.fromSubmission(item);
                        referenceImage.setPreferredResolutionByWidth(800);
                        if(this.imageDetection.hash.enable) {
                            let refHash: string | undefined;
                            if(this.imageDetection.hash.ttl !== undefined) {
                                refHash = await this.resources.getImageHash(referenceImage);
                                if(refHash === undefined) {
                                    refHash = await referenceImage.hash(this.imageDetection.hash.bits);
                                    await this.resources.setImageHash(referenceImage, refHash, this.imageDetection.hash.ttl);
                                } else if(refHash.length !== bitsToHexLength(this.imageDetection.hash.bits)) {
                                    this.logger.warn('Reference image hash length did not correspond to bits specified in config. Recomputing...');
                                    refHash = await referenceImage.hash(this.imageDetection.hash.bits);
                                    await this.resources.setImageHash(referenceImage, refHash, this.imageDetection.hash.ttl);
                                }
                            } else {
                                refHash = await referenceImage.hash(this.imageDetection.hash.bits);
                            }
                        }
                        //await referenceImage.sharp();
                        // await referenceImage.hash();
                        // if (referenceImage.preferredResolution !== undefined) {
                        //     await (referenceImage.getSimilarResolutionVariant(...referenceImage.preferredResolution) as ImageData).sharp();
                        // }
                    } catch (err: any) {
                        this.logger.verbose(err.message);
                    }
                }
                let longRun;
                if (referenceImage !== undefined) {
                    const l = this.logger;
                    longRun = setTimeout(() => {
                        l.verbose('FYI: Image processing is causing rule to take longer than normal');
                    }, 2500);
                }
                // @ts-ignore
                const ci = async (x: (Submission|Comment)) => {
                    if (!asSubmission(x) || x.id === itemId) {
                        return null;
                    }
                    if (x.url === undefined) {
                        return null;
                    }
                    if (parseLink(x.url) === usableUrl) {
                        return x;
                    }
                    // only do image detection if regular URL comparison and other conditions fail first
                    // to reduce CPU/bandwidth usage
                    if (referenceImage !== undefined) {
                        try {
                            let imgData =  ImageData.fromSubmission(x);
                            imgData.setPreferredResolutionByWidth(800);
                            if(this.imageDetection.hash.enable) {
                                let compareHash: string | undefined;
                                if(this.imageDetection.hash.ttl !== undefined) {
                                    compareHash = await this.resources.getImageHash(imgData);
                                }
                                if(compareHash === undefined)
                                {
                                    compareHash = await imgData.hash(this.imageDetection.hash.bits);
                                    if(this.imageDetection.hash.ttl !== undefined) {
                                        await this.resources.setImageHash(imgData, compareHash, this.imageDetection.hash.ttl);
                                    }
                                }
                                const refHash = await referenceImage.hash(this.imageDetection.hash.bits);
                                if(refHash.length !== compareHash.length) {
                                    this.logger.debug(`Hash lengths were not the same! Will need to recompute compare hash to match reference.\n\nReference: ${referenceImage.baseUrl} has is ${refHash.length} char long | Comparing: ${imgData.baseUrl} has is ${compareHash} ${compareHash.length} long`);
                                    compareHash = await imgData.hash(this.imageDetection.hash.bits)
                                }
                                const distance = leven(refHash, compareHash);
                                const diff = (distance/refHash.length)*100;


                                // return image if hard is defined and diff is less
                                if(null !== this.imageDetection.hash.hardThreshold && diff <= this.imageDetection.hash.hardThreshold) {
                                    return x;
                                }
                                // hard is either not defined or diff was gerater than hard

                                // if soft is defined
                                if (this.imageDetection.hash.softThreshold !== undefined) {
                                    // and diff is greater than soft allowance
                                    if(diff > this.imageDetection.hash.softThreshold) {
                                        // not similar enough
                                        return null;
                                    }
                                   // similar enough, will continue on to pixel (if enabled!)
                                } else {
                                    // only hard was defined and did not pass
                                    return null;
                                }
                            }
                            // at this point either hash was not enabled or it was and we hit soft threshold but not hard
                            if(this.imageDetection.pixel.enable) {
                                try {
                                    const [compareResult, sameImage] = await compareImages(referenceImage, imgData, this.imageDetection.pixel.threshold / 100);
                                    analysisTimes.push(compareResult.analysisTime);
                                    if (sameImage) {
                                        return x;
                                    }
                                } catch (err: any) {
                                    this.logger.warn(`Unexpected error encountered while pixel-comparing images, will skip comparison => ${err.message}`);
                                }
                            }
                        } catch (err: any) {
                            if(!err.message.includes('did not end with a valid image extension')) {
                                this.logger.warn(`Will not compare image from Submission ${x.id} due to error while parsing image URL => ${err.message}`);
                            }
                        }
                    }
                    return null;
                }
                // parallel all the things
                this.logger.profile('asyncCompare');
                const results = await pMap(viableActivity, ci, {concurrency: imageCompareMaxConcurrencyGuess});
                this.logger.profile('asyncCompare', {level: 'debug', message: 'Total time for image comparison (incl download/cache calls)'});
                const totalAnalysisTime = analysisTimes.reduce((acc, x) => acc + x,0);
                if(analysisTimes.length > 0) {
                    this.logger.debug(`Reference image pixel-compared ${analysisTimes.length} times. Timings: Avg ${formatNumber(totalAnalysisTime / analysisTimes.length, {toFixed: 0})}ms | Max: ${Math.max(...analysisTimes)}ms | Min: ${Math.min(...analysisTimes)}ms | Total: ${totalAnalysisTime}ms (${formatNumber(totalAnalysisTime/1000)}s)`);
                }
                filteredActivity = filteredActivity.concat(results.filter(x => x !== null));
                if (longRun !== undefined) {
                    clearTimeout(longRun);
                }
                viableActivity = filteredActivity;
            }
        }

        const allDistinctSubreddits = [...viableActivity.reduce((acc, curr) => {
            acc.add(curr.subreddit_name_prefixed);
            return acc;
        }, new Set())].map(x => parseRedditEntity(x as string));

        const summaries = [];
        let totalTriggeredOn;
        for (const triggerSet of this.thresholds) {
            let currCount = 0;
            const presentSubs: string[] = [];
            let combinedKarma = 0;
            const {
                threshold = '>= 1',
                subreddits = [],
                karma: karmaThreshold,
                commentState,
                submissionState,
                subredditThreshold,
            } = triggerSet;

            // convert subreddits array into entirely StrongSubredditState
            const defaultOpts = {
                defaultFlags: 'i',
                generateDescription: true
            };
            const subStates: StrongSubredditCriteria[] = subreddits.map((x) => convertSubredditsRawToStrong(x, defaultOpts));

            let validActivity: (Comment | Submission)[] = await as.filter(viableActivity, async (activity) => {
                if (asSubmission(activity) && submissionState !== undefined) {
                    const {passed} = await this.resources.testItemCriteria(activity, {criteria: submissionState}, this.logger);
                    return passed;
                } else if (commentState !== undefined) {
                    const {passed} = await this.resources.testItemCriteria(activity, {criteria: commentState}, this.logger);
                    return passed;
                }
                return true;
            });

            validActivity = await this.resources.batchTestSubredditCriteria(validActivity, subStates, item.author);
            for (const activity of validActivity) {
                currCount++;
                // @ts-ignore
                combinedKarma += activity.score;
                const pSub = getActivitySubredditName(activity);
                if (!presentSubs.includes(pSub)) {
                    presentSubs.push(pSub);
                }
            }

            const {operator, value, isPercent} = parseGenericValueOrPercentComparison(threshold);
            let sum: any = {
                subsWithActivity: presentSubs,
                combinedKarma,
                karmaThreshold,
                subredditCriteria: subStates.map(x => x.stateDescription),
                subreddits: allDistinctSubreddits.map(x => x.name),
                count: currCount,
                threshold,
                subredditThreshold,
                triggered: false,
                testValue: currCount.toString()
            };
            if (isPercent) {
                sum.testValue = `${formatNumber((currCount / viableActivity.length) * 100)}%`;
                sum.thresholdTriggered = comparisonTextOp(currCount / viableActivity.length, operator, value / 100);
            } else {
                sum.thresholdTriggered = comparisonTextOp(currCount, operator, value);
            }
            // if we would trigger on threshold need to also test for karma
            if (sum.thresholdTriggered && karmaThreshold !== undefined) {
                const {operator: opKarma, value: valueKarma} = parseGenericValueOrPercentComparison(karmaThreshold);
                sum.karmaThresholdTriggered = comparisonTextOp(combinedKarma, opKarma, valueKarma);
            }
            if(sum.thresholdTriggered && subredditThreshold !== undefined) {
                const {operator, value, isPercent} = parseGenericValueOrPercentComparison(subredditThreshold);
                if (isPercent) {
                    sum.subredditThresholdTriggered = comparisonTextOp(sum.subsWithActivity / sum.subreddits, operator, value / 100);
                } else {
                    sum.subredditThresholdTriggered = comparisonTextOp(sum.subsWithActivity, operator, value);
                }
            }

            summaries.push(sum);
            const { thresholdTriggered, karmaThresholdTriggered, subredditThresholdTriggered } = sum;
            sum.triggered = thresholdTriggered && ((karmaThresholdTriggered === undefined || karmaThresholdTriggered) && (subredditThresholdTriggered === undefined || subredditThresholdTriggered));
            if(sum.triggered) {
                totalTriggeredOn = sum;
            }
            // if either trigger condition is hit end the iteration early
            if (totalTriggeredOn !== undefined) {
                break;
            }
        }
        let result = '';
        if (totalTriggeredOn !== undefined) {
            const resultData = this.generateResultData(totalTriggeredOn, viableActivity);
            result = `${PASS} ${resultData.result}`;
            this.logger.verbose(result);
            return Promise.resolve([true, this.getResult(true, resultData)]);
        } else if (summaries.length === 1) {
            // can display result if its only one summary otherwise need to log to debug
            const res = this.generateResultData(summaries[0], viableActivity);
            result = `${FAIL} ${res.result}`;
        } else {
            result = `${FAIL} No criteria was met. Use 'debug' to see individual results`;
            this.logger.debug(`\r\n ${summaries.map(x => this.generateResultData(x, viableActivity).result).join('\r\n')}`);
        }

        this.logger.verbose(result);

        return Promise.resolve([false, this.getResult(false, {result})]);
    }

    generateResultData(summary: any, activities: (Submission | Comment)[] = []) {
        const {
            count,
            testValue,
            subreddits = [],
            subsWithActivity = [],
            threshold,
            triggered,
            combinedKarma,
            karmaThreshold,
            subredditThreshold,
        } = summary;
        const relevantSubs = subsWithActivity.length === 0 ? subreddits : subsWithActivity;
        let totalSummaryParts: string[] = [`${testValue} activities found in ${subsWithActivity.length} of the specified subreddits (out of ${subreddits.length} total)`];
        let statSummary = '';
        let thresholdSummary = '';
        if(karmaThreshold !== undefined || subredditThreshold !== undefined) {
            let statParts = [];
            let thresholdParts = [];
            if(karmaThreshold !== undefined) {
                statParts.push(`${combinedKarma} combined karma`);
                thresholdParts.push(`${karmaThreshold} combined karma`);
            }
            if(subredditThreshold !== undefined) {
                statParts.push(`${subsWithActivity.length} distinct subreddits`);
                thresholdParts.push(`${subredditThreshold} distinct subreddits`);
            }
            statSummary = statParts.join(' and ');
            thresholdSummary = thresholdParts.join(' and ');
        }

        if(statSummary !== '') {
            totalSummaryParts.push(` with ${statSummary}`)
        }

        totalSummaryParts.push(` ${triggered ? 'MET' : 'DID NOT MEET'} threshold of ${threshold} activities`);

        if(thresholdSummary !== '') {
            totalSummaryParts.push(` and ${thresholdSummary}`);
        }

        if (triggered && subsWithActivity.length > 0) {
            totalSummaryParts.push(` -- subreddits: ${subsWithActivity.join(', ')}`);
        }

        // EX
        // 2 activities over 1 subreddits with 4 combined karma and 1 distinct subreddits did not meet threshold of > 1 activities and > 2 distinct subreddits -- subreddits: mySubreddit
        const totalSummary = totalSummaryParts.join('');

        return {
            result: totalSummary,
            data: {
                window: typeof this.window === 'number' ? `${activities.length} Items` : activityWindowText(activities),
                summary: totalSummary,
                subSummary: relevantSubs.join(', '),
                subCount: relevantSubs.length,
                totalCount: count,
                threshold,
                testValue,
                karmaThreshold,
                combinedKarma,
            }
        };
    }
}

/**
 * At least one count property must be present. If both are present then either can trigger the rule
 *
 * @minProperties 1
 * @additionalProperties false
 * */
export interface ActivityThreshold {
    /**
     * When present, a Submission will only be counted if it meets this criteria
     * */
    submissionState?: SubmissionState
    /**
     * When present, a Comment will only be counted if it meets this criteria
     * */
    commentState?: CommentState

    /**
     * A string containing a comparison operator and a value to compare recent activities against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 3`  => greater than 3 activities found in the listed subreddits
     * * EX `<= 75%` => number of Activities in the subreddits listed are equal to or less than 75% of all Activities
     *
     * **Note:** If you use percentage comparison here as well as `useSubmissionAsReference` then "all Activities" is only pertains to Activities that had the Link of the Submission, rather than all Activities from this window.
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * @default ">= 1"
     * @examples [">= 1"]
     * */
    threshold?: string

    /**
     * Test the **combined karma** from Activities found in the specified subreddits
     *
     * Value is a string containing a comparison operator and a number of **combined karma** to compare against
     *
     * If specified then both `threshold` and `karma` must be met for this `SubThreshold` to be satisfied
     *
     * The syntax is `(< OR > OR <= OR >=) <number>`
     *
     * * EX `> 50`  => greater than 50 combined karma for all found Activities in specified subreddits
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * */
    karma?: string

    /**
     * Activities will be counted if they are found in this list of Subreddits
     *
     * Each value in the list can be either:
     *
     *  * string (name of subreddit)
     *  * regular expression to run on the subreddit name
     *  * `SubredditState`
     *
     * EX `["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]`
     * @examples [["mealtimevideos","askscience", "/onlyfans*\/i", {"over18": true}]]
     * */
    subreddits?: (string | SubredditCriteria)[]

    /**
     * A string containing a comparison operator and a value to compare the **number of subreddits that have valid activities** against
     *
     * The syntax is `(< OR > OR <= OR >=) <number>[percent sign]`
     *
     * * EX `> 3`  => greater than 3 Subreddits found with valid activities
     * * EX `<= 75%` => number of Subreddits with valid activities are equal to or less than 75% of all Subreddits found
     *
     * **Note:** If you use percentage comparison here as well as `useSubmissionAsReference` then "all Subreddits found" is only pertains to Subreddits that had the Link of the Submission, rather than all Subreddits from this window.
     *
     * @pattern ^\s*(>|>=|<|<=)\s*(\d+)\s*(%?)(.*)$
     * @default ">= 1"
     * @examples [">= 1"]
     * */
    subredditThreshold?: string
}

interface RecentActivityConfig extends ActivityWindow, ReferenceSubmission {
    /**
     * DEPRECATED - use `window.fetch` instead
     *
     * If present restricts the activities that are considered for count from SubThreshold
     * @examples ["submissions","comments"]
     * @deprecationMessage use `window.fetch` instead
     * */
    lookAt?: 'comments' | 'submissions',
    /**
     * A list of subreddits/count criteria that may trigger this rule. ANY SubThreshold will trigger this rule.
     * @minItems 1
     * */
    thresholds: ActivityThreshold[],

    imageDetection?: ImageDetection

    /**
     * When Activity is a submission should we only include activities that are other submissions with the same content?
     *
     * * When the Activity is a submission this defaults to **true**
     * * When the Activity is a comment it is ignored (not relevant)
     *
     * @default true
     * */
    useSubmissionAsReference?: boolean
}

export interface RecentActivityRuleOptions extends RecentActivityConfig, RuleOptions {
}

/**
 * Checks a user's history for any Activity (Submission/Comment) in the subreddits specified in thresholds
 *
 * Available data for [Action templating](https://github.com/FoxxMD/context-mod#action-templating):
 *
 * ```
 * summary    => comma-deliminated list of subreddits that hit the threshold and their count EX subredditA(1), subredditB(4),...
 * subCount   => Total number of subreddits that hit the threshold
 * totalCount => Total number of all activity occurrences in subreddits
 * ```
 * */
export interface RecentActivityRuleJSONConfig extends RecentActivityConfig, RuleJSONConfig {
    /**
     * @examples ["recentActivity"]
     * */
    kind: 'recentActivity'
}

export default RecentActivityRule;
