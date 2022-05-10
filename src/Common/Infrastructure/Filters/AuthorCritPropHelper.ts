import {SafeDictionary} from "ts-essentials";
import {AuthorCriteria} from "./FilterCriteria";
import {FilterCriteriaPropertyResult} from "./FilterShapes";

export type AuthorCritPropHelper = SafeDictionary<FilterCriteriaPropertyResult<AuthorCriteria>, keyof AuthorCriteria>;
