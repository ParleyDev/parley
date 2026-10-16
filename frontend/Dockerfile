FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/40-selfsigned-cert.sh /docker-entrypoint.d/40-selfsigned-cert.sh
COPY docker-entrypoint.d/45-letsencrypt-cert.sh /docker-entrypoint.d/45-letsencrypt-cert.sh
RUN chmod +x /docker-entrypoint.d/*.sh && mkdir -p /var/www/certbot
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80 443
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=5 CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
