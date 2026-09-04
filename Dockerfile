# Fly.io 배포용. Render 는 render.yaml 로 빌드하므로 이 파일이 필요 없다.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# esbuild 가 devDependency 라서 --include=dev 가 필요하다. electron 도
# devDependency 지만 런타임에 쓰지 않으므로 바이너리는 받지 않는다.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --include=dev
COPY . .
RUN npm run build

# 런타임은 node 내장 모듈만 쓴다 — server/*.mjs 와 scripts/serve.mjs 어디에도
# 외부 패키지 import 가 없다. 그래서 node_modules 를 통째로 버린다.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY --from=build /app/index.html /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/css ./css
COPY --from=build /app/assets ./assets
COPY --from=build /app/server ./server
COPY --from=build /app/scripts/serve.mjs ./scripts/serve.mjs
EXPOSE 8080
USER node
CMD ["node", "scripts/serve.mjs"]
