import fetch from "node-fetch";
import {Submission} from "snoowrap/dist/objects";
import {URL} from "url";
import {absPercentDifference, isValidImageURL} from "../util";
import sizeOf from "image-size";
import SimpleError from "../Utils/SimpleError";

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
    private buff?: Buffer;

    constructor(data: ImageDataOptions, aggressive = false) {
        this.width = data.width;
        this.height = data.height;
        this.url = new URL(data.url);
        if (!aggressive && !isValidImageURL(`${this.url.origin}${this.url.pathname}`)) {
            throw new Error('URL did not end with a valid image extension');
        }
        this.variants = data.variants || [];
    }

    get data(): Promise<Buffer> {
        return (async () => {
            if (this.buff === undefined) {
                try {
                    const response = await fetch(this.url.toString())
                    if (response.ok) {
                        const ct = response.headers.get('Content-Type');
                        if (ct !== null && ct.includes('image')) {
                            this.buff = await response.buffer();
                            if (this.width === undefined || this.height === undefined) {
                                const dimensions = sizeOf(this.buff);
                                this.width = dimensions.width;
                                this.height = dimensions.height;
                            }
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
            return this.buff;
        })();
    }

    get pixels() {
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
