import {Logger} from "winston";
import {createLabelledLogger} from "./util";
import {Subreddit} from "snoowrap";
import {isJsonConfig} from "./JsonConfig.guard";
import {CommentCheck} from "./Check/CommentCheck";
import {SubmissionCheck} from "./Check/SubmissionCheck";

import Ajv from 'ajv';
import * as schema from './Schema/schema.json';
import {JSONConfig} from "./JsonConfig";

const ajv = new Ajv();

export interface ConfigBuilderOptions {
    logger?: Logger,
    subreddit: Subreddit,
}

export class ConfigBuilder {
    logger: Logger;
    subreddit: Subreddit;

    constructor(options: ConfigBuilderOptions) {
        this.subreddit = options.subreddit;

        if (options.logger !== undefined) {
            this.logger = options.logger;
        } else {
            this.logger = createLabelledLogger(`Config ${this.subreddit.display_name}`, `Config ${this.subreddit.display_name}`);
        }
    }

    buildFromJson(config: object): (Array<SubmissionCheck> | Array<CommentCheck>)[] {
        const commentChecks: Array<CommentCheck> = [];
        const subChecks: Array<SubmissionCheck> = [];
        const valid = ajv.validate(schema, config);
        if(valid) {
            const validConfig = config as JSONConfig;
            for (const jCheck of validConfig.checks) {
                if (jCheck.kind === 'comment') {
                    commentChecks.push(new CommentCheck(jCheck));
                } else if (jCheck.kind === 'submission') {
                    subChecks.push(new SubmissionCheck(jCheck));
                }
            }
        } else {
            this.logger.error('Json config was not valid. Please use schema to check validity.', ajv.errors);
            this.logger.error(ajv.errors);
        }
        // if (isJsonConfig(config)) {
        //     for (const jCheck of config.checks) {
        //         if (jCheck.kind === 'comment') {
        //             commentChecks.push(new CommentCheck(jCheck));
        //         } else if (jCheck.kind === 'submission') {
        //             subChecks.push(new SubmissionCheck(jCheck));
        //         }
        //     }
        // } else {
        //     this.logger.error('Json config was not valid. Please use schema to check validity.');
        // }

        return [subChecks, commentChecks];
    }
}
