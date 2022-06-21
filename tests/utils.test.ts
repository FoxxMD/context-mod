import {describe, it} from 'mocha';
import {assert} from 'chai';
import {
    COMMENT_URL_ID,
    parseDuration,
    parseLinkIdentifier,
    parseRedditEntity, removeUndefinedKeys, SUBMISSION_URL_ID
} from "../src/util";
import dayjs from "dayjs";
import dduration, {Duration, DurationUnitType} from 'dayjs/plugin/duration.js';
import {
    parseDurationComparison,
    parseGenericValueComparison,
    parseGenericValueOrPercentComparison
} from "../src/Common/Infrastructure/Comparisons";

dayjs.extend(dduration);


describe('Non-temporal Comparison Operations', function () {
    it('should throw if no operator sign', function () {
        const shouldThrow = () => parseGenericValueComparison('just 3');
        assert.throws(shouldThrow)
    });
    it('should parse greater-than with a numeric value', function () {
        const res = parseGenericValueComparison('> 3');
        assert.equal(res.operator, '>')
        assert.equal(res.value, 3);
    });
    it('should parse greater-than-or-equal-to with a numeric value', function () {
        const res = parseGenericValueComparison('>= 3');
        assert.equal(res.operator, '>=')
        assert.equal(res.value, 3)
    })
    it('should parse less-than with a numeric value', function () {
        const res = parseGenericValueComparison('< 3');
        assert.equal(res.operator, '<')
        assert.equal(res.value, 3)
    })
    it('should parse less-than-or-equal-to with a numeric value', function () {
        const res = parseGenericValueComparison('<= 3');
        assert.equal(res.operator, '<=')
        assert.equal(res.value, 3)
    })
    it('should parse extra content', function () {
        const res = parseGenericValueComparison('<= 3 foobars');
        assert.equal(res.extra, ' foobars')

        const noExtra = parseGenericValueComparison('<= 3');
        assert.isUndefined(noExtra.extra)
    })
    it('should parse percentage', function () {
        const withPercent = parseGenericValueOrPercentComparison('<= 3%');
        assert.isTrue(withPercent.isPercent)

        const withoutPercent = parseGenericValueOrPercentComparison('<= 3');
        assert.isFalse(withoutPercent.isPercent)
    })
    it('should parse comparison with time component', function() {
        const val = parseGenericValueComparison('> 3 in 2 months');
        assert.equal(val.value, 3);
        assert.isFalse(val.isPercent);
        assert.exists(val.duration);
        assert.equal(dayjs.duration(2, 'months').milliseconds(), (val.duration as Duration).milliseconds());
    });
    it('should parse percentage comparison with time component', function() {
        const val = parseGenericValueOrPercentComparison('> 3% in 2 months');
        assert.equal(val.value, 3);
        assert.isTrue(val.isPercent);
        assert.exists(val.duration);
        assert.equal(dayjs.duration(2, 'months').milliseconds(), (val.duration as Duration).milliseconds());
    });
});

describe('Parsing Temporal Values', function () {

    describe('Temporal Comparison Operations', function () {
        it('should throw if no operator sign', function () {
            assert.throws(() => parseDurationComparison('just 3'))
        });
        it('should throw if no units', function () {
            assert.throws(() => parseDurationComparison('> 3'))
        });

        for (const unit of ['millisecond', 'milliseconds', 'second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years']) {
            it(`should accept ${unit} unit`, function () {
                assert.doesNotThrow(() => parseDurationComparison(`> 3 ${unit}`))
            });
        }
        it('should only accept units compatible with dayjs', function () {
            assert.throws(() => parseDurationComparison('> 3 gigawatts'))
        });
        it('should parse greater-than with a duration', function () {
            const res = parseDurationComparison('> 3 days');
            assert.equal(res.operator, '>')
            assert.isTrue(dayjs.isDuration(res.duration));
        });
        it('should parse greater-than-or-equal-to with a duration', function () {
            const res = parseDurationComparison('>= 3 days');
            assert.equal(res.operator, '>=')
            assert.isTrue(dayjs.isDuration(res.duration));
        })
        it('should parse less-than with a duration', function () {
            const res = parseDurationComparison('< 3 days');
            assert.equal(res.operator, '<')
            assert.isTrue(dayjs.isDuration(res.duration));
        })
        it('should parse less-than-or-equal-to with a duration', function () {
            const res = parseDurationComparison('<= 3 days');
            assert.equal(res.operator, '<=')
            assert.isTrue(dayjs.isDuration(res.duration));
        })
    })

    describe('Parsing Text', function () {
        for (const unit of ['millisecond', 'milliseconds', 'second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years']) {
            it(`should accept ${unit} unit for duration`, function () {
                assert.equal(parseDuration(`1 ${unit}`).asMilliseconds(), dayjs.duration(1, unit as DurationUnitType).asMilliseconds());
            });
        }
        it('should accept ISO8601 durations', function () {

            assert.equal(parseDuration('P23DT23H').asSeconds(), dayjs.duration({
                days: 23,
                hours: 23
            }).asSeconds());

            assert.equal(parseDuration('P3Y6M4DT12H30M5S').asSeconds(), dayjs.duration({
                years: 3,
                months: 6,
                days: 4,
                hours: 12,
                minutes: 30,
                seconds: 5
            }).asSeconds());
        });
    })

});

describe('Parsing Reddit Entity strings', function () {
    it('should recognize entity name regardless of prefix', function () {
        for(const text of ['/r/anEntity', 'r/anEntity', '/u/anEntity', 'u/anEntity']) {
            assert.equal(parseRedditEntity(text).name, 'anEntity');
        }
    })

    it('should distinguish between subreddit and user prefixes', function () {
        assert.equal(parseRedditEntity('r/mySubreddit').type, 'subreddit');
        assert.equal(parseRedditEntity('u/aUser').type, 'user');
    })

    it('should recognize user based on u_ prefix', function () {
        assert.equal(parseRedditEntity(' u_aUser ').type, 'user');
    })

    it('should handle whitespace', function () {
        assert.equal(parseRedditEntity(' /r/mySubreddit ').name, 'mySubreddit');
    })

    it('should handle dashes in the entity name', function () {
        assert.equal(parseRedditEntity(' /u/a-user ').name, 'a-user');
    })
})

describe('Config Parsing', function () {
    describe('Deep pruning of undefined keys on config objects', function () {
        it('removes undefined keys from objects', function () {
            const obj: {keyA: string, keyB: string, keyC?: string } = {
                keyA: 'foo',
                keyB: 'bar',
                keyC: undefined
            };
            assert.deepEqual({keyA: 'foo', keyB: 'bar'}, removeUndefinedKeys(obj))
        })
        it('returns undefined if object has no keys', function () {
            const obj = {
                keyA: undefined,
                keyB: undefined,
                keyC: undefined
            };
            assert.isUndefined(removeUndefinedKeys(obj))
        })
        it('ignores arrays', function () {
            const obj: { keyA?: string, keyB: string, keyC: any[] } = {
                keyA: undefined,
                keyB: 'bar',
                keyC: ['foo', 'bar']
            };
            assert.deepEqual({keyB: 'bar', keyC: ['foo', 'bar']}, removeUndefinedKeys(obj))
        })
    })
})

describe('Link Recognition', function () {
    describe('Parsing Reddit Permalinks', function () {

        const commentReg = parseLinkIdentifier([COMMENT_URL_ID]);
        const submissionReg = parseLinkIdentifier([SUBMISSION_URL_ID]);

        it('should recognize the comment id from a comment permalink', function () {
            assert.equal(commentReg('https://www.reddit.com/r/pics/comments/92dd8/comment/c0b6xx0'), 'c0b6xx0');
        })
        it('should recognize the submission id from a comment permalink', function () {
            assert.equal(submissionReg('https://www.reddit.com/r/pics/comments/92dd8/comment/c0b6xx0'), '92dd8');
        })
        it('should recognize the submission id from a submission permalink', function () {
            assert.equal(submissionReg('https://www.reddit.com/r/pics/comments/92dd8/test_post_please_ignore/'), '92dd8');
        })

        // it('should recognize submission id from reddit shortlink')
        // https://redd.it/92dd8
    })
})
