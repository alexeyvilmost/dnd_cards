# syntax=docker/dockerfile:1
# Context: repository root. Benchmarks may override images with pinned digests.
ARG NODE_IMAGE=node:24-slim
ARG NGINX_IMAGE=nginx:alpine
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
ARG BUILD_CACHE_SCOPE=bagofholding-frontend
RUN --mount=type=cache,id=${BUILD_CACHE_SCOPE}-npm,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --include=dev --no-audit --no-fund

FROM dependencies AS build
COPY scripts/release/write-build-identity.mjs /app/scripts/release/write-build-identity.mjs
# Local enabled UI experiments do not yet have an accepted OCI input contract.
# Reject explicit enablement instead of silently ignoring an unbound bundle.
ARG VITE_MEDIA_VARIANTS=0
ARG MEDIA_VARIANTS_BUNDLE
RUN node --input-type=module -e "import {assertOCIMediaDisabled} from '/app/scripts/release/write-build-identity.mjs'; assertOCIMediaDisabled(process.env)"
COPY frontend/index.html frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/postcss.config.js frontend/tailwind.config.js ./
COPY frontend/scripts/check-dice-box-assets.mjs ./scripts/check-dice-box-assets.mjs
COPY frontend/scripts/pwa-shell.mjs ./scripts/pwa-shell.mjs
COPY frontend/scripts/media-variants.mjs ./scripts/media-variants.mjs
COPY frontend/utils ./utils
COPY frontend/charges/charges.json ./charges/charges.json
COPY backend/animationpresentation/catalog.json /app/backend/animationpresentation/catalog.json
COPY backend/audiopresentation/catalog.json /app/backend/audiopresentation/catalog.json
# Guarded DiceBox and PWA inputs affect compilation; other media does not.
COPY frontend/public/assets/dice-box ./public/assets/dice-box
COPY frontend/public/site_logo.png frontend/public/pwa-192x192.png frontend/public/pwa-512x512.png ./public/
COPY frontend/src ./src
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
# Keep TypeScript, Vite and both canonical DiceBox checks mandatory.
RUN npm run build
ARG COMPONENT_SOURCE_COMMIT
ARG COMPONENT_INPUT_FINGERPRINT
RUN node /app/scripts/release/write-build-identity.mjs frontend /app/component-identity.json

FROM ${NGINX_IMAGE}
RUN rm -f /etc/nginx/conf.d/default.conf
# UI edits reuse the large media layer; media edits reuse application compilation.
COPY frontend/public /usr/share/nginx/html
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf.template /etc/nginx/templates/app.conf.template
COPY frontend/start.sh /start.sh
COPY frontend/write-build-info.sh /write-build-info.sh
COPY --from=build /app/component-identity.json /opt/bagofholding/component-identity.json
RUN sed -i 's/\r$//' /start.sh /write-build-info.sh && chmod +x /start.sh /write-build-info.sh
ENV PORT=3000
EXPOSE 3000
CMD ["/start.sh"]
