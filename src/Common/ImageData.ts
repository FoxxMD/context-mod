import fetch from "node-fetch";
import {Submission} from "snoowrap/dist/objects";
import {URL} from "url";
import {absPercentDifference, getExtension, getSharpAsync, isValidImageURL} from "../util";
import {Sharp} from "sharp";
import {blockhashAndFlipped} from "./blockhash/blockhash";
import {CMError, SimpleError} from "../Utils/Errors";
import {FileHandle, open} from "fs/promises";
import {ImageHashCacheData} from "./Infrastructure/Atomic";

export interface ImageDataOptions {
    width?: number,
    height?: number,
    path: URL,
    variants?: ImageData[]
}

class ImageData {

    width?: number
    height?: number
    path: URL
    variants: ImageData[] = []
    preferredResolution?: [number, number]
    sharpImg!: Sharp
    hashResult?: string
    hashResultFlipped?: string
    actualResolution?: [number, number]

    constructor(data: ImageDataOptions, aggressive = false) {
        this.width = data.width;
        this.height = data.height;
        this.path = data.path;
        if (!aggressive && !isValidImageURL(`${this.path.origin}${this.path.pathname}`)) {
            throw new Error('Path did not end with a valid image extension');
        }
        this.variants = data.variants || [];
    }

    async data(format = 'raw'): Promise<Buffer> {
        // @ts-ignore
        return await (await this.sharp()).clone().toFormat(format).toBuffer();
    }

    async hash(bits: number = 16, useVariantIfPossible = true): Promise<Required<ImageHashCacheData>> {
        if (this.hashResult === undefined || this.hashResultFlipped === undefined) {
            let ref: ImageData | undefined;
            if (useVariantIfPossible && this.preferredResolution !== undefined) {
                ref = this.getSimilarResolutionVariant(this.preferredResolution[0], this.preferredResolution[1]);
            }
            if (ref === undefined) {
                ref = this;
            }
            const [hash, hashFlipped] = await blockhashAndFlipped((await ref.sharp()).clone(), bits);
            this.hashResult = hash;
            this.hashResultFlipped = hashFlipped;
        }
        return {original: this.hashResult, flipped: this.hashResultFlipped};
    }

    async sharp(): Promise<Sharp> {
        if (this.sharpImg === undefined) {
            let animated = false;
            let getBuffer: () => Promise<Buffer>;
            let fileHandle: FileHandle | undefined;
            try {
                if (this.path.protocol === 'file:') {
                    try {
                        animated = ['gif', 'webp'].includes(getExtension(this.path.pathname));
                        fileHandle = await open(this.path, 'r');
                        getBuffer = async () => await (fileHandle as FileHandle).readFile();
                    } catch (err: any) {
                        throw new CMError(`Unable to retrieve local file ${this.path.toString()}`, {cause: err});
                    }
                } else {
                    try {
                        const response = await fetch(this.path.toString())
                        if (response.ok) {
                            const ct = response.headers.get('Content-Type');
                            if (ct !== null && ct.includes('image')) {
                                animated = ['gif', 'webp'].some(x => ct.includes(x));
                                getBuffer = async () => await response.buffer();
                            } else {
                                throw new SimpleError(`Content-Type for fetched URL ${this.path.toString()} did not contain "image"`);
                            }
                        } else {
                            throw new SimpleError(`Fetching ${this.path.toString()} => URL response was not OK: (${response.status})${response.statusText}`);
                        }

                    } catch (err: any) {
                        if (!(err instanceof SimpleError)) {
                            throw new CMError(`Error occurred while fetching response from URL ${this.path.toString()}`, {cause: err});
                        } else {
                            throw err;
                        }
                    }
                }
            } catch (err: any) {
                throw new CMError('Unable to fetch image resource', {cause: err, isSerious: false});
            }

            try {

                const sFunc = await getSharpAsync();
                // if image is animated then we want to extract the first frame and convert it to a regular image
                // so we can compare two static images later (also because sharp can't use resize() on animated images)
                if (animated) {
                    this.sharpImg = await sFunc(await (await sFunc(await getBuffer(), {
                        pages: 1,
                        animated: false
                    }).trim().greyscale()).png().withMetadata().toBuffer());
                } else {
                    this.sharpImg = await sFunc(await sFunc(await getBuffer()).trim().greyscale().withMetadata().toBuffer());
                }

                if(fileHandle !== undefined) {
                    await fileHandle.close();
                }

                const meta = await this.sharpImg.metadata();
                if (this.width === undefined || this.height === undefined) {
                    this.width = meta.width;
                    this.height = meta.height;
                }
                this.actualResolution = [meta.width as number, meta.height as number];

            } catch (err: any) {
                throw new CMError('Error occurred while converting image buffer to Sharp object', {cause: err});
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

    get basePath() {
        return `${this.path.origin}${this.path.pathname}`;
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

    toHashCache(): ImageHashCacheData {
        return {
            original: this.hashResult,
            flipped: this.hashResultFlipped
        }
    }

    setFromHashCache(data: ImageHashCacheData) {
        const {original, flipped} = data;
        this.hashResult = original;
        this.hashResultFlipped = flipped;
    }

    static fromSubmission(sub: Submission, aggressive = false): ImageData {
        const url = new URL(sub.url);
        const data: any = {
            path: url,
        };
        let variants = [];
        if (sub.preview !== undefined && sub.preview.enabled && sub.preview.images.length > 0) {
            const firstImg = sub.preview.images[0];
            const ref = sub.preview.images[0].source;
            data.width = ref.width;
            data.height = ref.height;

            variants = firstImg.resolutions.map(x => new ImageData({...x, path: new URL(x.url)}));
            data.variants = variants;
        }
        return new ImageData(data, aggressive);
    }
}

export default ImageData;
