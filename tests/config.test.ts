import {describe, it} from 'mocha';
import {assert} from 'chai';
import {insertNameFilters} from "../src/ConfigBuilder";
import {
    authorAgeDayCrit, authorAgeMonthCrit,
    authorFlair1Crit,
    fullAuthorAnonymousAll,
    fullAuthorAnonymousExclude,
    fullAuthorAnonymousInclude,
    fullAuthorFullExclude,
    fullAuthorFullInclude,
    fullItemAnonymousAll,
    fullItemAnonymousExclude,
    fullItemAnonymousInclude,
    fullItemFullAll,
    fullItemFullExclude,
    fullItemFullInclude,
    itemApprovedCrit,
    itemRemovedCrit,
    maybeAnonymousFullAuthorFilter,
    minimalAuthorFilter,
    namedAuthorFilter,
    namedAuthorFilters,
    namedItemFilter,
    namedItemFilters
} from "./testFactory";
import {buildFilter, mergeFilters} from "../src/util";
import {FilterOptions, FilterOptionsConfig, NamedCriteria} from "../src/Common/Infrastructure/Filters/FilterShapes";
import {AuthorCriteria} from "../src";
import {filterCriteriaDefault} from "../src/Common/defaults";

const namedFilters = insertNameFilters(namedAuthorFilters, namedItemFilters);

describe('Filter Building', function () {

    describe('Convert string or plain objects/arrays to AT LEAST filters with anonymous criteria', function () {

        describe('Author Filter', function () {

            describe('Anonymous Filters', function () {

                it('Accepts plain object', function () {
                    const filters = namedFilters({authorIs: authorAgeDayCrit()})
                    assert.deepEqual(filters.authorIs, [{criteria: authorAgeDayCrit()}]);
                });

                it('Accepts plain array of objects', function () {
                    const filters = namedFilters({authorIs: [authorAgeDayCrit(), authorFlair1Crit()]})
                    assert.deepEqual(filters.authorIs, [{criteria: authorAgeDayCrit()}, {criteria: authorFlair1Crit()}]);
                });

                it('Accepts full anonymous include config and returns full anonymous include config', function () {
                    const authFull = namedFilters({authorIs: fullAuthorAnonymousInclude()})
                    assert.deepEqual(authFull.authorIs, fullAuthorFullInclude());
                });

                it('Accepts full anonymous exclude config and returns full anonymous exclude config', function () {
                    const authFull = namedFilters({authorIs: fullAuthorAnonymousExclude()})
                    assert.deepEqual(authFull.authorIs, fullAuthorFullExclude());
                });

                it('Accepts full anonymous include-exclude config and returns full anonymous include with no exclude', function () {
                    const authFull = namedFilters({authorIs: fullAuthorAnonymousAll()})
                    assert.deepEqual(authFull.authorIs, fullAuthorFullInclude());
                });

            });

            describe('Named Filters', function () {
                it('Inserts named filter from plain array', function () {
                    const filters = namedFilters({authorIs: ['test1Author', authorFlair1Crit()]})
                    assert.deepEqual(filters.authorIs, [namedAuthorFilter(), {criteria: authorFlair1Crit()}]);
                });
            });
        });

        describe('Item Filter', function () {

            describe('Anonymous Filters', function () {

                it('Accepts plain object', function () {
                    const filters = namedFilters({itemIs: itemRemovedCrit()})
                    assert.deepEqual(filters.itemIs, [{criteria: itemRemovedCrit()}]);
                });

                it('Accepts plain array of objects', function () {
                    const filters = namedFilters({itemIs: [itemRemovedCrit(), itemApprovedCrit()]})
                    assert.deepEqual(filters.itemIs, [{criteria: itemRemovedCrit()}, {criteria: itemApprovedCrit()}]);
                });

                it('Accepts full anonymous include config and returns full anonymous include config', function () {
                    const fullFilter = namedFilters({itemIs: fullItemAnonymousInclude()})
                    assert.deepEqual(fullFilter.itemIs, fullItemFullInclude());
                });

                it('Accepts full anonymous exclude config and returns full anonymous exclude config', function () {
                    const fullFilter = namedFilters({itemIs: fullItemAnonymousExclude()})
                    assert.deepEqual(fullFilter.itemIs, fullItemFullExclude());
                });

                it('Accepts full anonymous include-exclude config and returns full anonymous include with no exclude', function () {
                    const fullFilter = namedFilters({itemIs: fullItemAnonymousAll()})
                    assert.deepEqual(fullFilter.itemIs, fullItemFullAll());
                });

            });

            describe('Named Filters', function () {
                it('Inserts named filter from plain array', function () {
                    const filters = namedFilters({itemIs: ['test1Item', itemApprovedCrit()]})
                    assert.deepEqual(filters.itemIs, [namedItemFilter(), {criteria: itemApprovedCrit()}]);
                });
            });
        });

        describe('Full Filter', function () {
            it('Accepts and returns full filter', function () {
                const filters = namedFilters({
                    itemIs: ['test1Item', itemApprovedCrit()],
                    authorIs: ['test1Author', authorFlair1Crit()]
                })
                assert.deepEqual(filters.itemIs, [namedItemFilter(), {criteria: itemApprovedCrit()}]);
                assert.deepEqual(filters.authorIs, [namedAuthorFilter(), {criteria: authorFlair1Crit()}]);
            });
        });
    });

    describe('Convert hydrated/anonymous criteria to full FilterOptions', function () {
        describe('Author Filter', function () {
            it('Converts minimal (array) filter into include', function () {
                const opts = buildFilter(minimalAuthorFilter());
                assert.deepEqual(opts, {
                    include: (minimalAuthorFilter() as NamedCriteria<AuthorCriteria>[]).map((x) => ({
                        ...x,
                        name: undefined
                    })),
                    excludeCondition: 'OR',
                    exclude: []
                });
            });
            it('Converts anonymous full filter into FilterOptions', function () {
                const opts = buildFilter(maybeAnonymousFullAuthorFilter());
                assert.deepEqual(opts, {
                    include: [
                        {
                            criteria: authorAgeDayCrit()
                        },
                        {
                            criteria: authorAgeMonthCrit()
                        }
                    ].map((x) => ({...x, name: undefined})),
                    excludeCondition: undefined,
                    exclude: [
                        {
                            criteria: authorAgeDayCrit()
                        },
                        {
                            criteria: authorAgeMonthCrit()
                        }
                    ].map((x) => ({...x, name: undefined}))
                })
            });
        });
    });

    describe('Filter merging', function () {
        it('Merges (adds) when user-defined filter and defaults filter are present', function () {
            const [author] = mergeFilters({
                authorIs: {
                    exclude: [
                        {
                            criteria: {age: '> 1 hour'}
                        }]
                }
            }, filterCriteriaDefault);
            assert.deepEqual(author.exclude, [
                {
                    criteria: {age: '> 1 hour'},
                    name: undefined
                }, {
                    criteria: {isMod: true},
                    name: undefined
                }]);
        });
        it('Does not merge when user-defined filter and defaults filter are present with conflicting properties', function () {
            const [author] = mergeFilters({
                authorIs: {
                    exclude: [{
                        criteria: {
                            age: '> 1 hour',
                            isMod: true
                        }
                    }]
                }
            }, filterCriteriaDefault);
            assert.deepEqual(author.exclude, [{criteria: {age: '> 1 hour', isMod: true}, name: undefined}]);
        });
        it('User-defined filter replaces defaults filter when replace behavior is set', function () {
            const [author] = mergeFilters({
                authorIs: {
                    exclude: [
                        {
                            criteria: {age: '> 1 hour'}
                        }
                    ]
                }
            }, {
                authorIsBehavior: 'replace',
                authorIs: {
                    exclude: [
                        {
                            criteria: {name: ['test']}
                        }]
                }
            });
            assert.deepEqual(author.exclude, [{criteria: {age: '> 1 hour'}, name: undefined}]);
        });
        it('Ignores mods by default', function () {
            const [author] = mergeFilters({}, filterCriteriaDefault);
            assert.deepEqual(author.exclude, [
                {
                    criteria: {isMod: true},
                    name: undefined
                }]);
        });

    });
});
