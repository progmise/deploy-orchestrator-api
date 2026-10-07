# Self-contained image: npm ci (prod) → node runtime serving /api.
# Used by `docker build` AND Vercel (builds the root Dockerfile). Pinned
# tag+digest — bump deliberately (CSA scans this exact image).
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
# Bump packages with known fixes beyond the pinned base (CSA findings)
RUN apk upgrade --no-cache libexpat
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# The runtime only executes `node src/index.js` — remove npm entirely:
# its bundled deps (brace-expansion/undici/tar/…) carry known CVEs
RUN npm ci --omit=dev && npm cache clean --force \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
