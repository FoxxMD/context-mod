import {describe, it} from 'mocha';
import {assert} from 'chai';
import {mock, spy, when, instance} from 'ts-mockito';
import Snoowrap from "snoowrap";
import {Submission, Comment} from "snoowrap/dist/objects";
import {activityIsDeleted, activityIsFiltered, activityIsRemoved} from "../src/Utils/SnoowrapUtils";
import {sampleActivity} from "./testFactory";

describe('Activity state recognition', function () {
    describe('activity is removed', function () {
        describe('when bot is a moderator', function () {
            it('submission not removed when filtered by automod', function () {

                assert.isFalse(activityIsRemoved(sampleActivity.moddable.activityFilteredByAutomod()));

            })
            it('submission is removed when not filtered by automod', function () {

                assert.isTrue(activityIsRemoved(sampleActivity.moddable.activityRemovedByMod()));

            })
            it('comment is removed', function () {

                assert.isTrue(activityIsRemoved(sampleActivity.moddable.commentRemoved()));
                assert.isTrue(activityIsRemoved(sampleActivity.moddable.commentRemovedByMod()));

            })
        })
        describe('when bot is not a moderator', function () {
            it('submission is deleted by moderator', function () {

                assert.isTrue(activityIsRemoved(sampleActivity.public.submissionRemoved()));

            })
            it('submission is deleted by user or other', function () {

                assert.isTrue(activityIsRemoved(sampleActivity.moddable.submissionDeleted()));
            })

            it('comment body is removed', function () {

                assert.isTrue(activityIsRemoved(sampleActivity.public.commentRemoved()));

            })
        })
    })

    describe('activity is filtered', function() {
        it('not filtered when user is not a moderator', function() {
            assert.isFalse(activityIsFiltered(sampleActivity.public.activityRemoved()));
        })

        it('submission is filtered', function () {

            assert.isTrue(activityIsFiltered(sampleActivity.moddable.activityFilteredByAutomod()));
        })

        it('comment is filtered', function () {

            assert.isTrue(activityIsFiltered(sampleActivity.moddable.commentFiltered()));

        })
    })

    describe('activity is deleted', function() {

        it('submission is deleted', function () {

            assert.isTrue(activityIsDeleted(sampleActivity.moddable.submissionDeleted()));
            assert.isTrue(activityIsDeleted(sampleActivity.public.submissionDeleted()));

        })

        it('comment is deleted', function () {

            assert.isTrue(activityIsDeleted(sampleActivity.moddable.commentDeleted()));

        })

    })
})
