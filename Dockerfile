FROM node:18.18-alpine as build

WORKDIR /app

RUN apk add --update git

COPY . .

RUN npm i -g hathora@0.12.2
RUN npx hathora build --only server

FROM node:18.18-alpine

WORKDIR /app

# https://github.com/uNetworking/uWebSockets.js/discussions/346#discussioncomment-1137301
RUN apk add --no-cache libc6-compat
RUN ln -s /lib/libc.musl-x86_64.so.1 /lib/ld-linux-x86-64.so.2

COPY --from=build /app/server/dist server/dist

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

CMD ["node", "server/dist/index.mjs"]
