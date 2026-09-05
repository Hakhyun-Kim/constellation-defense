# Cloud Run 용 이미지.
#
# dist/ 는 저장소에 커밋되어 있으므로(index.html 을 빌드 없이 열 수 있도록)
# 여기서 esbuild 를 돌릴 필요가 없다. 그래서 devDependencies 를 통째로 뺀다 —
# electron 과 three 가 빠지면서 이미지가 크게 줄어든다.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Cloud Run 은 모든 인터페이스 바인딩과 $PORT 수신을 요구한다 — server/index.mjs 의
# 서비스 기본값이 이미 0.0.0.0 이라 HOST 는 명시만 해 둔다.
# Set PUBLIC_URL to the game client origin at deployment time. The service
# requires it in hosted mode; it is not the webhook/API origin when split.
ENV HOST=0.0.0.0 \
    NODE_ENV=production \
    LOG_FORMAT=json \
    STORE_BACKEND=firestore

CMD ["node", "server/index.mjs"]
