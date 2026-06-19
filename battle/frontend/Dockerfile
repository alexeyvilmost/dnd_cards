# battle_frontend — React (Vite) SPA built and served by nginx, proxying API
# calls to battle_backend.

# ── Build stage ──
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# ── Runtime stage ──
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html

# Config template — rendered at startup with $PORT and $BACKEND_URL (envsubst,
# restricted var list so nginx's own $uri/$host are left intact).
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template

# Railway sets $PORT; BACKEND_URL points at the battle_backend service
# (e.g. http://battle-backend.railway.internal:8000 or the public backend URL).
ENV PORT=8080
ENV BACKEND_URL=http://battle-backend:8000
EXPOSE 8080

CMD ["/bin/sh", "-c", "envsubst '${PORT} ${BACKEND_URL}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
