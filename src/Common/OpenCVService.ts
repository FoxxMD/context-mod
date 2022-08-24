import winston, {Logger} from "winston";
import { CMError } from "../Utils/Errors";
import {mergeArr} from "../util";
import * as cvTypes from '@u4/opencv4nodejs'

let cv: any;

export class OpenCVService {

    logger: Logger;

    constructor(logger?: Logger) {
        const parentLogger = logger ?? winston.loggers.get('app');
        this.logger = parentLogger.child({labels: ['OpenCV']}, mergeArr)
    }

    async cv() {
        if(cv === undefined) {
            try {
                const cvImport = await import('@u4/opencv4nodejs');
                if (cvImport === undefined) {
                    throw new CMError('Could not initialize openCV because opencv4nodejs is not installed');
                }
                cv = cvImport.default;
            } catch (e: any) {
                throw new CMError('Could not initialize openCV', {cause: e});
            }
        }
        return cv as typeof cvTypes.cv;
    }
}
