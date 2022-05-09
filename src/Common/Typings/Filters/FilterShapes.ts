import {JoinOperands} from "../Atomic";
import {ActivityState, AuthorCriteria, SubredditCriteria, TypedActivityState} from "./FilterCriteria";

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
