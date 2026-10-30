# syntax=docker/dockerfile:1.7
# Angular static app served by Nginx; API routing stays on the private network.
FROM node:22-alpine AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
RUN npm run build -- --configuration production

FROM builder AS test
# Frontend tests inspect the canonical backend timeline JSON files.
COPY backend/src/islamtrove/data/alignments/ /backend/src/islamtrove/data/alignments/
RUN npm test

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/islamtrove/browser/ /usr/share/nginx/html/
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
