# battle_frontend — static UI served by nginx, proxying API calls to battle_backend.
FROM nginx:alpine

# UI assets (index/characters/spellbook + spell_data.js + icons) under /static/
COPY static/ /usr/share/nginx/html/static/

# Config template — rendered at startup with $PORT and $BACKEND_URL (envsubst,
# restricted var list so nginx's own $uri/$host are left intact).
COPY nginx.conf.template /etc/nginx/conf.d/default.conf.template

# Railway sets $PORT; BACKEND_URL points at the battle_backend service
# (e.g. http://battle-backend.railway.internal:8000 or the public backend URL).
ENV PORT=8080
ENV BACKEND_URL=http://battle-backend:8000
EXPOSE 8080

CMD ["/bin/sh", "-c", "envsubst '${PORT} ${BACKEND_URL}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
