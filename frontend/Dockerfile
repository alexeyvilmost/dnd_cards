# Этап 1: сборка production-бандла
FROM node:18-slim AS build

WORKDIR /app

COPY package*.json ./

RUN npm config set cache /tmp/.npm && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 3

RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

COPY . .

# VITE_API_URL задаётся в Railway как build-time variable
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npx vite build

# Этап 2: nginx раздаёт статику (надёжнее serve на Railway)
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template

ENV PORT=8080
EXPOSE 8080

CMD ["/bin/sh", "-c", "envsubst '${PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
