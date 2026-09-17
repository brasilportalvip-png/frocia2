FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates tini \
  && groupadd --gid 10001 sandbox \
  && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin sandbox \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /worker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chromium
COPY *.mjs ./

ENV NODE_ENV=production PORT=8080
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
