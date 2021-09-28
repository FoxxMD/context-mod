FROM node:16-alpine3.12

ENV TZ=Etc/GMT

RUN apk update

# required dependencies in order to compile linux-musl (node-canvas) on alpine
# https://github.com/node-gfx/node-canvas-prebuilt/issues/77#issuecomment-884365161
RUN apk add --no-cache build-base g++ cairo-dev jpeg-dev pango-dev giflib-dev
# required dependencies in order to compile linux-musl (node-canvas) on alpine
RUN apk add --update --repository http://dl-3.alpinelinux.org/alpine/edge/testing libmount ttf-dejavu ttf-droid ttf-freefont ttf-liberation ttf-ubuntu-font-family fontconfig

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /usr/app

COPY package*.json ./
COPY tsconfig.json .

# no prebuild support for node-canvas on alpine so need to compile
# https://github.com/Automattic/node-canvas#compiling
RUN npm install --build-from-source

ADD . /usr/app

RUN npm run build

ENV NPM_CONFIG_LOGLEVEL debug

ARG log_dir=/home/node/logs
RUN mkdir -p $log_dir
VOLUME $log_dir
ENV LOG_DIR=$log_dir

ARG webPort=8085
ENV PORT=$webPort
EXPOSE $PORT

CMD [ "node", "src/index.js", "run" ]
