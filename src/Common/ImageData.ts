import fetch from "node-fetch";
import {Submission} from "snoowrap/dist/objects";
import {URL} from "url";
import {absPercentDifference, getSharpAsync, isValidImageURL} from "../util";
import sizeOf from "image-size";
import SimpleError from "../Utils/SimpleError";
import {Sharp} from "sharp";
import {blockhash} from "./blockhash/blockhash";

export interface ImageDataOptions {
    width?: number,
    height?: number,
    url: string,
    variants?: ImageData[]
}

class ImageData {

    width?: number
    height?: number
    url: URL
    variants: ImageData[] = []
    preferredResolution?: [number, number]
    sharpImg!: Sharp
    hashResult!: string
    actualResolution?: [number, number]

    constructor(data: ImageDataOptions, aggressive = false) {
        this.width = data.width;
        this.height = data.height;
        this.url = new URL(data.url);
        if (!aggressive && !isValidImageURL(`${this.url.origin}${this.url.pathname}`)) {
            throw new Error('URL did not end with a valid image extension');
        }
        this.variants = data.variants || [];
    }

    async data(format = 'raw'): Promise<Buffer> {
        // @ts-ignore
        return await (await this.sharp()).clone().toFormat(format).toBuffer();
    }

    async hash(bits: number, useVariantIfPossible = true): Promise<string> {
        if(this.hashResult === undefined) {
            let ref: ImageData | undefined;
            if(useVariantIfPossible && this.preferredResolution !== undefined) {
                ref = this.getSimilarResolutionVariant(this.preferredResolution[0], this.preferredResolution[1]);
            }
            if(ref === undefined) {
                ref = this;
            }
            this.hashResult = await blockhash((await ref.sharp()).clone(), bits);
        }
        return this.hashResult;
    }

    async sharp(): Promise<Sharp> {
        if (this.sharpImg === undefined) {
            try {
                const response = await fetch(this.url.toString())
                if (response.ok) {
                    const ct = response.headers.get('Content-Type');
                    if (ct !== null && ct.includes('image')) {
                        const sFunc = await getSharpAsync();
                        // if image is animated then we want to extract the first frame and convert it to a regular image
                        // so we can compare two static images later (also because sharp can't use resize() on animated images)
                        if(['gif','webp'].some(x => ct.includes(x))) {
                            this.sharpImg = await sFunc(await (await sFunc(await response.buffer(), {pages: 1, animated: false})).png().toBuffer());
                        } else {
                            this.sharpImg = await sFunc(await response.buffer());
                        }
                        const meta = await this.sharpImg.metadata();
                        if (this.width === undefined || this.height === undefined) {
                            this.width = meta.width;
                            this.height = meta.height;
                        }
                        this.actualResolution = [meta.width as number, meta.height as number];
                    } else {
                        throw new SimpleError(`Content-Type for fetched URL ${this.url} did not contain "image"`);
                    }
                } else {
                    throw new SimpleError(`URL response was not OK: (${response.status})${response.statusText}`);
                }


            } catch (err) {
                if(!(err instanceof SimpleError)) {
                    throw new Error(`Error occurred while fetching response from URL: ${err.message}`);
                } else {
                    throw err;
                }
            }
        }
        return this.sharpImg;
    }

    get pixels() {
        if (this.actualResolution !== undefined) {
            return this.actualResolution[0] * this.actualResolution[1];
        }
        if (this.width === undefined || this.height === undefined) {
            return undefined;
        }
        return this.width * this.height;
    }

    get hasDimensions() {
        return this.width !== undefined && this.height !== undefined;
    }

    get baseUrl() {
        return `${this.url.origin}${this.url.pathname}`;
    }

    setPreferredResolutionByWidth(prefWidth: number) {
        let height: number | undefined = undefined,
            width: number | undefined = undefined;
        if (this.variants.length === 0) {
            return;
        }
        for (const v of this.variants) {
            if (v.hasDimensions && (v.width as number) <= prefWidth) {
                width = v.width as number;
                height = v.height as number;
            }
        }
        if (width !== undefined) {
            this.preferredResolution = [width, (height as number)];
        }
    }

    getSimilarResolutionVariant(width: number, height: number, allowablePercentDiff = 0): ImageData | undefined {
        if (this.variants.length === 0) {
            return undefined;
        }
        return this.variants.find(x => {
            return x.hasDimensions && (absPercentDifference(width, x.width as number) <= allowablePercentDiff) && (absPercentDifference(height, x.height as number) <= allowablePercentDiff);
        });
    }

    isSameDimensions(otherImage: ImageData) {
        if (!this.hasDimensions || !otherImage.hasDimensions) {
            return false;
        }
        return this.width === otherImage.width && this.height === otherImage.height;
    }

    async sameAspectRatio(otherImage: ImageData) {
        let thisRes = this.actualResolution;
        let otherRes = otherImage.actualResolution;
        if(thisRes === undefined) {
            const tMeta = await (await this.sharp()).metadata();
            const thisMeta = {width: tMeta.width as  number, height: tMeta.height as number };
            this.actualResolution = [thisMeta.width, thisMeta.height];
            thisRes = this.actualResolution;
        }
        if(otherRes === undefined) {
            const otherMeta = await (await otherImage.sharp()).metadata();
            otherRes = [otherMeta.width as number, otherMeta.height as number];
        }
        const thisRatio = thisRes[0] / thisRes[1];
        const otherRatio = otherRes[0] / otherRes[1];

        // a little leeway
        return Math.abs(thisRatio - otherRatio) < 0.1;
    }

    static async dimensionsFromMetadata(img: Sharp) {
        const {width, height, ...rest} = await img.metadata();
        return {width: width as number, height: height as number};
    }

    async normalizeImagesForComparison(compareLibrary: ('pixel' | 'resemble'), imgToCompare: ImageData): Promise<[Sharp, Sharp, number, number]> {
        const sFunc = await getSharpAsync();

        let refImage = this as ImageData;
        let compareImage = imgToCompare;
        if (this.preferredResolution !== undefined) {
            const matchingVariant = compareImage.getSimilarResolutionVariant(this.preferredResolution[0], this.preferredResolution[1]);
            if (matchingVariant !== undefined) {
                compareImage = matchingVariant;
                refImage = this.getSimilarResolutionVariant(this.preferredResolution[0], this.preferredResolution[1]) as ImageData;
            }
        }

        let refSharp = (await refImage.sharp()).clone();
        let refMeta = await ImageData.dimensionsFromMetadata(refSharp);
        let compareSharp = (await compareImage.sharp()).clone();
        let compareMeta = await ImageData.dimensionsFromMetadata(compareSharp);

        // if dimensions on not the same we need to crop or resize before final resize
        if (refMeta.width !== compareMeta.width || refMeta.height !== compareMeta.height) {
            const thisRatio = refMeta.width / (refMeta.height);
            const otherRatio = compareMeta.width / compareMeta.height;

            const sameRatio = Math.abs(thisRatio - otherRatio) < 0.04;
            if (sameRatio) {
                // then resize first since its most likely the same image
                // can be fairly sure a downscale will get pixels close to the same
                if (refMeta.width > compareMeta.width) {
                    refSharp = sFunc(await refSharp.resize(compareMeta.width, null, {fit: 'outside'}).toBuffer());
                } else {
                    compareSharp = sFunc(await compareSharp.resize(refMeta.width, null, {fit: 'outside'}).toBuffer());
                }
                refMeta = await ImageData.dimensionsFromMetadata(refSharp);
                compareMeta = await ImageData.dimensionsFromMetadata(compareSharp);
            }
            // find smallest common dimensions
            const sWidth = refMeta.width <= compareMeta.width ? refMeta.width : compareMeta.width;
            const sHeight = refMeta.height <= compareMeta.height ? refMeta.height : compareMeta.height;

            // crop if necessary
            if(sWidth !== refMeta.width || sHeight !== refMeta.height) {
                refSharp = sFunc(await refSharp.extract({left: 0, top: 0, width: sWidth, height: sHeight}).toBuffer());
            }
            if(sWidth !== compareMeta.width || sHeight !== compareMeta.height) {
                compareSharp = sFunc(await compareSharp.extract({left: 0, top: 0, width: sWidth, height: sHeight}).toBuffer());
            }
        }

        // final resize to reduce memory/cpu usage during comparison
        refSharp = sFunc(await refSharp.resize(400, null, {fit: 'outside'}).toBuffer());
        compareSharp = sFunc(await compareSharp.resize(400, null, {fit: 'outside'}).toBuffer());

        const {width, height} = await ImageData.dimensionsFromMetadata(refSharp);
        return [refSharp, compareSharp, width, height];
    }

    static fromSubmission(sub: Submission, aggressive = false): ImageData {
        const url = new URL(sub.url);
        const data: any = {
            url,
        };
        let variants = [];
        if (sub.preview !== undefined && sub.preview.enabled && sub.preview.images.length > 0) {
            const firstImg = sub.preview.images[0];
            const ref = sub.preview.images[0].source;
            data.width = ref.width;
            data.height = ref.height;

            variants = firstImg.resolutions.map(x => new ImageData(x));
            data.variants = variants;
        }
        return new ImageData(data, aggressive);
    }
}

export default ImageData;
