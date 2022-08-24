# Installation

In order to run a ContextMod instance you must first you must install it somewhere.

ContextMod can be run on almost any operating system but it is recommended to use Docker due to ease of deployment.

## Docker (Recommended)

PROTIP: Using a container management tool like [Portainer.io CE](https://www.portainer.io/products/community-edition) will help with setup/configuration tremendously.

### [Dockerhub](https://hub.docker.com/r/foxxmd/context-mod)

An example of starting the container using the [minimum configuration](/docs/operator/configuration.md#minimum-config):

* Bind the directory where your config file, logs, and database are located on your host machine into the container's default `DATA_DIR` by using `-v /host/path/folder:/config`
  * Note: **You must do this** or else your configuration will be lost next time your container is updated.
* Expose the web interface using the container port `8085`

```
docker run -d -v /host/path/folder:/config -p 8085:8085 foxxmd/context-mod
```

The location of `DATA_DIR` in the container can be changed by passing it as an environmental variable EX `-e "DATA_DIR=/home/abc/config`

### Linux Host

**NOTE:** If you are using [rootless containers with Podman](https://developers.redhat.com/blog/2020/09/25/rootless-containers-with-podman-the-basics#why_podman_) this DOES NOT apply to you.

If you are running Docker on a **Linux Host** you must specify `user:group` permissions of the user who owns the **configuration directory** on the host to avoid [docker file permission problems.](https://ikriv.com/blog/?p=4698) These can be specified using the [environmental variables **PUID** and **PGID**.](https://docs.linuxserver.io/general/understanding-puid-and-pgid)

To get the UID and GID for the current user run these commands from a terminal:

* `id -u` -- prints UID
* `id -g` -- prints GID

```
docker run -d -v /host/path/folder:/config -p 8085:8085 -e PUID=1000 -e PGID=1000 foxxmd/context-mod
```

## Locally

Requirements:

* [Typescript](https://www.typescriptlang.org/) >=4.3.5
* [Node](https://nodejs.org) >=16
  * [NPM](https://www.npmjs.com/) >=8 (usually bundled with Node)

Clone this repository somewhere and then install from the working directory

```bash
git clone https://github.com/FoxxMD/context-mod.git .
cd context-mod
npm install
tsc -p .
```

An example of running CM using the [minimum configuration](/docs/operator/configuration.md#minimum-config) with a [configuration file](/docs/operator/configuration.md#file-configuration-recommended):

```bash
node src/index.js run
```

### Dependencies

Note: All below dependencies are automatically included in the [Docker](#docker-recommended) image.

#### Sharp

For basic [Image Comparisons](/docs/imageComparison.md) and image data CM uses [sharp](https://sharp.pixelplumbing.com/) which depends on [libvips](https://www.libvips.org/)

Binaries for Sharp and libvips ship with the `sharp` npm package for all major operating systems and should require no additional steps to use -- installing CM with the above script should be sufficient.

See more about Sharp dependencies in the [image comparison prerequisites.](/docs/imageComparison.md#prerequisites)


#### OpenCV

For advanced image comparison CM uses [OpenCV.](https://opencv.org/) OpenCV is an **optional** dependency that is only utilized if CM is configured to run these advanced image operations so if you are NOT doing any image-related operations you can safely ignore this section/dependency.

**NOTE:** Depending on the image being compared (resolution) and operations being performed this can be a **CPU heavy resource.** TODO: Add rules that are cpu heavy...

##### Installation

Installation is not an automatic process. The below instructions are a summary of "easy" paths for installation but are not exhaustive. DO reference the detailed instructions (including additional details for windows installs) at [opencv4nodejs How to Install](https://github.com/UrielCh/opencv4nodejs#how-to-install).

###### Build From Source

This may take **some time** since openCV will be built from scratch.

On windows you must first install build tools: `npm install --global windows-build-tools`

Otherwise, run one of the following commands from the CM project directory:

* For CUDA (Nvidia GPU acceleration): `npm run cv-autoinstall-cuda`
* Normal: `npm run cv-autoinstall`

###### Build from Prebuilt

In this use-case you already have openCV built OR are using a distro prebuilt package. This method is much faster than building from source as only bindings need to be built.

[More information on prebuild installation](https://github.com/UrielCh/opencv4nodejs#installing-opencv-manually)

Prerequisites:

* Windows `choco install OpenCV -y -version 4.1.0`
* MacOS `brew install opencv@4; brew link --force opencv@4`
* Linux -- varies, check your package manager for `opencv` and `opencv-dev`

A script for building on **Ubuntu** is already included in CM:

* `sudo apt install opencv-dev`
* `npm run cv-install-ubuntu-prebuild`

Otherwise, you will need to modify `scripts` in CM's `package.json`, use the script `cv-install-ubuntu-prebuild` as an example. Your command must include:

* `--incDir [path/to/opencv/dev-files]` (on linux, usually `/usr/include/opencv4/`)
* `--libDir [path/to/opencv/shared-files]` (on linux usually `/lib/x86_64-linux-gnu/` or `/usr/lib/`)
* `--binDir=[path/to/openv/binaries]` (on linux usually `/usr/bin/`)

After you have modified/added a script for your operating system run it with `npm run yourScriptName`

## [Heroku Quick Deploy](https://heroku.com/about)

**NOTE:** This is still experimental and requires more testing.

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://dashboard.heroku.com/new?template=https://github.com/FoxxMD/context-mod)

This template provides a **web** and **worker** dyno for heroku.

* **Web** -- Will run the bot **and** the web interface for ContextMod.
* **Worker** -- Will run **just** the bot.

Be aware that Heroku's [free dyno plan](https://devcenter.heroku.com/articles/free-dyno-hours#dyno-sleeping) enacts some limits:

* A **Web** dyno will go to sleep (pause) after 30 minutes without web activity -- so your bot will ALSO go to sleep at this time
* The **Worker** dyno **will not** go to sleep but you will NOT be able to access the web interface. You can, however, still see how Cm is running by reading the logs for the dyno.

If you want to use a free dyno it is recommended you perform first-time setup (bot authentication and configuration, testing, etc...) with the **Web** dyno, then SWITCH to a **Worker** dyno so it can run 24/7.

# Memory Management

Node exhibits [lazy GC cleanup](https://github.com/FoxxMD/context-mod/issues/90#issuecomment-1190384006) which can result in memory usage for long-running CM instances increasing to unreasonable levels. This problem does not seem to be an issue with CM itself but with Node's GC approach. The increase does not affect CM's performance and, for systems with less memory, the Node *should* limit memory usage based on total available.

In practice CM uses ~130MB for a single bot, single subreddit setup. Up to ~350MB for many (10+) bots or many (20+) subreddits.

If you need to reign in CM's memory usage for some reason this can be addressed by setting an upper limit for memory usage with `node` args by using either:

**--max_old_space_size=**

Value is megabytes. This sets an explicit limit on GC memory usage.

This is set by default in the [Docker](#docker-recommended) container using the env `NODE_ARGS` to `--max_old_space_size=512`. It can be disabled by overriding the ENV.

**--optimize_for_size**

Tells Node to optimize for (less) memory usage rather than some performance optimizations. This option is not memory size dependent. In practice performance does not seem to be affected and it reduces (but not entirely prevents) memory increases over long periods.
