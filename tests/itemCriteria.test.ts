import {describe, it} from 'mocha';
import {assert} from 'chai';
import dayjs from "dayjs";
import dduration, {Duration, DurationUnitType} from 'dayjs/plugin/duration.js';
import utc from 'dayjs/plugin/utc.js';
import advancedFormat from 'dayjs/plugin/advancedFormat';
import tz from 'dayjs/plugin/timezone';
import relTime from 'dayjs/plugin/relativeTime.js';
import sameafter from 'dayjs/plugin/isSameOrAfter.js';
import samebefore from 'dayjs/plugin/isSameOrBefore.js';
import weekOfYear from 'dayjs/plugin/weekOfYear.js';
import {SubredditResources} from "../src/Subreddit/SubredditResources";
import {NoopLogger} from '../src/Utils/loggerFactory';
import {Subreddit, Comment, Submission} from 'snoowrap/dist/objects';
import Snoowrap from "snoowrap";
import {getResource, getSnoowrap, getSubreddit, sampleActivity} from "./testFactory";
import {Subreddit as SubredditEntity} from "../src/Common/Entities/Subreddit";
import {Activity} from '../src/Common/Entities/Activity';
import {cmToSnoowrapActivityMap} from "../src/Common/Infrastructure/Filters/FilterCriteria";

dayjs.extend(dduration);
dayjs.extend(utc);
dayjs.extend(relTime);
dayjs.extend(sameafter);
dayjs.extend(samebefore);
dayjs.extend(tz);
dayjs.extend(advancedFormat);
dayjs.extend(weekOfYear);

describe('Item Criteria', function () {
    let resource: SubredditResources;
    let snoowrap: Snoowrap;
    let subreddit: Subreddit;
    let subredditEntity: SubredditEntity;

    before(async () => {
        resource = await getResource();
        snoowrap = await getSnoowrap();
        subreddit = await getSubreddit();
        subredditEntity = await resource.database.getRepository(SubredditEntity).save(new SubredditEntity({
            id: subreddit.id,
            name: subreddit.name
        }));
    });

    describe('Moderator accessible criteria', function () {

        describe('Reports criteria', function () {

            let sub: Submission;
            let activity: Activity;

            before(async () => {
                try {
                    sub = new Submission({
                        title: 'test',
                        id: 't3_je93j',
                        name: 't3_je93j',
                        created: dayjs().subtract(10, 'minutes').unix(),
                        created_utc: dayjs().subtract(10, 'minutes').unix(),
                        num_reports: 7,
                        user_reports: [
                            ['misinformation', 1, false, true],
                            ['personal attack', 3, false, true]
                        ],
                        mod_reports: [
                            ['suspicious activity', 1, false, true],
                            ['hate', 2, false, true]
                        ],
                        subreddit,
                        permalink: 'test',
                        author: 'aUser'
                    }, snoowrap, false);

                    activity = Activity.fromSnoowrapActivity(subredditEntity, sub);
                    await resource.database.getRepository(Activity).save(activity);
                } catch (e: any) {
                    throw e;
                }
            });

            it('Matches number of reports', async function () {
                assert.isTrue((await resource.isItem(sub, {reports: '> 2'}, NoopLogger, true)).passed);
            });
            it('Matches number of user reports', async function () {
                assert.isTrue((await resource.isItem(sub, {reports: '> 3 user'}, NoopLogger, true)).passed);
            });
            it('Matches number of mod reports', async function () {
                assert.isTrue((await resource.isItem(sub, {reports: '< 4 mod'}, NoopLogger, true)).passed);
            });
            it('Matches report reason literal', async function () {
                assert.isTrue((await resource.isItem(sub, {reports: '> 0 "misinformation"'}, NoopLogger, true)).passed);
            });
            it('Matches report reason regex', async function () {
                assert.isTrue((await resource.isItem(sub, {reports: '> 0 /misi.*/'}, NoopLogger, true)).passed);
            });
            it('Matches report time period', async function () {
                assert.isTrue((await resource.isItem(sub, {reports: '> 0 in 20 minutes'}, NoopLogger, true)).passed);
            });
        });

        it('Should detect if activity is removed when a moderator', async function () {
            assert.isTrue((await resource.isItem(sampleActivity.moddable.commentRemoved(), {removed: true}, NoopLogger, true)).passed);
        });
        it('Should detect if activity is filtered when a moderator', async function () {
            assert.isTrue((await resource.isItem(sampleActivity.moddable.commentFiltered(), {filtered: true}, NoopLogger, true)).passed);
        });
        it('Should detect if activity is approved when a moderator', async function () {
            assert.isTrue((await resource.isItem(new Comment({
                approved: true
            }, snoowrap, false), {approved: true}, NoopLogger, true)).passed);
        });

        it('Should detect if activity is marked as spam when a moderator', async function () {
            assert.isTrue((await resource.isItem(new Comment({
                spam: true,
                can_mod_post: true,
            }, snoowrap, false), {spam: true}, NoopLogger, true)).passed);
            assert.isTrue((await resource.isItem(new Comment({
                spam: false,
                can_mod_post: true
            }, snoowrap, false), {spam: false}, NoopLogger, true)).passed);
        });
    });

    describe('Publicly accessible criteria', function () {

        // TODO dispatched

        it('should detect broad source', async function() {
            const sub = new Submission({
            }, snoowrap, false);
            assert.isTrue((await resource.isItem(sub, {source: 'dispatch'}, NoopLogger, true, 'dispatch:test')).passed);
            assert.isFalse((await resource.isItem(sub, {source: 'poll'}, NoopLogger, true, 'dispatch:test')).passed);
            assert.isTrue((await resource.isItem(sub, {source: 'poll'}, NoopLogger, true, 'poll')).passed);
        })

        it('should detect source with identifier', async function() {
            const sub = new Submission({
            }, snoowrap, false);
            assert.isTrue((await resource.isItem(sub, {source: 'dispatch:test'}, NoopLogger, true, 'dispatch:test')).passed);
            assert.isFalse((await resource.isItem(sub, {source: 'user:test'}, NoopLogger, true, 'user')).passed);
        })

        it('Should detect score (upvotes)', async function () {
            const sub = new Submission({
                score: 100,
            }, snoowrap, false);
            assert.isTrue((await resource.isItem(sub, {score: '> 50'}, NoopLogger, true)).passed);
            assert.isTrue((await resource.isItem(sub, {score: '< 101'}, NoopLogger, true)).passed);
        });

        it('Should detect if activity is removed', async function () {
            assert.isTrue((await resource.isItem(sampleActivity.public.activityRemoved(), {removed: true}, NoopLogger, true)).passed);
        });
        it('Should detect if activity is deleted', async function () {
            assert.isTrue((await resource.isItem(sampleActivity.public.submissionDeleted(), {deleted: true}, NoopLogger, true)).passed);
        });

        it('Should fail if trying to detect approved and not a moderator', async function () {
            assert.isFalse((await resource.isItem(new Comment({
                approved_by: undefined
            }, snoowrap, false), {approved: true}, NoopLogger, true)).passed);
        });

        it('Should detect age', async function () {
            const time = dayjs().subtract(5, 'minutes').unix();
            const sub = new Submission({
                created: time,
            }, snoowrap, false);
            assert.isTrue((await resource.isItem(sub, {age: '> 4 minutes'}, NoopLogger, true)).passed);
            assert.isTrue((await resource.isItem(sub, {age: '< 10 minutes'}, NoopLogger, true)).passed);
        });

        it('Should match created day of week', async function () {
            assert.isTrue((await resource.isItem(new Submission({
                created: 1664220502,
            }, snoowrap, false), {createdOn: 'monday'}, NoopLogger, true)).passed);
        });

        it('Should match created cron expression', async function () {
            assert.isTrue((await resource.isItem(new Submission({
                created: 1664220502,
            }, snoowrap, false), {createdOn: '* * 26 * *'}, NoopLogger, true)).passed);
        });

        it('Should match title literal on submission', async function () {
            assert.isTrue((await resource.isItem(new Submission({
                title: 'foo test',
            }, snoowrap, false), {title: 'foo'}, NoopLogger, true)).passed);
        });

        it('Should match title regex on submission', async function () {
            assert.isTrue((await resource.isItem(new Submission({
                title: 'foo test',
            }, snoowrap, false), {title: '/foo .*/i'}, NoopLogger, true)).passed);
        });

        it('Should detect reddit media domain on submission', async function () {
            assert.isTrue((await resource.isItem(new Submission({
                is_reddit_media_domain: true,
            }, snoowrap, false), {isRedditMediaDomain: true}, NoopLogger, true)).passed);
            assert.isTrue((await resource.isItem(new Submission({
                is_reddit_media_domain: false,
            }, snoowrap, false), {isRedditMediaDomain: false}, NoopLogger, true)).passed);
        });

        it('Should detect if author is OP', async function () {
            // for comments
            assert.isTrue((await resource.isItem(new Comment({
                is_submitter: true,
            }, snoowrap, false), {op: true}, NoopLogger, true)).passed);
            assert.isTrue((await resource.isItem(new Comment({
                is_submitter: false,
            }, snoowrap, false), {op: false}, NoopLogger, true)).passed);

            // for submission
            assert.isTrue((await resource.isItem(new Submission({}, snoowrap, false), {op: true}, NoopLogger, true)).passed);
        });

        it('Should detect comment depth', async function () {
            assert.isTrue((await resource.isItem(new Comment({
                depth: 2,
            }, snoowrap, false), {depth: '> 1'}, NoopLogger, true)).passed);
        });

        it('Should detect upvote ratio on submission', async function () {
            assert.isTrue((await resource.isItem(new Submission({
                upvote_ratio: 0.55,
            }, snoowrap, false), {upvoteRatio: '> 33'}, NoopLogger, true)).passed);
        });

        for(const prop of ['link_flair_text', 'link_flair_css_class', 'authorFlairCssClass', 'authorFlairTemplateId', 'authorFlairText', 'flairTemplate']) {
            const activityPropName = cmToSnoowrapActivityMap[prop] ?? prop;

            it(`Should detect specific ${prop} as single string`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: 'test',
                }, snoowrap, false), {[prop]: 'test'}, NoopLogger, true)).passed);
            });
            it(`Should detect specific ${prop} from array of string`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: 'test',
                }, snoowrap, false), {[prop]: ['foo','test']}, NoopLogger, true)).passed);
            });
            it(`Should detect specific ${prop}, case-insensitive`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: 'test',
                }, snoowrap, false), {[prop]: 'TeSt'}, NoopLogger, true)).passed);
            });
            it(`Should detect specific ${prop}, when not a regex, is subset of string`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: 'this is a test phrase',
                }, snoowrap, false), {[prop]: 'test'}, NoopLogger, true)).passed);
            });
            it(`Should detect specific ${prop} is not in criteria`, async function () {
                assert.isFalse((await resource.isItem(new Submission({
                    [activityPropName]: 'test',
                }, snoowrap, false), {[prop]: ['foo']}, NoopLogger, true)).passed);
            });
            it(`Should detect any ${prop}`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: 'test',
                }, snoowrap, false), {[prop]: true}, NoopLogger, true)).passed);
            });
            it(`Should detect no ${prop}`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: null
                }, snoowrap, false), {[prop]: false}, NoopLogger, true)).passed);
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: ''
                }, snoowrap, false), {[prop]: false}, NoopLogger, true)).passed);
                assert.isFalse((await resource.isItem(new Submission({
                    [activityPropName]: ''
                }, snoowrap, false), {[prop]: 'foo'}, NoopLogger, true)).passed);
            });
            it(`Should detect ${prop} as Regular Expression`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: 'test'
                }, snoowrap, false), {[prop]: '/te.*/'}, NoopLogger, true)).passed);
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: 'test'
                }, snoowrap, false), {[prop]: ['foo', '/t.*/']}, NoopLogger, true)).passed);
            });
        }

        for(const prop of ['authorFlairBackgroundColor', 'link_flair_background_color']) {
            const activityPropName = cmToSnoowrapActivityMap[prop] ?? prop;

            it(`Should detect specific ${prop} as single string`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: '#400080',
                }, snoowrap, false), {[prop]: '#400080'}, NoopLogger, true)).passed);
            });
            it(`Should detect specific ${prop} from array of string`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: '#400080',
                }, snoowrap, false), {[prop]: ['#903480','#400080']}, NoopLogger, true)).passed);
            });
            it(`Should detect specific ${prop} is not in criteria`, async function () {
                assert.isFalse((await resource.isItem(new Submission({
                    [activityPropName]: '#400080',
                }, snoowrap, false), {[prop]: ['#903480']}, NoopLogger, true)).passed);
            });
            it(`Should detect any ${prop}`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: '#400080',
                }, snoowrap, false), {[prop]: true}, NoopLogger, true)).passed);
            });
            it(`Should detect no ${prop}`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: null
                }, snoowrap, false), {[prop]: false}, NoopLogger, true)).passed);
            });
            it(`Should detect ${prop} and remove # prefix`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: '#400080'
                }, snoowrap, false), {[prop]: '400080'}, NoopLogger, true)).passed);
            });
            it(`Should detect ${prop} as Regular Expression`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: '#400080'
                }, snoowrap, false), {[prop]: '/#400.*/'}, NoopLogger, true)).passed);
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: '#400080'
                }, snoowrap, false), {[prop]: ['#903480', '/400.*/']}, NoopLogger, true)).passed);
            });
        }

        for(const prop of ['link_flair_text', 'link_flair_css_class', 'flairTemplate', 'link_flair_background_color']) {
            it(`Should PASS submission criteria '${prop}' with a reason when Activity is a Comment`, async function () {
                const result = await resource.isItem(new Comment({}, snoowrap, false), {[prop]: true}, NoopLogger, true);
                assert.isTrue(result.passed);
                assert.equal(result.propertyResults[0].reason, `Cannot test for ${prop} on Comment`)
            });
        }

        for(const prop of ['pinned', 'spoiler', 'is_self', 'over_18', 'locked', 'distinguished']) {
            it(`Should detect activity with ${prop} attribute`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [prop]: true,
                }, snoowrap, false), {[prop]: true}, NoopLogger, true)).passed);
                assert.isTrue((await resource.isItem(new Submission({
                    [prop]: false,
                }, snoowrap, false), {[prop]: false}, NoopLogger, true)).passed);
            });
        }

        // TODO submissionState
    });
});

