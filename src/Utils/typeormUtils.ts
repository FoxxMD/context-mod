import {SelectQueryBuilder} from "typeorm";

export const filterResultsBuilder = <T>(builder: SelectQueryBuilder<T>, rootEntity: string, aliasPrefix: string) => {
    return builder
        .leftJoinAndSelect(`${rootEntity}._authorIs`, `${aliasPrefix}AuthorIs`)
        .leftJoinAndSelect(`${rootEntity}._itemIs`, `${aliasPrefix}ItemIs`)

        .leftJoinAndSelect(`${aliasPrefix}AuthorIs.criteriaResults`, `${aliasPrefix}AuthorCritResults`)
        .leftJoinAndSelect(`${aliasPrefix}ItemIs.criteriaResults`, `${aliasPrefix}ItemCritResults`)

        .leftJoinAndSelect(`${aliasPrefix}AuthorCritResults.criteria`, `${aliasPrefix}AuthorCriteria`)
        .leftJoinAndSelect(`${aliasPrefix}ItemCritResults.criteria`, `${aliasPrefix}ItemCriteria`)
}
