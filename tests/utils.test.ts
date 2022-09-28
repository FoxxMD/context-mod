import {describe, it} from 'mocha';
import {assert} from 'chai';
import {
    COMMENT_URL_ID,
    GH_BLOB_REGEX,
    GIST_RAW_REGEX,
    GIST_REGEX,
    parseDurationFromString,
    parseLinkIdentifier,
    parseRedditEntity,
    parseRegexSingleOrFail,
    REGEXR_REGEX,
    removeUndefinedKeys,
    strToActivitySourceData,
    SUBMISSION_URL_ID
} from "../src/util";
import dayjs from "dayjs";
import dduration, {Duration, DurationUnitType} from 'dayjs/plugin/duration.js';
import {
    parseDurationComparison,
    parseGenericValueComparison,
    parseGenericValueOrPercentComparison, parseReportComparison
} from "../src/Common/Infrastructure/Comparisons";
import {RegExResult} from "../src/Common/interfaces";
import {SOURCE_DISPATCH, SOURCE_POLL, SOURCE_USER} from "../src/Common/Infrastructure/Atomic";

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
    it('should throw if more than one time component found', function () {
        assert.throws(() => parseDurationComparison('> 3 in 2 days and 4 months'));
    });
});

describe('Parsing Temporal Values', function () {

    describe('Parsing Text', function () {
        for (const unit of ['millisecond', 'milliseconds', 'second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days', 'week', 'weeks', 'month', 'months', 'year', 'years']) {
            it(`should accept ${unit} unit for duration`, function () {
                const result = parseDurationFromString(`1 ${unit}`)[0];
                assert.equal(result.original, `1 ${unit}`);
                assert.equal(result.duration.asMilliseconds(), dayjs.duration(1, unit as DurationUnitType).asMilliseconds());
            });
        }
        it('should accept ISO8601 durations', function () {

            const shortResult = parseDurationFromString('P23DT23H')[0];
            assert.equal(shortResult.original, 'P23DT23H');
            assert.equal(shortResult.duration.asSeconds(), dayjs.duration({
                days: 23,
                hours: 23
            }).asSeconds());

            const longResult = parseDurationFromString('P3Y6M4DT12H30M5S')[0];

            assert.equal(longResult.original, 'P3Y6M4DT12H30M5S');
            assert.equal(longResult.duration.asSeconds(), dayjs.duration({
                years: 3,
                months: 6,
                days: 4,
                hours: 12,
                minutes: 30,
                seconds: 5
            }).asSeconds());
        });

        it('should parse durations from anywhere in a string', function() {
           const example1 = `> 2 user "misinfo" in 2 hours`;
           const ex1Result = parseDurationFromString(example1, false)[0];
           assert.equal(ex1Result.original, '2 hours');
           assert.equal(ex1Result.duration.asMilliseconds(), dayjs.duration(2, 'hours').asMilliseconds());

           const example2 = `Test example 4 minutes ago`;
            const ex2Result = parseDurationFromString(example2, false)[0];
            assert.equal(ex2Result.original, '4 minutes');
            assert.equal(ex2Result.duration.asMilliseconds(), dayjs.duration(4, 'minutes').asMilliseconds());

           const example3 = `Test 3 hours will be`;
            const ex3Result = parseDurationFromString(example3, false)[0];
            assert.equal(ex3Result.original, '3 hours');
            assert.equal(ex3Result.duration.asMilliseconds(), dayjs.duration(3, 'hours').asMilliseconds());

           const example4 = `> 2 user "misinfo" in P23DT23H with extra`;
            const ex4Result = parseDurationFromString(example4, false)[0];
            assert.equal(ex4Result.original, 'P23DT23H');
            assert.equal(ex4Result.duration.asMilliseconds(), dayjs.duration({
                days: 23,
                hours: 23
            }).asMilliseconds());
        });
    })

    describe('Temporal Comparison Operations', function () {

        it('should throw if no units', function () {
            assert.throws(() => parseDurationComparison('> 3'))
        });

        it('should only accept units compatible with dayjs', function () {
            assert.throws(() => parseDurationComparison('> 3 gigawatts'))
        });

        it('should throw if value is a percentage', function () {
            assert.throws(() => parseDurationComparison('> 3% months'))
        });

        it('should throw if value is negative', function () {
            assert.throws(() => parseDurationComparison('> -3 months'))
        });

        it('should throw if more than one duration value found', function () {
            assert.throws(() => parseDurationComparison('> 3 months in 2 days'))
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

});

describe('Report Comparison Operations', function () {

    it(`should accept report type as optional`, function () {
        const result = parseReportComparison(`> 0`)
        assert.isUndefined(result.reportType);
    });

    it(`should accept 'user' report type`, function () {
        for(const type of ['user','users']) {
            const result = parseReportComparison(`> 0 ${type}`)
            assert.equal(result.reportType, 'user');
        }
    });

    it(`should accept 'mod' report type`, function () {
        for(const type of ['mod','mods']) {
            const result = parseReportComparison(`> 0 ${type}`)
            assert.equal(result.reportType, 'mod');
        }
    });

    it(`should accept report reason literals in single or double quotes`, function () {
        for(const reasonStr of [`'misinfo'`, `"misinfo"`]) {
            const result = parseReportComparison(`> 0 ${reasonStr}`)
            assert.equal(result.reasonMatch, reasonStr);
            assert.equal((result.reasonRegex as RegExp).toString(), new RegExp(/.*misinfo.*/, 'i').toString());
        }
    });

    it(`should accept report reason as regex`, function () {
        const result = parseReportComparison(`> 0 /misinfo/`)
        assert.equal(result.reasonMatch, '/misinfo/');
        assert.equal((result.reasonRegex as RegExp).toString(), new RegExp(/misinfo/, 'i').toString());
    });

    it(`should accept a time constraint`, function () {
        const result = parseReportComparison(`> 1 in 2 hours`)
        assert.equal(result.durationText, '2 hours');
        assert.equal((result.duration as Duration).asMilliseconds(), dayjs.duration(2, 'hours').asMilliseconds())
    });

    it(`should accept all components`, function () {
        const result = parseReportComparison(`> 1 user 'misinfo' in 2 hours`)
        assert.equal(result.reasonMatch, `'misinfo'`);
        assert.equal((result.reasonRegex as RegExp).toString(), new RegExp(/.*misinfo.*/, 'i').toString());
        assert.equal(result.durationText, '2 hours');
        assert.equal((result.duration as Duration).asMilliseconds(), dayjs.duration(2, 'hours').asMilliseconds())
    });
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
    });

    describe('External URL Parsing', function() {

        it('should recognize and parse raw gist URLs', function() {
            const res = parseRegexSingleOrFail(GIST_RAW_REGEX, 'https://gist.github.com/FoxxMD/2b035429fbf326a00d9a6ca2a38011d9/raw/97076d52114eb17a8754384d95087e8a0a74cf88/file-with-symbols.test.yaml');
            assert.exists(res);
            const rese = res as RegExResult;
            assert.equal(rese.named.user, 'FoxxMD');
            assert.equal(rese.named.gistId, '2b035429fbf326a00d9a6ca2a38011d9');
        });

        it('should not parse non-raw gist URLs with raw regex', function() {
            for(const url of [
                'https://gist.github.com/FoxxMD/2b035429fbf326a00d9a6ca2a38011d9',
                'https://gist.github.com/FoxxMD/2b035429fbf326a00d9a6ca2a38011d9#file-file-with-symbols-test-yaml'
            ]) {
                const res = parseRegexSingleOrFail(GIST_RAW_REGEX, url);
                assert.notExists(res, `Should not have parsed ${url} as RAW gist`);
            }
        });

        it('should recognize and parse gist URLs', function() {
            const res = parseRegexSingleOrFail(GIST_REGEX, 'https://gist.github.com/FoxxMD/2b035429fbf326a00d9a6ca2a38011d9');
            assert.exists(res);
            const rese = res as RegExResult;
            assert.equal(rese.named.user, 'FoxxMD');
            assert.equal(rese.named.gistId, '2b035429fbf326a00d9a6ca2a38011d9');
        });

        it('should recognize and parse gist URLs with filename hashes', function() {
            const res = parseRegexSingleOrFail(GIST_REGEX, 'https://gist.github.com/FoxxMD/2b035429fbf326a00d9a6ca2a38011d9#file-file-with-symbols-test-yaml');
            assert.exists(res);
            const rese = res as RegExResult;
            assert.equal(rese.named.user, 'FoxxMD');
            assert.equal(rese.named.gistId, '2b035429fbf326a00d9a6ca2a38011d9');
            assert.equal(rese.named.fileName, 'file-with-symbols-test-yaml');
        });

        it('should recognize and parse github blob URLs', function() {
            const res = parseRegexSingleOrFail(GH_BLOB_REGEX, 'https://github.com/FoxxMD/context-mod/blob/master/src/util.ts');
            assert.exists(res);
            const rese = res as RegExResult;
            assert.equal(rese.named.user, 'FoxxMD');
            assert.equal(rese.named.repo, 'context-mod');
            assert.equal(rese.named.path, 'master/src/util.ts');
        });

        it('should recognize regexr URLs', function() {
            const res = parseRegexSingleOrFail(REGEXR_REGEX, 'https://regexr.com/6pomb');
            assert.exists(res);
        });
    })
})

describe('Activity Source Parsing', function () {
    it('should parse all activity types', function () {
        for (const type of [SOURCE_DISPATCH, SOURCE_POLL, SOURCE_USER]) {
            const source = strToActivitySourceData(type);
            assert.equal(source.type, type);
        }
    });
    it('should throw if invalid activity source type', function () {
        assert.throws(() => strToActivitySourceData('jflksdf'));
    });
    it('should parse identifier from activity source', function () {
        const source = strToActivitySourceData('dispatch:test');
        assert.equal(source.identifier, 'test');
    });
})
