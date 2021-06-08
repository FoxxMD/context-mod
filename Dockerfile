FROM node:16-alpine3.12

ENV TZ=Etc/GMT

RUN apk update

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

WORKDIR /usr/app

COPY package*.json ./
COPY tsconfig.json .

RUN npm install

ADD . /usr/app

RUN npm run build

ENV NPM_CONFIG_LOGLEVEL debug

ARG log_dir=/home/node/logs
RUN mkdir -p $log_dir
VOLUME $log_dir
ENV LOG_DIR=$log_dir

ENV CLIENT_ID=''
ENV CLIENT_SECRET=''
ENV ACCESS_TOKEN=''
ENV REFRESH_TOKEN=''

CMD [ "node", "src/index.js", "run" ]
