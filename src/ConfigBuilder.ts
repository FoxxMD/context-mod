import {Logger} from "winston";
import {createLabelledLogger, loggerMetaShuffle, mergeArr} from "./util";
import {CommentCheck} from "./Check/CommentCheck";
import {SubmissionCheck} from "./Check/SubmissionCheck";

import Ajv from 'ajv';
import * as schema from './Schema/App.json';
import {JSONConfig} from "./JsonConfig";
import LoggedError from "./Utils/LoggedError";
import {ManagerOptions} from "./Subreddit/Manager";

const ajv = new Ajv();

export interface ConfigBuilderOptions {
    logger?: Logger,
}

export class ConfigBuilder {
    logger: Logger;

    constructor(options: ConfigBuilderOptions) {

        if (options.logger !== undefined) {
            this.logger = options.logger.child(loggerMetaShuffle(options.logger, 'Config'), mergeArr);
        } else {
            this.logger = createLabelledLogger(`Config`, `Config`);
        }
    }

    buildFromJson(config: object): [Array<SubmissionCheck>,Array<CommentCheck>,ManagerOptions] {
        const commentChecks: Array<CommentCheck> = [];
        const subChecks: Array<SubmissionCheck> = [];
        const valid = ajv.validate(schema, config);
        let managerOptions: ManagerOptions = {};
        if(valid) {
            const validConfig = config as JSONConfig;
            const {checks = [], ...rest} = validConfig;
            managerOptions = rest;
            for (const jCheck of checks) {
                if (jCheck.kind === 'comment') {
                    commentChecks.push(new CommentCheck({...jCheck, logger: this.logger}));
                } else if (jCheck.kind === 'submission') {
                    subChecks.push(new SubmissionCheck({...jCheck, logger: this.logger}));
                }
            }
        } else {
            this.logger.error('Json config was not valid. Please use schema to check validity.', ajv.errors);
            this.logger.error(ajv.errors);
            throw new LoggedError();
        }

        return [subChecks, commentChecks, managerOptions];
    }
}
