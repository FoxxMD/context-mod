# Overview

ContextMod supports comparing image content, for the purpose of detecting duplicates, with two different but complimentary systems. Image comparison behavior is available for the following rules:

* [Recent Activity](/docs/subreddit/components/recentActivity)
* Repeat Activity (In-progress)

To enable comparisons reference the example below (at the top-level of your rule) and configure as needed:

JSON
```json5
{
  "name": "ruleWithImageDetection",
  "kind": "recentActivity",
  // Add block below...
  // 
  "imageDetection": {
    // enables image comparison
    "enable": true,
    // The difference, in percentage, between the reference submission and the submissions being checked
    // must be less than this number to consider the images "the same"
    "threshold": 5,
    // optional
    // set the behavior for determining if image comparison should occur on a URL:
    //
    // "extension" => try image detection if URL ends in a known image extension (jpeg, gif, png, bmp, etc.)
    // "unknown"   => try image detection if URL ends in known image extension OR there is no extension OR the extension is unknown (not video, html, doc, etc...)
    // "all"       => ALWAYS try image detection, regardless of URL extension
    //
    // if fetchBehavior is not defined then "extension" is the default
    "fetchBehavior": "extension",
  },
  //
  // And above ^^^
  //...
}
```
YAML
```yaml
name: ruleWithImageDetection
kind: recentActivity
  enable: true
  threshold: 5
  fetchBehavior: extension

```

**Perceptual Hashing** (`hash`) and **Pixel Comparisons** (`pixel`) may be used at the same time. Refer to the documentation below to see how they interact.

**Note:** Regardless of `fetchBehavior`, if the response from the URL does not indicate it is an image then image detection will not occur. IE Response `Content-Type` must contain `image`

## Prerequisites

Both image comparison systems require [Sharp](https://sharp.pixelplumbing.com/) as a dependency. Most modern operating systems running Node.js >= 12.13.0 do not require installing additional dependencies in order to use Sharp. 

If you are using the docker image for ContextMod (`foxxmd/context-mod`) Sharp is built-in.

If you are installing ContextMod using npm then **Sharp should be installed automatically as an optional dependency.** 

**If you do not want to install it automatically** install ContextMod with the following command:

```
npm install --no-optional
```

If you are using ContextMod as part of a larger project you may want to require Sharp in your own package:

```
npm install sharp@0.29.1 --save
```

# Comparison Systems

## Perceptual Hashing

[Perceptual Hashing](https://en.wikipedia.org/wiki/Perceptual_hashing) creates a text fingerprint of an image by:

* Dividing up the image into a grid
* Using an algorithm to derive a value from the pixels in each grid
* Adding up all the values to create a unique string (the "fingerprint")

An example of how a perceptual hash can work [can be found here.](https://www.hackerfactor.com/blog/?/archives/432-Looks-Like-It.html)

ContextMod uses [blockhash-js](https://github.com/commonsmachinery/blockhash-js) which is a javascript implementation of the algorithm described in the paper [Block Mean Value Based Image Perceptual Hashing by Bian Yang, Fan Gu and Xiamu Niu.](https://ieeexplore.ieee.org/document/4041692)


**Advantages**

* Low memory requirements and not CPU intensive
* Does not require any image transformations
* Hash results can be stored to make future comparisons even faster and skip downloading images (cached by url)
* Resolution-independent

**Disadvantages**

* Hash is weak when image differences are based only on color
* Hash is weak when image contains lots of text
* Higher accuracy requires larger calculation (more bits required)

**When should I use it?**

* General duplicate detection
* Comparing many images
* Comparing the same images often

### How To Use

If `imageDetection.enable` is `true` then hashing is enabled by default and no further configuration is required.

To further configure hashing refer to this code block:

```json5
{
  "name": "ruleWithImageDetectionAndConfiguredHashing",
  "kind": "recentActivity",
  "imageDetection": {
    "enable": true,
    // Add block below...
    //
    "hash": {
      // enable or disable hash comparisons (enabled by default)
      "enable": true,
      // determines accuracy of hash and granularity of hash comparison (comparison to other hashes)
      // the higher the bits the more accurate the comparison
      //
      // NOTE: Hashes of different sizes (bits) cannot be compared. If you are caching hashes make sure all rules where results may be shared use the same bit count to ensure hashes can be compared. Otherwise hashes will be recomputed.
      "bits": 32,
      // default is 32 if not defined
      //
      // number of seconds to cache an image hash
      "ttl": 60,
      // default is 60 if not defined
      //
      // "High Confidence" Threshold
      // If the difference in comparison is equal to or less than this number the images are considered the same and pixel comparison WILL NOT occur
      //
      // Defaults to the parent-level `threshold` value if not present
      //
      // Use null if you want pixel comparison to ALWAYS occur (softThreshold must be present)
      "hardThreshold": 5,
      //
      // "Low Confidence" Threshold -- only used if `pixel` is enabled
      // If the difference in comparison is:
      //
      // 1) equal to or less than this value and
      // 2) the value is greater than `hardThreshold`
      //
      // the images will be compared using the `pixel` method
      "softThreshold": 0,
    },
    //
    // And above ^^^
    //"pixel": {...}
  }
  //...
}
```
YAML
```yaml
name: ruleWithImageDetectionAndConfiguredHashing
kind: recentActivity
imageDetection:
  enable: true
  hash:
    enable: true
    bits: 32
    ttl: 60
    hardThreshold: 5
    softThreshold: 0
```

## Pixel Comparison

This approach is as straight forward as it sounds. Both images are compared, pixel by pixel, to determine the difference between the two. ContextMod uses [pixelmatch](https://github.com/mapbox/pixelmatch) to do the comparison.

**Advantages**

* Extremely accurate, high-confidence on difference percentage
* Strong when comparing text-based images or color-only differences

**Disadvantages**

* High memory requirements (10-30MB per comparison) and CPU intensive
* Weak against similar images with different aspect ratios
* Requires image transformations (resize, crop) before comparison
* Can only store image-to-image results (no single image fingerprints)

**When should I use it?**

* Require very high accuracy in comparison results
* Comparing mostly text-based images or subtle color/detail differences
* As a secondary, high-confidence confirmation of comparison result after hashing

### How To Use

By default pixel comparisons **are not enabled.** They must be explicitly enabled in configuration.

Pixel comparisons will be performed in either of these scenarios:

* pixel is enabled, hashing is enabled and `hash.softThreshold` is defined
  * When a comparison occurs that is less different than `softThreshold` but more different then `hardThreshold` (or `"hardThreshold": null`), then pixel comparison will occur as a high-confidence check
  * Example
    * hash comparison => 7% difference
    * `"softThreshold": 10`
    * `"hardThreshold": 4`
* `hash.enable` is `false` and `pixel.enable` is true
  * hashing is skipped entirely and only pixel comparisons are performed 

To configure pixel comparisons refer to this code block:

```json5
{
  "name": "ruleWithImageDetectionAndPixelEnabled",
  "kind": "recentActivity",
  "imageDetection": {
    //"hash": {...}
    "pixel": {
      // enable or disable pixel comparisons (disabled by default)
      "enable": true,
      // if the comparison difference percentage is equal to or less than this value the images are considered the same
      //
      // if not defined the value from imageDetection.threshold will be used
      "threshold": 5
    }
  },
  //...
}
```
YAML
```yaml
name: ruleWithImageDetectionAndPixelEnabled
kind: recentActivity
imageDetection:
  pixel:
    enable: true
    threshold: 5
```
