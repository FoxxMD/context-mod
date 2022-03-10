import {describe, it} from 'mocha';
import {assert} from 'chai';
import {mock, spy, when, instance} from 'ts-mockito';
import Snoowrap from "snoowrap";
import {Submission, Comment} from "snoowrap/dist/objects";
import {activityIsDeleted, activityIsFiltered, activityIsRemoved} from "../src/Utils/SnoowrapUtils";

const mockSnoowrap = new Snoowrap({userAgent: 'test', accessToken: 'test'});

describe('Activity state recognition', function () {
    describe('activity is removed', function () {
        describe('when bot is a moderator', function () {
            it('submission not removed when filtered by automod', function () {

                assert.isFalse(activityIsRemoved(new Submission({
                    can_mod_post: true,
                    banned_at_utc: 12345,
                    removed_by_category: 'automod_filtered'
                }, mockSnoowrap, true)));

            })
            it('submission is removed when not filtered by automod', function () {

                assert.isTrue(activityIsRemoved(new Submission({
                    can_mod_post: true,
                    banned_at_utc: 12345,
                    removed_by_category: 'mod'
                }, mockSnoowrap, true)));

            })
            it('comment is removed', function () {

                assert.isTrue(activityIsRemoved(new Comment({
                    can_mod_post: true,
                    banned_at_utc: 12345,
                    removed: true,
                    replies: ''
                }, mockSnoowrap, true)));

            })
        })
        describe('when bot is not a moderator', function () {
            it('submission is deleted by moderator', function () {

                assert.isTrue(activityIsRemoved(new Submission({
                    can_mod_post: false,
                    removed_by_category: 'moderator'
                }, mockSnoowrap, true)));

            })
            it('submission is deleted by user or other', function () {

                assert.isTrue(activityIsRemoved(new Submission({
                    can_mod_post: false,
                    removed_by_category: 'deleted'
                }, mockSnoowrap, true)));

            })

            it('comment body is removed', function () {

                assert.isTrue(activityIsRemoved(new Comment({
                    can_mod_post: false,
                    body: '[removed]',
                    replies: ''
                }, mockSnoowrap, true)));

            })
        })
    })

    describe('activity is filtered', function() {
        it('not filtered when user is not a moderator', function() {
            assert.isFalse(activityIsFiltered(new Submission({
                can_mod_post: false,
                banned_at_utc: 12345,
                removed_by_category: 'mod'
            }, mockSnoowrap, true)));
        })

        it('submission is filtered', function () {

            assert.isTrue(activityIsFiltered(new Submission({
                can_mod_post: true,
                banned_at_utc: 12345,
                removed_by_category: 'automod_filtered'
            }, mockSnoowrap, true)));

        })

        it('comment is filtered', function () {

            assert.isTrue(activityIsFiltered(new Comment({
                can_mod_post: true,
                banned_at_utc: 12345,
                removed: false,
                replies: ''
            }, mockSnoowrap, true)));

        })
    })

    describe('activity is deleted', function() {

        it('submission is deleted', function () {

            assert.isTrue(activityIsDeleted(new Submission({
                can_mod_post: true,
                banned_at_utc: 12345,
                removed_by_category: 'deleted'
            }, mockSnoowrap, true)));

        })

        it('comment is deleted', function () {

            assert.isTrue(activityIsDeleted(new Comment({
                can_mod_post: true,
                banned_at_utc: 12345,
                removed: false,
                replies: '',
                author: {
                    name: '[deleted]'
                }
            }, mockSnoowrap, true)));

        })

    })
})
