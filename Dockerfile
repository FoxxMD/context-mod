FROM lsiobase/alpine:3.15 as base

ENV TZ=Etc/GMT

# borrowed from node/alpine:3.15
# https://github.com/nodejs/docker-node/blob/main/16/alpine3.15/Dockerfile
#
# Start of node docker stuff
#
ENV NODE_VERSION 16.14.2

RUN apk add --no-cache \
        libstdc++ \
    && apk add --no-cache --virtual .build-deps \
        curl \
    && ARCH= && alpineArch="$(apk --print-arch)" \
      && case "${alpineArch##*-}" in \
        x86_64) \
          ARCH='x64' \
          CHECKSUM="a6dc255e1ef1f20372306eec932b4a3648575c6d3024bcd685b8efc93dc95569" \
          ;; \
        *) ;; \
      esac \
  && if [ -n "${CHECKSUM}" ]; then \
    set -eu; \
    curl -fsSLO --compressed "https://unofficial-builds.nodejs.org/download/release/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH-musl.tar.xz"; \
    echo "$CHECKSUM  node-v$NODE_VERSION-linux-$ARCH-musl.tar.xz" | sha256sum -c - \
      && tar -xJf "node-v$NODE_VERSION-linux-$ARCH-musl.tar.xz" -C /usr/local --strip-components=1 --no-same-owner \
      && ln -s /usr/local/bin/node /usr/local/bin/nodejs; \
  else \
    echo "Building from source" \
    # backup build
    && apk add --no-cache --virtual .build-deps-full \
        binutils-gold \
        g++ \
        gcc \
        gnupg \
        libgcc \
        linux-headers \
        make \
        python3 \
    # gpg keys listed at https://github.com/nodejs/node#release-keys
    && for key in \
      4ED778F539E3634C779C87C6D7062848A1AB005C \
      141F07595B7B3FFE74309A937405533BE57C7D57 \
      94AE36675C464D64BAFA68DD7434390BDBE9B9C5 \
      74F12602B6F1C4E913FAA37AD3A89613643B6201 \
      71DCFD284A79C3B38668286BC97EC7A07EDE3FC1 \
      8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600 \
      C4F0DFFF4E8C1A8236409D08E73BC641CC11F4C8 \
      C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C \
      DD8F2338BAE7501E3DD5AC78C273792F7D83545D \
      A48C2BEE680E841632CD4E44F07496B3EB3C1762 \
      108F52B48DB57BB0CC439B2997B01419BD92F80A \
      B9E2F5981AA6E0CD28160D9FF13993A75599653C \
    ; do \
      gpg --batch --keyserver hkps://keys.openpgp.org --recv-keys "$key" || \
      gpg --batch --keyserver keyserver.ubuntu.com --recv-keys "$key" ; \
    done \
    && curl -fsSLO --compressed "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION.tar.xz" \
    && curl -fsSLO --compressed "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt.asc" \
    && gpg --batch --decrypt --output SHASUMS256.txt SHASUMS256.txt.asc \
    && grep " node-v$NODE_VERSION.tar.xz\$" SHASUMS256.txt | sha256sum -c - \
    && tar -xf "node-v$NODE_VERSION.tar.xz" \
    && cd "node-v$NODE_VERSION" \
    && ./configure \
    && make -j$(getconf _NPROCESSORS_ONLN) V= \
    && make install \
    && apk del .build-deps-full \
    && cd .. \
    && rm -Rf "node-v$NODE_VERSION" \
    && rm "node-v$NODE_VERSION.tar.xz" SHASUMS256.txt.asc SHASUMS256.txt; \
  fi \
  && rm -f "node-v$NODE_VERSION-linux-$ARCH-musl.tar.xz" \
  && apk del .build-deps \
  # smoke tests
  && node --version \
  && npm --version
#
# end of docker node stuff
#

# vips required to run sharp library for image comparison
# opencv required for other image processing
RUN echo "http://dl-4.alpinelinux.org/alpine/v3.14/community" >> /etc/apk/repositories \
    && apk --no-cache add vips opencv opencv-dev

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ARG data_dir=/config
VOLUME $data_dir
ENV DATA_DIR=$data_dir

COPY docker/root/ /

WORKDIR /app

FROM base as build

COPY --chown=abc:abc package*.json ./
COPY --chown=abc:abc tsconfig.json .

RUN npm install

COPY --chown=abc:abc . /app

RUN npm run build && rm -rf node_modules

FROM base as app

COPY --from=build --chown=abc:abc /app /app

RUN npm install --production \
    && npm cache clean --force \
    && chown abc:abc node_modules \
    && rm -rf node_modules/ts-node \
    && rm -rf node_modules/typescript

# build bindings for opencv
RUN apk add --no-cache --virtual .build-deps \
    make \
    g++ \
    gcc \
    libgcc \
    && npm run cv-install-docker-prebuild \
    && apk del .build-deps

ENV NPM_CONFIG_LOGLEVEL debug

# can set database to use more performant better-sqlite3 since we control everything
ENV DB_DRIVER=better-sqlite3

# NODE_ARGS are expanded after `node` command in the entrypoint IE "node {NODE_ARGS} src/index.js run"
# by default enforce better memory mangement by limiting max long-lived GC space to 512MB
ENV NODE_ARGS="--max_old_space_size=512"

ARG webPort=8085
ENV PORT=$webPort
EXPOSE $PORT

# convenience variable for more helpful error messages
ENV IS_DOCKER=true

