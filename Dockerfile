FROM node:16-alpine3.14 as base

ENV TZ=Etc/GMT

# vips required to run sharp library for image comparison
RUN echo "http://dl-4.alpinelinux.org/alpine/v3.14/community" >> /etc/apk/repositories \
    && apk --no-cache add vips

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /usr/app

FROM base as build

COPY package*.json ./
COPY tsconfig.json .

RUN npm install

ADD . /usr/app

RUN npm run build && rm -rf node_modules

FROM base as app

COPY --from=build /usr/app /usr/app

RUN npm install --production

ENV NPM_CONFIG_LOGLEVEL debug

ARG data_dir=/home/node/data
RUN mkdir -p data_dir
VOLUME $data_dir
ENV DATA_DIR=$data_dir

ARG webPort=8085
ENV PORT=$webPort
EXPOSE $PORT

CMD [ "node", "src/index.js", "run" ]
