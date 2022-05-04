import {RateLimitError, RequestError, StatusCodeError} from 'snoowrap/dist/errors';
import ExtendableError from "es6-error";
import {ErrorWithCause} from "pony-cause";
import {CheckSummary, RunResult} from "../Common/interfaces";
import {CheckResultEntity} from "../Common/Entities/CheckResultEntity";
import {RunResultEntity} from "../Common/Entities/RunResultEntity";
import {ActionResultEntity} from "../Common/Entities/ActionResultEntity";


export interface ISeriousError {
    isSerious: boolean;
}

export const isRateLimitError = (err: any): err is RateLimitError => {
    return isRequestError(err) && err.name === 'RateLimitError';
}

export const isScopeError = (err: any): boolean => {
    if(isStatusError(err)) {
        const authHeader = err.response.headers['www-authenticate'];
        return authHeader !== undefined && authHeader.includes('insufficient_scope');
    }
    return false;
}

export const getScopeError = (err: any): string | undefined => {
    if(isScopeError(err)) {
        return err.response.headers['www-authenticate'];
    }
    return undefined;
}

export const isStatusError = (err: any): err is StatusCodeError => {
    return isRequestError(err) && err.name === 'StatusCodeError';
}

export const isRequestError = (err: any): err is RequestError => {
    return typeof err === 'object' && err.response !== undefined && err.response !== null && typeof err.response === 'object';
}

export class SimpleError extends ExtendableError implements ISeriousError {
    code?: string | number;
    isSerious: boolean = true;

    constructor(message: string, options: {code?: string | number, isSerious?: boolean} = {}) {
        super(message);
        const {code, isSerious = true} = options;
        this.code = code;
        this.isSerious = isSerious;
    }
}

export class MaybeSeriousErrorWithCause extends ErrorWithCause<Error | undefined> implements ISeriousError {
    isSerious: boolean = true;

    constructor(message: string, options: {cause?: Error | undefined, isSerious?: boolean} = {}) {
        super(message, {cause: options.cause});
        const {isSerious = true} = options;
        this.isSerious = isSerious;
    }
}

export const definesSeriousError = (val: any): val is ISeriousError => {
    return 'isSerious' in val;
}

/**
 * Determine if the error, or any error in the stack, has serious error interface defined and return isSerious value
 * */
export const isSeriousError = (val: any): boolean => {
    // check top level first
    if(definesSeriousError(val)) {
        return val.isSerious;
    }

    // if there is a cause then recursively check the stack
    if(val instanceof ErrorWithCause && val.cause !== undefined) {
        return isSeriousError(val.cause);
    }

    // default to true since there is no isSerious explicitly defined
    return true;
}

export class CMError extends ErrorWithCause<Error | undefined> {
    isSerious: boolean;
    logged: boolean;

    constructor(message: string, options: {cause?: Error | undefined, isSerious?: boolean, logged?: boolean} = {}) {
        super(message, {cause: options.cause});
        const {isSerious = true, logged = false} = options;
        this.isSerious = isSerious;
        this.logged = logged;
    }
}

export class ProcessingError<T> extends ErrorWithCause<Error> {
    constructor(msg: string, cause?: any, result?: T) {
        super(msg, cause);
        this.result = result;
    }
    result?: T
}

export class RunProcessingError extends ProcessingError<RunResultEntity> {
}

export class CheckProcessingError extends ProcessingError<CheckResultEntity> {
}

export class ActionProcessingError extends ProcessingError<ActionResultEntity[]> {
}
