import fetch from "node-fetch";
import {Submission} from "snoowrap/dist/objects";
import {URL} from "url";
import {absPercentDifference, getSharpAsync, isValidImageURL} from "../util";
import sizeOf from "image-size";
import SimpleError from "../Utils/SimpleError";
import {Sharp} from "sharp";

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

    async data(format?: string): Promise<Buffer> {
        await this.sharp();
        switch(format) {
            case 'jpg':
                return this.sharpImg.jpeg().toBuffer();
            case 'png':
                return this.sharpImg.png().toBuffer();
            default:
                return this.sharpImg.raw().toBuffer();
        }
        //return this.buff;
    }

    async sharp(): Promise<Sharp> {
        if (this.sharpImg === undefined) {
            try {
                const response = await fetch(this.url.toString())
                if (response.ok) {
                    const ct = response.headers.get('Content-Type');
                    if (ct !== null && ct.includes('image')) {
                        const sFunc = await getSharpAsync();
                        //const imgInfo = await sFunc(await response.buffer()).ensureAlpha().raw().toBuffer({resolveWithObject: true});
                        this.sharpImg = await sFunc(await response.buffer()).ensureAlpha();
                        const meta = await this.sharpImg.metadata();
                        //this.buff =  imgInfo.data;
                        //this.buff = await response.buffer();
                        if (this.width === undefined || this.height === undefined) {
                            // this.width = imgInfo.info.width;
                            // this.height = imgInfo.info.height;
                            this.width = meta.width;
                            this.height = meta.height;
                        }
                        //this.actualResolution = [imgInfo.info.width, imgInfo.info.height];
                        this.actualResolution = [meta.width as number, meta.height as number];
                        //this.sharpImg = sharpImg;
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
