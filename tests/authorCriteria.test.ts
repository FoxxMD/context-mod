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
import {Subreddit, Comment, Submission, RedditUser} from 'snoowrap/dist/objects';
import Snoowrap from "snoowrap";
import {getResource, getSnoowrap, getSubreddit, sampleActivity} from "./testFactory";
import {Subreddit as SubredditEntity} from "../src/Common/Entities/Subreddit";
import {Activity} from '../src/Common/Entities/Activity';
import {cmToSnoowrapActivityMap} from "../src/Common/Infrastructure/Filters/FilterCriteria";
import {SnoowrapActivity} from "../src/Common/Infrastructure/Reddit";

dayjs.extend(dduration);
dayjs.extend(utc);
dayjs.extend(relTime);
dayjs.extend(sameafter);
dayjs.extend(samebefore);
dayjs.extend(tz);
dayjs.extend(advancedFormat);
dayjs.extend(weekOfYear);



describe('Author Criteria', function () {
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

    const testAuthor = (userProps: any = {}, activityType: string = 'submission', activityProps: any = {}) => {
        const author = new RedditUser({
            name: 'aTestUser',
            is_suspended: false,
            ...userProps,
        }, snoowrap, true);


        let activity: SnoowrapActivity;
        if (activityType === 'submission') {
            activity = new Submission({
                created: 1664220502,
                ...activityProps,
            }, snoowrap, false);
        } else {
            activity = new Comment({
                created: 1664220502,
                ...activityProps,
            }, snoowrap, false);
        }

        // @ts-ignore
        author._fetch = author;
        activity.author = author;
        return activity;
    };

    describe('Moderator accessible criteria', function () {

        // TODO isContributor
    });

    describe('Publicly accessible criteria', function () {

        it('Should match name literal', async function () {
            assert.isTrue((await resource.isAuthor(testAuthor(), {name: ['foo','test']}, true)).passed);
        });

        it('Should match name regex', async function () {
            assert.isTrue((await resource.isAuthor(testAuthor(), {name: ['/fo.*/i','/te.*/i']}, true)).passed);
        });

        for(const prop of ['flairCssClass', 'flairTemplate', 'flairText']) {
            let activityPropName = cmToSnoowrapActivityMap[prop] ?? prop;
            if(activityPropName === 'link_flair_template_id') {
                activityPropName = 'author_flair_template_id';
            }

            it(`Should detect specific ${prop} as single string`, async function () {
                assert.isTrue((await resource.isAuthor(testAuthor({}, 'submission',{
                    [activityPropName]: 'test',
                }), {[prop]: 'test'}, true)).passed);
            });
            it(`Should detect specific ${prop} from array of string`, async function () {
                assert.isTrue((await resource.isAuthor(testAuthor({}, 'submission',{
                    [activityPropName]: 'test',
                }), {[prop]: ['foo','test']}, true)).passed);
            });
            it(`Should detect specific ${prop} is not in criteria`, async function () {
                assert.isFalse((await resource.isAuthor(testAuthor({}, 'submission',{
                    [activityPropName]: 'test',
                }), {[prop]: ['foo']}, true)).passed);
            });
            it(`Should detect any ${prop}`, async function () {
                assert.isTrue((await resource.isAuthor(testAuthor({}, 'submission',{
                    [activityPropName]: 'test',
                }), {[prop]: true}, true)).passed);
            });
            it(`Should detect no ${prop}`, async function () {
                assert.isTrue((await resource.isAuthor(testAuthor({}, 'submission',{
                    [activityPropName]: null,
                }), {[prop]: false}, true)).passed);
                assert.isTrue((await resource.isAuthor(testAuthor({}, 'submission',{
                    [activityPropName]: '',
                }), {[prop]: false}, true)).passed);
                assert.isFalse((await resource.isAuthor(testAuthor({}, 'submission',{
                    [activityPropName]: '',
                }), {[prop]: 'foo'}, true)).passed);
            });
            /*it(`Should detect ${prop} as Regular Expression`, async function () {
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: 'test'
                }, snoowrap, false), {[prop]: '/te.*!/'}, NoopLogger, true)).passed);
                assert.isTrue((await resource.isItem(new Submission({
                    [activityPropName]: 'test'
                }, snoowrap, false), {[prop]: ['foo', '/t.*!/']}, NoopLogger, true)).passed);
            });*/
        }

        // TODO isMod
        // TODO shadowbanned

        it('Should detect age', async function () {
            const time = dayjs().subtract(5, 'minutes').unix();
            const agedAuthor = testAuthor({created: time})
            assert.isTrue((await resource.isAuthor(agedAuthor, {age: '> 4 minutes'}, true)).passed);
            assert.isTrue((await resource.isAuthor(agedAuthor, {age: '< 10 minutes'}, true)).passed);
        });

        it('Should match link karma', async function () {
            const author = testAuthor({link_karma: 10})
            assert.isTrue((await resource.isAuthor(author, {linkKarma: '> 4'}, true)).passed);
            assert.isTrue((await resource.isAuthor(author, {linkKarma: '< 11'}, true)).passed);
        });

        it('Should match comment karma', async function () {
            const author = testAuthor({comment_karma: 10})
            assert.isTrue((await resource.isAuthor(author, {commentKarma: '> 4'}, true)).passed);
            assert.isTrue((await resource.isAuthor(author, {commentKarma: '< 11'}, true)).passed);
        });

        it('Should match total karma', async function () {
            const author = testAuthor({total_karma: 10})
            assert.isTrue((await resource.isAuthor(author, {totalKarma: '> 4'}, true)).passed);
            assert.isTrue((await resource.isAuthor(author, {totalKarma: '< 11'}, true)).passed);
        });

        it('Should check verfied email status', async function () {
            const author = testAuthor({has_verified_mail: true})
            assert.isTrue((await resource.isAuthor(author, {verified: true}, true)).passed);
        });

        it('Should match profile description literal', async function () {
            const author = testAuthor({subreddit: new Subreddit({
                    display_name: {
                        public_description: 'this is a test'
                    }
                }, snoowrap, true)});
            assert.isTrue((await resource.isAuthor(author, {description: 'this is a test'}, true)).passed);
        });

        it('Should match profile description regex', async function () {
            const author = testAuthor({subreddit: new Subreddit({
                    display_name: {
                        public_description: 'this is a test'
                    }
                }, snoowrap, true)});
            assert.isTrue((await resource.isAuthor(author, {description: '/te.*/i'}, true)).passed);
        });

        // TODO usernotes
        // TODO modactions
    });
});

