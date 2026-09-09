FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# WhatsApp session + alert state live here — mount a volume at /data.
ENV SOLARWATCH_DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /app /data
USER node
VOLUME ["/data"]

CMD ["node", "src/index.js"]
