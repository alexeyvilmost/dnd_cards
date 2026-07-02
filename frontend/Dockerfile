# Этап 1: сборка production-бандла
FROM node:20-slim AS build

WORKDIR /app

COPY package*.json ./

RUN npm config set cache /tmp/.npm && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm config set fetch-retries 3

RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

COPY . .

ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}

RUN npx vite build

# Этап 2: nginx раздаёт статику
FROM nginx:alpine

RUN rm -f /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/app.conf.template
COPY start.sh /start.sh
RUN chmod +x /start.sh

# 3000 — исторический порт фронтенда на Railway (vite dev)
ENV PORT=3000
EXPOSE 3000

CMD ["/start.sh"]
