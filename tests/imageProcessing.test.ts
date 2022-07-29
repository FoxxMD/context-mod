import {describe, it} from 'mocha';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import express, {Request, Response} from "express";
import {resolvePath} from "../src/util";
import {pathToFileURL, URL} from "url";
import ImageData from "../src/Common/ImageData";
import leven from "leven";

chai.use(chaiAsPromised);

const assert = chai.assert;

let app = express();
app.use('/assets', express.static(`${__dirname}/assets`));

const rickOriginalFile = pathToFileURL(resolvePath('./tests/assets/rick-original.jpg', './'));
const rickCopyFile = pathToFileURL(resolvePath('./tests/assets/rick-copy.jpg', './'));
const rickSmallerFile = pathToFileURL(resolvePath('./tests/assets/rick-smaller.jpg', './'));
const rickBorderedFile = pathToFileURL(resolvePath('./tests/assets/rick-border.jpg', './'));
const rickFlippedFile = pathToFileURL(resolvePath('./tests/assets/rick-flipped.jpg', './'));
const rickWhiteBG = pathToFileURL(resolvePath('./tests/assets/rick-whitebg.jpg', './'));
const rickRatio = pathToFileURL(resolvePath('./tests/assets/rick-ratio.jpg', './'));
const rickSaturation = pathToFileURL(resolvePath('./tests/assets/rick-saturated.jpg', './'));

describe('Image Resource Parsing', function () {

    before(() => {
        // @ts-ignore
        app.server = app.listen(5999);
    });

    after(() => {
        // @ts-ignore
        app.server.close();
    });

    it('Handles local resource', async function () {
        const local = new ImageData({
            path: rickOriginalFile
        });
        await assert.isFulfilled(local.sharp());
        assert.exists(local.width);
    });

    it('Handles remote resource', async function () {
        const local = new ImageData({
            path: new URL('http://localhost:5999/assets/rick-original.jpg')
        });
        await assert.isFulfilled(local.sharp());
        assert.exists(local.width);
    });

    it('Throws when remote resource extension is not a known image type', async function () {
        assert.throws(() => {
            const local = new ImageData({
                path: new URL('http://localhost:5999/assets/nonImage.txt')
            });
        })
    });

    it('Throws when remote resource is not an image', async function () {
        const local = new ImageData({
            path: new URL('http://localhost:5999/assets/nonImage.txt')
        }, true);

        await assert.isRejected(local.sharp());
    });
});

describe('Image Normalization', function () {

    it('Removes borders', async function () {
        const original = new ImageData({
            path: rickOriginalFile
        });
        await original.sharp();

        const bordered = new ImageData({
            path: rickBorderedFile
        });
        await bordered.sharp();

        assert.equal(original.width, bordered.width);
        assert.equal(original.height, bordered.height);
    });
});

describe('Hash Comparisons', function () {

    const original = new ImageData({
        path: rickOriginalFile
    });

    before(async () => {
        await original.hash(32);
    });

    it('Detects identical images as the same', async function () {

        const compareImg = new ImageData({
            path: rickCopyFile
        });
        await compareImg.hash(32);

        const distanceNormal = leven(original.hashResult, compareImg.hashResult);
        const diffNormal = (distanceNormal/original.hashResult.length)*100;

        assert.equal(diffNormal, 0);
    });

    it('Detects images with only saturation differences as the same', async function () {

        const compareImg = new ImageData({
            path: rickSaturation
        });
        await compareImg.hash(32);

        await original.sharpImg.toFile(resolvePath('./tests/rick-orig-grey.jpg', './'))
        await compareImg.sharpImg.toFile(resolvePath('./tests/rick-satur-grey.jpg', './'))

        const distanceNormal = leven(original.hashResult, compareImg.hashResult);
        const diffNormal = (distanceNormal/original.hashResult.length)*100;

        assert.isAtMost(diffNormal, 4);
    });

    it('Detects images with different resolutions as the same', async function () {

        const compareImg = new ImageData({
            path: rickSmallerFile
        });
        await compareImg.hash(32);

        const distanceNormal = leven(original.hashResult, compareImg.hashResult);
        const diffNormal = (distanceNormal/original.hashResult.length)*100;

        assert.equal(diffNormal, 0);
    });

    it('Detects flipped versions as the same', async function () {

        const flipped = new ImageData({
            path: rickFlippedFile
        });
        await flipped.hash(32);

        const distanceNormal = leven(original.hashResult, flipped.hashResult);
        const diffNormal = (distanceNormal/original.hashResult.length)*100;

        assert.isAtLeast(diffNormal, 50);

        const distanceFlipped = leven(original.hashResult, flipped.hashResultFlipped);
        const diffFlipped = (distanceFlipped/original.hashResult.length)*100;

        assert.isAtMost(diffFlipped, 4);
    });

    it('Detects images with minor ratio differences as the same', async function () {

        const compareImg = new ImageData({
            path: rickRatio
        });
        await compareImg.hash(32);

        const distanceNormal = leven(original.hashResult, compareImg.hashResult);
        const diffNormal = (distanceNormal/original.hashResult.length)*100;

        assert.isAtMost(diffNormal, 10);
    });

    it('Detects different images as different', async function () {

        const compareImg = new ImageData({
            path: rickWhiteBG
        });
        await compareImg.hash(32);

        const distanceNormal = leven(original.hashResult, compareImg.hashResult);
        const diffNormal = (distanceNormal/original.hashResult.length)*100;

        assert.isAtLeast(diffNormal, 50);
    });

});
