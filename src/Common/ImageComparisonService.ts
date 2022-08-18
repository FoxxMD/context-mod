import {Logger} from "winston";
import {SubredditResources} from "../Subreddit/SubredditResources";
import {StrongImageDetection} from "./interfaces";
import ImageData from "./ImageData";
import {bitsToHexLength, mergeArr} from "../util";
import {CMError} from "../Utils/Errors";
import {ImageHashCacheData} from "./Infrastructure/Atomic";
import leven from "leven";

export interface CompareImageOptions {
    config?: StrongImageDetection
}

export interface ThresholdResults {
    withinHard: boolean | undefined,
    withinSoft: boolean | undefined
}

export class ImageComparisonService {

    protected reference!: ImageData
    protected resources: SubredditResources;
    protected logger: Logger;
    protected detectionConfig: StrongImageDetection;

    constructor(resources: SubredditResources, logger: Logger, config: StrongImageDetection) {
        this.resources = resources;
        this.logger = logger.child({labels: ['Image Detection']}, mergeArr);
        this.detectionConfig = config;
    }

    async setReference(img: ImageData, options?: CompareImageOptions) {
        this.reference = img;
        const {config = this.detectionConfig} = options || {};

        try {
            this.reference.setPreferredResolutionByWidth(800);
            if (config.hash.enable) {
                if (config.hash.ttl !== undefined) {
                    const refHash = await this.resources.getImageHash(this.reference);
                    if (refHash === undefined) {
                        await this.reference.hash(config.hash.bits);
                        await this.resources.setImageHash(this.reference, config.hash.ttl);
                    } else if (refHash.original.length !== bitsToHexLength(config.hash.bits)) {
                        this.logger.warn('Reference image hash length did not correspond to bits specified in config. Recomputing...');
                        await this.reference.hash(config.hash.bits);
                        await this.resources.setImageHash(this.reference, config.hash.ttl);
                    } else {
                        this.reference.setFromHashCache(refHash);
                    }
                } else {
                    await this.reference.hash(config.hash.bits);
                }
            }
        } catch (err: any) {
            throw new CMError('Could not set reference image due to an error', {cause: err});
        }
    }

    compareDiffWithThreshold(diff: number, options?: CompareImageOptions): ThresholdResults {
        const {
            config: {
                hash: {
                    hardThreshold = 5,
                    softThreshold = undefined,
                } = {},
            } = this.detectionConfig
        } = options || {};

        let hard: boolean | undefined;
        let soft: boolean | undefined;

        if ((null !== hardThreshold && undefined !== hardThreshold)) {
            hard = diff <= hardThreshold;
            if (hard) {
                return {withinHard: hard, withinSoft: hard};
            }
        }

        if ((null !== softThreshold && undefined !== softThreshold)) {
            soft = diff <= softThreshold;
        }

        return {withinHard: hard, withinSoft: soft};
    }

    async compareWithCandidate(candidate: ImageData, options?: CompareImageOptions) {
        const {config = this.detectionConfig} = options || {};

        if (config.hash.enable) {
            await this.compareCandidateHash(candidate, options);
        }
    }

    async compareCandidateHash(candidate: ImageData, options?: CompareImageOptions) {
        const {config = this.detectionConfig} = options || {};

        let compareHash: Required<ImageHashCacheData> | undefined;
        if (config.hash.ttl !== undefined) {
            compareHash = await this.resources.getImageHash(candidate);
        }
        if (compareHash === undefined) {
            compareHash = await candidate.hash(config.hash.bits);
            if (config.hash.ttl !== undefined) {
                await this.resources.setImageHash(candidate, config.hash.ttl);
            }
        } else {
            candidate.setFromHashCache(compareHash);
        }

        let diff = await this.compareImageHashes(this.reference, candidate, options);

        let threshRes = this.compareDiffWithThreshold(diff, options);

        if(threshRes.withinSoft !== true && threshRes.withinHard !== true) {
            // up to this point we rely naively on hashes that were:
            //
            // * from cache/db for which we do not have resolutions stored (maybe fix this??)
            // * hashes generated from PREVIEWS from reddit that should be the same *width*
            //
            // we don't have control over how reddit resizes previews or the quality of the previews
            // so if we don't get a match using our initial naive, but cpu/data lite approach,
            // then we need to check original sources to see if it's possible there has been resolution/cropping trickery

            if(this.reference.isMaybeCropped(candidate)) {
                const [normalizedRefSharp, normalizedCandidateSharp, width, height] = await this.reference.normalizeImagesForComparison('pixel', candidate, false);
                const normalizedRef = new ImageData({width, height, path: this.reference.path});
                normalizedRef.sharpImg = normalizedRefSharp;
                const normalizedCandidate = new ImageData({width, height, path: candidate.path});
                normalizedCandidate.sharpImg = normalizedCandidateSharp;

                const normalDiff = await this.compareImageHashes(normalizedRef, normalizedCandidate, options);
                let normalizedThreshRes = this.compareDiffWithThreshold(normalDiff, options);
            }
        }

/*        // return image if hard is defined and diff is less
        if (null !== config.hash.hardThreshold && diff <= config.hash.hardThreshold) {
            return x;
        }
        // hard is either not defined or diff was greater than hard

        // if soft is defined
        if (config.hash.softThreshold !== undefined) {
            // and diff is greater than soft allowance
            if (diff > config.hash.softThreshold) {
                // not similar enough
                return null;
            }
            // similar enough, will continue on to pixel (if enabled!)
        } else {
            // only hard was defined and did not pass
            return null;
        }*/
    }

    async compareImageHashes(reference: ImageData, candidate: ImageData, options?: CompareImageOptions) {
        const {config = this.detectionConfig} = options || {};
        const {
            hash: {
                bits = 16,
            } = {},
        } = config;

        let refHash = await reference.hash(bits);
        let compareHash = await candidate.hash(bits);

        if (compareHash.original.length !== refHash.original.length) {
            this.logger.warn(`Hash lengths were not the same! Will need to recompute compare hash to match reference.\n\nReference: ${reference.basePath} has is ${refHash.original.length} char long | Comparing: ${candidate.basePath} has is ${compareHash} ${compareHash.original.length} long`);
            refHash = await reference.hash(bits, true, true);
            compareHash = await candidate.hash(bits, true, true);
        }

        let diff: number;
        const odistance = leven(refHash.original, compareHash.original);
        diff = (odistance / refHash.original.length) * 100;

        // compare flipped hash if it exists
        // if it has less difference than normal comparison then the image is probably flipped (or so different it doesn't matter)
        if (compareHash.flipped !== undefined) {
            const fdistance = leven(refHash.original, compareHash.flipped);
            const fdiff = (fdistance / refHash.original.length) * 100;
            if (fdiff < diff) {
                diff = fdiff;
            }
        }

        return diff;
    }

    async compareCandidatePixel() {
        // TODO
    }

    async compareImagePixels() {
        // TODO
    }

}
