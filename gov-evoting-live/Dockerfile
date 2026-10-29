# The e-voting server as a container. Built in two stages so the final image holds no build tools.
# NODE_ENV is deliberately NOT "production": this build still runs the demo-only mock Aadhaar service,
# which the server refuses to start with in production mode.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Only the packages the pages need (esbuild, ethers, hashing): skips Hardhat, which is large and
# would make the build slow or run out of memory on a small 1 GB server.
RUN npm ci --omit=dev
COPY frontend ./frontend
COPY lib ./lib
RUN node frontend/build.js

FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend ./backend
COPY lib ./lib
COPY scripts ./scripts
COPY artifacts/contracts/GovElection.sol/GovElection.json ./artifacts/contracts/GovElection.sol/GovElection.json
COPY --from=build /app/frontend/public ./frontend/public
# /data holds the database. It MUST be a persistent volume: if it is lost, voters could be issued
# a second voting token.
RUN mkdir -p /data /app/ceremony && chown -R node:node /data /app
USER node
EXPOSE 3000
VOLUME ["/data"]
# On the very first start there are no demo voters yet, so create them (5 fake citizens, 4 on the roll).
# The fake voter IDs are printed once in the logs: docker compose logs app
CMD ["sh", "-c", "[ -f \"$MOCK_UIDAI_FILE\" ] || node scripts/seed-mock.js ${SEED_CITIZENS:-5} ${SEED_ON_ROLL:-4}; exec node backend/server.js"]
