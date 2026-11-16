# One image for the whole site: the API serves the built web app.
# The same image runs the daily ingest: `npm run ingest -w @spil/pipeline`.
FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/pipeline/package.json packages/pipeline/
COPY packages/catalog/package.json packages/catalog/
COPY packages/engine/package.json packages/engine/
COPY packages/api/package.json packages/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build -w @spil/web

ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["npm", "start", "-w", "@spil/api"]
