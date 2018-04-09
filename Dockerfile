FROM node:latest
ENV TERM=xterm

USER root

WORKDIR /home/node

COPY package.json /home/node

RUN npm install

COPY index.js config.js /home/node/
COPY public /home/node/public

CMD ["npm", "start"]