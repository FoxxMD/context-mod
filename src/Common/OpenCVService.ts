import winston, {Logger} from "winston";
import {CMError} from "../Utils/Errors";
import {formatNumber, mergeArr, resolvePath} from "../util";
import * as cvTypes from '@u4/opencv4nodejs'
import ImageData from "./ImageData";
import {pathToFileURL} from "url";

let cv: any;

export const getCV = async (): Promise<typeof cvTypes.cv> => {
    if (cv === undefined) {
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

export class OpenCVService {

    logger: Logger;

    constructor(logger?: Logger) {
        const parentLogger = logger ?? winston.loggers.get('app');
        this.logger = parentLogger.child({labels: ['OpenCV']}, mergeArr)
    }

    async cv() {
        if (cv === undefined) {
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

interface CurrentMaxData {
    confidence: number,
    loc: cvTypes.Point2,
    ratio?: number
}

export interface MatchResult {matchRec?: cvTypes.Rect, matchedConfidence?: number}


/**
 * Use openCV matchTemplate() to find images within images
 *
 * The majority of these code concepts are based on https://pyimagesearch.com/2015/01/26/multi-scale-template-matching-using-python-opencv/
 * and examples/usage of opencv.js is from https://github.com/UrielCh/opencv4nodejs/tree/master/examples/src/templateMatch
 *
 * */
export class TemplateCompare {
    cv: typeof cvTypes.cv;
    logger: Logger;

    template?: cvTypes.Mat;
    downscaledTemplates: cvTypes.Mat[] = [];

    constructor(cv: typeof cvTypes.cv, logger: Logger) {
        this.cv = cv;
        this.logger = logger.child({labels: ['OpenCV', 'Template Match']}, mergeArr)
    }

    protected async normalizeImage(image: ImageData) {
        return this.cv.imdecode(await ((await image.sharp()).clone().greyscale().toBuffer()));
    }

    async setTemplate(image: ImageData) {
        this.template = await this.normalizeImage(image);
    }

    protected getTemplate() {
        if (this.template === undefined) {
            throw new Error('Template is not defined, use setTemplate() first');
        }
        return this.template.copy().canny(50, 200);
    }

    downscaleTemplates() {
        if (this.template === undefined) {
            throw new Error('Template is not defined, use setTemplate() first');
        }

        const [tH, tW] = this.template.sizes;

        for (let i = 10; i <= 80; i += 10) {
            const templateRatio = (100 - i) / 100;

            // for debugging
            // const scaled = this.template.copy().resize(new cv.Size(Math.floor(templateRatio * tW), Math.floor(templateRatio * tH))).canny(50, 200);
            // const path = pathToFileURL(resolvePath(`./tests/assets/star/starTemplateScaled-${Math.floor(templateRatio * 100)}.jpg`, './')).pathname;
            // cv.imwrite(path, scaled);
            this.downscaledTemplates.push(this.template.copy().resize(new cv.Size(Math.floor(templateRatio * tW), Math.floor(templateRatio * tH))).canny(50, 200))
        }
    }

    async matchImage(sourceImageData: ImageData, downscaleWhich: 'template' | 'image', confidence = 0.5): Promise<[boolean, MatchResult]> {
        if (this.template === undefined) {
            throw new Error('Template is not defined, use setTemplate() first');
        }

        let currMax: CurrentMaxData | undefined;

        let matchRec: cvTypes.Rect | undefined;
        let matchedConfidence: number | undefined;

        if (downscaleWhich === 'template') {
            // in this scenario we assume our template is a significant fraction of the size of the source
            // so we want to scale down the template size incrementally
            // because we are assuming the template in the image is smaller than our source template

            // generate scaled templates and save for later use!
            // its likely this class is in use in Recent/Repeat rules which means we will probably be comparing this template against many images
            if (this.downscaledTemplates.length === 0) {
                this.downscaleTemplates();
            }

            let currMaxTemplateSize: number[] | undefined;

            const src = (await this.normalizeImage(sourceImageData)).canny(50, 200);

            const edgedTemplate = await this.getTemplate();

            for (const scaledTemplate of [edgedTemplate].concat(this.downscaledTemplates)) {

                // more information on methods...
                // https://docs.opencv.org/4.x/d4/dc6/tutorial_py_template_matching.html
                // https://stackoverflow.com/questions/58158129/understanding-and-evaluating-template-matching-methods
                // https://stackoverflow.com/questions/48799711/explain-difference-between-opencvs-template-matching-methods-in-non-mathematica
                // https://datahacker.rs/014-template-matching-using-opencv-in-python/
                // ...may want to try with TM_SQDIFF but will need to use minimum values instead of max
                const result = src.matchTemplate(scaledTemplate, cv.TM_CCOEFF_NORMED);

                const minMax = result.minMaxLoc();
                const {maxVal, maxLoc} = minMax;

                if (currMax === undefined || maxVal > currMax.confidence) {
                    currMaxTemplateSize = scaledTemplate.sizes;
                    currMax = {confidence: maxVal, loc: maxLoc};
                    console.log(`New Best Max Confidence: ${formatNumber(maxVal, {toFixed: 4})}`)
                }
                if (maxVal >= confidence) {
                    this.logger.verbose(`Match with confidence ${formatNumber(maxVal, {toFixed: 4})} met threshold of ${confidence}`);
                    break;
                }
            }

            if (currMax !== undefined) {
                matchedConfidence = currMax.confidence;

                if (currMaxTemplateSize !== undefined) {
                    const startX = currMax.loc.x;
                    const startY = currMax.loc.y;

                    matchRec = new cv.Rect(startX, startY, currMaxTemplateSize[1], currMaxTemplateSize[0]);
                }
            }


        } else {
            // in this scenario we assume our template is small, compared to the source image
            // and the template found in the source is likely larger than the template
            // so we scale down the source incrementally to try to get them to match

            const normalSrc = (await this.normalizeImage(sourceImageData));
            let src = normalSrc.copy();
            const [width, height] = src.sizes;

            const edgedTemplate = await this.getTemplate();
            const [tH, tW] = edgedTemplate.sizes;

            let ratio = 1;

            for (let i = 0; i <= 80; i += 5) {
                ratio = (100 - i) / 100;

                if (i !== 100) {
                    const resizedWidth = Math.floor(width * ratio);
                    const resizedHeight = Math.floor(height * ratio);
                    src = src.resize(new cv.Size(resizedWidth, resizedHeight));
                }

                const [sH, sW] = src.sizes;
                if (sH < tH || sW < tW) {
                    // scaled source is smaller than template
                    this.logger.debug(`Template matching ended early due to downscaled image being smaller than template`);
                    break;
                }

                const edged = src.canny(50, 200);
                const result = edged.matchTemplate(edgedTemplate, cv.TM_CCOEFF_NORMED);

                const minMax = result.minMaxLoc();
                const {maxVal, maxLoc} = minMax;

                if (currMax === undefined || maxVal > currMax.confidence) {
                    currMax = {confidence: maxVal, loc: maxLoc, ratio};
                    console.log(`New Best Confidence: ${formatNumber(maxVal, {toFixed: 4})}`)
                }
                if (maxVal >= confidence) {
                    this.logger.verbose(`Match with confidence ${formatNumber(maxVal, {toFixed: 4})} met threshold of ${confidence}`);
                    break;
                }
            }

            if (currMax === undefined) {
                // template was larger than source
                this.logger.debug('No local max found');
            } else {
                const maxRatio = currMax.ratio as number;

                const startX = currMax.loc.x * (1 / maxRatio);
                const startY = currMax.loc.y * (1 / maxRatio);

                const endWidth = tW * (1 / maxRatio);
                const endHeight = tH * (1 / maxRatio);

                matchRec = new cv.Rect(startX, startY, endWidth, endHeight);
                matchedConfidence = currMax.confidence;
            }
        }

        if (currMax !== undefined) {
            return [currMax.confidence >= confidence, {matchRec, matchedConfidence}]
        }
        return [false, {matchRec, matchedConfidence}]
    }
}
