FROM node:16-alpine3.12

ENV TZ=Etc/GMT

RUN apk update

RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node

WORKDIR /home/node/app

COPY package*.json ./
COPY tsconfig.json ./

USER node

COPY --chown=node:node . .

RUN npm install
RUN npm run build

ENV NPM_CONFIG_LOGLEVEL debug

ARG log_dir=/home/node/logs
RUN mkdir -p $log_dir
VOLUME $log_dir
ENV LOG_DIR=$log_dir

CMD [ "node", "index.js" ]
