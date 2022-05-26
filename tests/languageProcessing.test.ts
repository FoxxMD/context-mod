import {describe, it} from 'mocha';
import chai,{assert} from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
    getContentLanguage,
    getLanguageTypeFromValue,
    getStringSentiment, parseTextToNumberComparison,
    testSentiment
} from "../src/Common/LangaugeProcessing";
import {GenericComparison, RangedComparison} from "../src/Common/Infrastructure/Comparisons";

chai.use(chaiAsPromised);

const longNeutralEnglish = "This is a normal english sentence without emotion";
const longNeutralEnglish2 = 'I am neutral on the current subject';
const longNeutralEnglish3 = 'The midterms were an election that happened';
const longNegativeEnglish = "I hate when idiots drive their bad cars terribly. 😡";
const longPositiveEnglish = "We love to be happy and laugh on this wonderful, amazing day";

const shortIndistinctEnglish = "metal gear";
const shortIndistinctEnglish2 = "idk hole ref";

const shortPositiveEnglish = "haha fun";
const shortNegativeEnglish = "fuck you";
const shortSlangPositiveEnglish = "lol lmao";
const shortSlangNegativeEnglish = "get fuked";

const longIndonesian = "setiap kali scroll mesti nampak dia nie haih";
const shortIndonesian = "Saya bangga saya rasis";
const shortPolish = 'Dobry wieczór';
const longRussian = 'Чит на золото для аватарии без скачивания бесплатно';
const longItalian = 'Sembra ormai passato un secolo, visto che gli anime sono praticamente scomparsi dalla televisione.';

const shortRomanian = 'Tu știi unde sta?';
const longRomanian = 'Deci , daca aveti chef de un mic protest , va astept la aceste coordonate';

const longFrench = "J’approuve et à ce moment là ça se soigne plus malheureusement";

const longSpanish = "La segunda parece una mezcla entre una convención de fanáticos de los monster truck y un vertedero.";
const longPositiveSpanish = 'me encanta esta hermosa cancion';
const longPositiveSpanish2 = 'Increíble muy divertido gracias por compartir';

const longGerman = "bin mir auch sicher, dass zb mein 65er halb so viel wiegt wie ein kasten Bier";

const shortEmojiNegative = "France 😫 😞 :(";
const shortEmojiPositive = "France 😂 😄 😁";

describe('Language Detection', function () {

    describe('Derives language from user input', async function () {
        it('gets from valid, case-insensitive alpha2', async function () {
            const lang = await getLanguageTypeFromValue('eN');
            assert.equal(lang.alpha2, 'en');
        });
        it('gets from valid, case-insensitive alpha3', async function () {
            const lang = await getLanguageTypeFromValue('eNg');
            assert.equal(lang.alpha2, 'en');
        });
        it('gets from valid, case-insensitive language name', async function () {
            const lang = await getLanguageTypeFromValue('EnGlIsH');
            assert.equal(lang.alpha2, 'en');
        });

        it('throws on invalid value', function () {
            assert.isRejected(getLanguageTypeFromValue('pofdsfa'))
        });
    })

    describe('Recognizes the language in moderately long content well', function () {
        it('should recognize english', async function () {
            const lang = await getContentLanguage(longPositiveEnglish);
            assert.equal(lang.language.alpha2, 'en');
            assert.isFalse(lang.usedDefault);
            assert.isAtLeast(lang.bestGuess.score, 0.9);
        });
        it('should recognize french', async function () {
            const lang = await getContentLanguage(longFrench);
            assert.equal(lang.language.alpha2, 'fr');
            assert.isFalse(lang.usedDefault);
            assert.isAtLeast(lang.bestGuess.score, 0.9);
        });
        it('should recognize spanish', async function () {
            const lang = await getContentLanguage(longSpanish);
            assert.equal(lang.language.alpha2, 'es');
            assert.isFalse(lang.usedDefault);
            assert.isAtLeast(lang.bestGuess.score, 0.9);
        });
        it('should recognize german', async function () {
            const lang = await getContentLanguage(longGerman);
            assert.equal(lang.language.alpha2, 'de');
            assert.isFalse(lang.usedDefault);
            assert.isAtLeast(lang.bestGuess.score, 0.9);
        });
        it('should recognize indonesian', async function () {
            const lang = await getContentLanguage(longIndonesian);
            assert.equal(lang.language.alpha2, 'id');
            assert.isFalse(lang.usedDefault);
            assert.isAtLeast(lang.bestGuess.score, 0.9);
        });
    });

    describe('Correctly handles short content classification', function () {
        it('uses default language', async function () {

            for (const content of [shortIndistinctEnglish, shortIndistinctEnglish2, shortIndonesian]) {
                const lang = await getContentLanguage(content);
                assert.equal(lang.language.alpha2, 'en', content);
                assert.isTrue(lang.usedDefault, content);
            }
        });

        it('uses best guess when default language is not provided', async function () {

            for (const content of [shortIndistinctEnglish, shortIndistinctEnglish2, shortIndonesian]) {
                const lang = await getContentLanguage(content, {defaultLanguage: false});
                assert.isFalse(lang.usedDefault);
            }
        });
    });
});

describe('Sentiment', function() {

    describe('Is conservative when no default language is used for short content', function() {

        it('should return unusable result for short, ambiguous english content', async function() {
            for(const content of [shortIndistinctEnglish, shortIndistinctEnglish2]) {
                const res = await getStringSentiment(content, {defaultLanguage: false});
                assert.isFalse(res.usableScore);
            }
        });

        it('should return unusable result for short, non-english content', async function() {
            for(const content of [shortIndonesian, shortPolish, shortRomanian]) {
                const res = await getStringSentiment(content, {defaultLanguage: false});
                assert.isFalse(res.usableScore);
            }
        });

    });

    describe('Is conservative when language confidence is high for unsupported languages', function() {

        it('should return unusable result for long, non-english content', async function() {
            for(const content of [longIndonesian, longRussian, longItalian, longRomanian]) {
                const res = await getStringSentiment(content);
                assert.isFalse(res.usableScore, content);
            }
        });
    });

    describe('vader/wink supersedes low confidence language guess', function() {

        it('should return usable result when valid words found by vader/wink', async function() {
            for(const content of [shortPositiveEnglish,shortNegativeEnglish]) {
                const res = await getStringSentiment(content, {defaultLanguage: false});
                assert.isTrue(res.usableScore);
            }
        });

        it('should return usable result when valid slang found by vader/wink', async function() {
            for(const content of [shortSlangPositiveEnglish,shortSlangNegativeEnglish]) {
                const res = await getStringSentiment(content, {defaultLanguage: false});
                assert.isTrue(res.usableScore);
            }
        });

        it('should return usable result when valid emojis found by vader/wink', async function() {
            for(const content of [shortEmojiPositive,shortEmojiNegative]) {
                const res = await getStringSentiment(content, {defaultLanguage: false});
                assert.isTrue(res.usableScore);
            }
        });
    })

    describe('Detects correct sentiment', function() {

        describe('In English', function() {

            it('should detect positive sentiment', async function() {
                for(const content of [shortEmojiPositive,longPositiveEnglish, shortPositiveEnglish, shortSlangPositiveEnglish]) {
                    const res = await getStringSentiment(content);
                    assert.isTrue(res.usableScore);
                    assert.isAtLeast(res.scoreWeighted, 0.1);
                }
            });

            it('should detect negative sentiment', async function() {
                for(const content of [shortEmojiNegative,longNegativeEnglish, shortNegativeEnglish, shortSlangNegativeEnglish]) {
                    const res = await getStringSentiment(content);
                    assert.isTrue(res.usableScore);
                    assert.isAtMost(res.scoreWeighted, -0.1);
                }
            });

            it('should detect neutral sentiment', async function() {
                for(const content of [longNeutralEnglish, longNeutralEnglish2, longNeutralEnglish3]) {
                    const res = await getStringSentiment(content);
                    assert.isTrue(res.usableScore, content);
                    assert.isAtMost(res.scoreWeighted, 0.1, content);
                    assert.isAtLeast(res.scoreWeighted, -0.1, content);
                }
            });

            it('should detect neutral sentiment for short content when english is default language', async function() {
                for(const content of [shortIndistinctEnglish, shortIndistinctEnglish2, shortPolish]) {
                    const res = await getStringSentiment(content);
                    assert.isTrue(res.usableScore);
                    assert.isAtMost(res.scoreWeighted, 0.1, content);
                    assert.isAtLeast(res.scoreWeighted, -0.1, content);
                }
            });
        });

        describe('In Spanish', function() {
            it('should detect positive ', async function() {
                for(const content of [longPositiveSpanish, longPositiveSpanish2]) {
                    const res = await getStringSentiment(content);
                    assert.isTrue(res.usableScore, longPositiveSpanish2);
                    assert.isAtLeast(res.scoreWeighted, 0.1, longPositiveSpanish2);
                }
            });
        });
    });

    describe('Testing', function () {

        describe('Parsing user input to comparison', function() {

            it(`parses 'is neutral'`, function() {
                const res = parseTextToNumberComparison('is neutral') as RangedComparison;
                assert.deepEqual(res.range, [-0.1, 0.1]);
                assert.isFalse(res.not);
            });

            it(`parses 'is not neutral'`, function() {
                const res = parseTextToNumberComparison('is not neutral') as RangedComparison;
                assert.deepEqual(res.range, [-0.1, 0.1]);
                assert.isTrue(res.not);
            });

            it(`parses 'is positive'`, function() {
                const res = parseTextToNumberComparison('is positive') as GenericComparison;
                assert.equal(res.operator, '>=');
                assert.equal(res.value, 0.1);
            });

            it(`parses 'is very positive'`, function() {
                const res = parseTextToNumberComparison('is very positive') as GenericComparison;
                assert.equal(res.operator, '>=');
                assert.equal(res.value, 0.3);
            });

            it(`parses 'is extremely positive'`, function() {
                const res = parseTextToNumberComparison('is extremely positive') as GenericComparison;
                assert.equal(res.operator, '>=');
                assert.equal(res.value, 0.6);
            });

            it(`parses 'is negative'`, function() {
                const res = parseTextToNumberComparison('is negative') as GenericComparison;
                assert.equal(res.operator, '<=');
                assert.equal(res.value, -0.1);
            });

            it(`parses 'is very negative'`, function() {
                const res = parseTextToNumberComparison('is very negative') as GenericComparison;
                assert.equal(res.operator, '<=');
                assert.equal(res.value, -0.3);
            });

            it(`parses 'is extremely negative'`, function() {
                const res = parseTextToNumberComparison('is extremely negative') as GenericComparison;
                assert.equal(res.operator, '<=');
                assert.equal(res.value, -0.6);
            });

            it(`parses negative negations`, function() {
                const res = parseTextToNumberComparison('is not extremely negative') as GenericComparison;
                assert.equal(res.operator, '>');
                assert.equal(res.value, -0.6);
            });

            it(`parses positive negations`, function() {
                const res = parseTextToNumberComparison('is not positive') as GenericComparison;
                assert.equal(res.operator, '<');
                assert.equal(res.value, 0.1);
            });

        });

        it('should fail test if score is unusable', async function() {

            const comparison = parseTextToNumberComparison('is positive');

            for(const content of [shortIndistinctEnglish, shortIndistinctEnglish2, shortPolish, longRomanian]) {
                const sentimentResult = await getStringSentiment(content, {defaultLanguage: false});

                const testResult = testSentiment(sentimentResult, comparison);
                assert.isFalse(testResult.passes);
            }
        });

        it('should handle generic comparisons', async function() {

            const comparison = parseTextToNumberComparison('is positive');

            for(const content of [shortEmojiPositive,longPositiveEnglish, shortPositiveEnglish, shortSlangPositiveEnglish]) {
                const sentimentResult = await getStringSentiment(content, {defaultLanguage: false});

                const testResult = testSentiment(sentimentResult, comparison);
                assert.isTrue(testResult.passes);
            }
        });

        it('should handle ranged comparisons', async function() {

            const comparison = parseTextToNumberComparison('is neutral');

            for(const content of [longNeutralEnglish, longNeutralEnglish2, longNeutralEnglish3]) {
                const sentimentResult = await getStringSentiment(content, {defaultLanguage: false});

                const testResult = testSentiment(sentimentResult, comparison);
                assert.isTrue(testResult.passes);
            }
        });

        it('should handle negated ranged comparisons', async function() {

            const comparison = parseTextToNumberComparison('is not neutral');

            for(const content of [longPositiveEnglish, longPositiveSpanish, longNegativeEnglish]) {
                const sentimentResult = await getStringSentiment(content, {defaultLanguage: false});

                const testResult = testSentiment(sentimentResult, comparison);
                assert.isTrue(testResult.passes, content);
            }
        });
    });
});


