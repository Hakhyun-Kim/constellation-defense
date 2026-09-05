# Dedicated game-server image (the payment service has its own Dockerfile
# at the repository root). Runs only the authoritative simulation endpoint.
#
#   docker build -f dedicated/Dockerfile -t cd-dedicated .
#   docker run --rm -p 8643:8643 cd-dedicated
#
# Honest status: written for deployment-shaped review; the primary supported
# path is the start-dedicated launchers, and this image has not been executed
# on the development machine (no Docker installed there).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# The dedicated server imports src/ and the shared logger only — no build
# step, no npm dependencies.
COPY package.json ./
COPY dedicated ./dedicated
COPY server/logger.mjs ./server/logger.mjs
COPY src ./src

EXPOSE 8643
ENV DEDICATED_HOST=0.0.0.0 \
    DEDICATED_PORT=8643 \
    LOG_FORMAT=json
USER node
CMD ["node", "dedicated/server.mjs"]
