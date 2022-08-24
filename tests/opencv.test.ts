import {describe, it} from 'mocha';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import express, {Request, Response} from "express";
import {formatNumber, resolvePath, sleep} from "../src/util";
import {pathToFileURL, URL} from "url";
import ImageData from "../src/Common/ImageData";
import * as cvTypes from '@u4/opencv4nodejs'
import {getCV, TemplateCompare} from "../src/Common/OpenCVService";
import winston from 'winston';

chai.use(chaiAsPromised);

const assert = chai.assert;

const star = pathToFileURL(resolvePath('./tests/assets/star-transparent.png', './'));
const starInside = pathToFileURL(resolvePath('./tests/assets/star-inside.png', './'));
const tran = pathToFileURL(resolvePath('./tests/assets/tran.jpg', './'));
const tranSel = pathToFileURL(resolvePath('./tests/assets/tran-selection.jpg', './'));

describe('Template Matching', function () {

    let cv: typeof cvTypes.cv;

    before(async () => {
        cv = await getCV();
    });

    it('matches a standard example', async function () {

        const templateMatch = new TemplateCompare(cv, winston.loggers.get('app'));

        await templateMatch.setTemplate(new ImageData({path: tranSel}));

        const [passed, results] = await templateMatch.matchImage(new ImageData({
            path: tran
        }), 'template');

        if(results.matchRec !== undefined) {
            const src = cv.imread(tran.pathname);
            src.drawRectangle(
                results.matchRec,
                new cv.Vec3(0, 255, 0),
                2,
                cv.LINE_8
            );
            // TODO mask is not drawn correctly (its above?)
            cv.imwrite(pathToFileURL(resolvePath(`./tests/assets/tran-masked.jpg`, './')).pathname, src);
        }

        assert.isTrue(passed);
    });

    it('matches a template using service', async function () {

        const templateMatch = new TemplateCompare(cv, winston.loggers.get('app'));

        await templateMatch.setTemplate(new ImageData({path: star}));

        const [passed, results] = await templateMatch.matchImage(new ImageData({
            path: starInside
        }), 'template', 0.2);

        if(results.matchRec !== undefined) {
            const src = cv.imread(starInside.pathname);
            src.drawRectangle(
                results.matchRec,
                new cv.Vec3(0, 255, 0),
                2,
                cv.LINE_8
            );
            cv.imwrite(pathToFileURL(resolvePath(`./tests/assets/star-masked.jpg`, './')).pathname, src);
        }
    });
});
