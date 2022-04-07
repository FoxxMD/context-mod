FROM node:16-alpine3.14 as base

ENV TZ=Etc/GMT

# vips required to run sharp library for image comparison
RUN echo "http://dl-4.alpinelinux.org/alpine/v3.14/community" >> /etc/apk/repositories \
    && apk --no-cache add vips

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ARG data_dir=/config
RUN mkdir -p $data_dir && \
    chown -R node:node $data_dir && \
    chmod 755 $data_dir
VOLUME $data_dir
ENV DATA_DIR=$data_dir

# https://github.com/nodejs/docker-node/issues/740
WORKDIR /home/node

FROM base as build

COPY --chown=node:node package*.json ./
COPY --chown=node:node tsconfig.json .

RUN npm install

COPY --chown=node:node . /home/node

RUN npm run build && rm -rf node_modules

FROM base as app

COPY --from=build --chown=node:node /home/node /home/node

RUN npm install --production && npm cache clean --force

ENV NPM_CONFIG_LOGLEVEL debug

# can set database to use more performant better-sqlite3 since we control everything
ENV DB_DRIVER=better-sqlite3

ARG webPort=8085
ENV PORT=$webPort
EXPOSE $PORT

# convenience variable for more helpful error messages
ENV IS_DOCKER=true

USER node

CMD [ "node", "src/index.js", "run" ]
