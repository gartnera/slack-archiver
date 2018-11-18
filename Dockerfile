FROM node:10-alpine

RUN mkdir /app
WORKDIR /app
COPY . .
RUN npm install
