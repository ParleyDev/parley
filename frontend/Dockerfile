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
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80 443
