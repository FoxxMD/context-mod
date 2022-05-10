import {FilterBehavior, JoinOperands} from "../Atomic";
import {
    ActivityState,
    AuthorCriteria,
    FilterCriteriaDefaultBehavior,
    SubredditCriteria,
    TypedActivityState,
    TypedActivityStates
} from "./FilterCriteria";

export interface NamedCriteria<T extends AuthorCriteria | TypedActivityState | SubredditCriteria | ActivityState> {
    name?: string
    criteria: T
}

export type MaybeAnonymousCriteria<T> = T | NamedCriteria<T>;
export type MaybeAnonymousOrStringCriteria<T> = MaybeAnonymousCriteria<T> | string;

export interface FilterOptionsJson<T> {

    /**
     * Will "pass" if any set of Criteria passes
     * */
    include?: MaybeAnonymousOrStringCriteria<T>[]

    /**
     * * OR => if ANY exclude condition "does not" pass then the exclude test passes
     * * AND => if ALL exclude conditions "do not" pass then the exclude test passes
     *
     * Defaults to OR
     * @default OR
     * */
    excludeCondition?: JoinOperands

    /**
     * Only runs if `include` is not present. Each Criteria is comprised of conditions that the filter (Author/Item) being checked must "not" pass. See excludeCondition for set behavior
     *
     * EX: `isMod: true, name: Automoderator` => Will pass if the Author IS NOT a mod and IS NOT named Automoderator
     * */
    exclude?: MaybeAnonymousOrStringCriteria<T>[];

}

export interface FilterOptionsConfig<T> extends FilterOptionsJson<T> {

    /**
     * Will "pass" if any set of Criteria passes
     * */
    include?: MaybeAnonymousCriteria<T>[]

    /**
     * Only runs if `include` is not present. Each Criteria is comprised of conditions that the filter (Author/Item) being checked must "not" pass. See excludeCondition for set behavior
     *
     * EX: `isMod: true, name: Automoderator` => Will pass if the Author IS NOT a mod and IS NOT named Automoderator
     * */
    exclude?: MaybeAnonymousCriteria<T>[];

}

export interface FilterOptions<T> extends FilterOptionsConfig<T> {

    include?: NamedCriteria<T>[]

    exclude?: NamedCriteria<T>[];
}

export type MinimalOrFullFilter<T> = MaybeAnonymousCriteria<T>[] | FilterOptions<T>
export type MinimalOrFullMaybeAnonymousFilter<T> = MaybeAnonymousCriteria<T>[] | FilterOptionsConfig<T>
export type MinimalOrFullFilterJson<T> = MaybeAnonymousOrStringCriteria<T>[] | FilterOptionsJson<T>
export type  StructuredFilter<T> = Omit<T, 'authorIs' | 'itemIs'> & {
    itemIs?: MinimalOrFullFilter<TypedActivityState>
    authorIs?: MinimalOrFullFilter<AuthorCriteria>
}

/**
 * If present then these Author criteria are checked before running. If criteria fails then this process is skipped.
 * @examples [{"include": [{"flairText": ["Contributor","Veteran"]}, {"isMod": true}]}]
 * */
export interface AuthorOptions extends FilterOptions<AuthorCriteria> {
}

/**
 * A list of criteria to test the state of the `Activity` against before running. If criteria fails then this process is skipped.
 *
 * * @examples [{"include": [{"over_18": true, "removed': false}]}]
 * */
export interface ItemOptions extends FilterOptions<TypedActivityState> {
}

export interface FilterCriteriaDefaults extends Omit<FilterCriteriaDefaultsJson, 'itemIs' | 'authorIs'> {
    itemIs?: MinimalOrFullFilter<TypedActivityState>
    authorIs?: MinimalOrFullFilter<AuthorCriteria>
}

export interface FilterCriteriaDefaultsJson {
    itemIs?: MinimalOrFullFilterJson<TypedActivityState>
    /**
     * Determine how itemIs defaults behave when itemIs is present on the check
     *
     * * merge => adds defaults to check's itemIs
     * * replace => check itemIs will replace defaults (no defaults used)
     * */
    itemIsBehavior?: FilterCriteriaDefaultBehavior
    /**
     * Determine how authorIs defaults behave when authorIs is present on the check
     *
     * * merge => merges defaults with check's authorIs
     * * replace => check authorIs will replace defaults (no defaults used)
     * */
    authorIs?: MinimalOrFullFilterJson<AuthorCriteria>
    authorIsBehavior?: FilterCriteriaDefaultBehavior
}

export interface FilterCriteriaPropertyResult<T> {
    property: keyof T
    found?: string | boolean | number | null | FilterResult<any>
    passed?: null | boolean
    reason?: string
    behavior: FilterBehavior
}

export interface FilterCriteriaResult<T> {
    behavior: FilterBehavior
    criteria: NamedCriteria<T>//AuthorCriteria | TypedActivityStates
    propertyResults: FilterCriteriaPropertyResult<T>[]
    passed: boolean
}

export interface FilterResult<T> {
    criteriaResults: FilterCriteriaResult<T>[]
    join: JoinOperands
    passed: boolean
}

export interface ChecksActivityState {
    itemIs?: TypedActivityStates
}
