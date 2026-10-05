# syntax=docker/dockerfile:1
ARG GO_IMAGE=golang:1.25-alpine
ARG ALPINE_IMAGE=alpine:3.22
FROM ${GO_IMAGE} AS build
WORKDIR /src
COPY go.mod go.sum ./
ARG BUILD_CACHE_SCOPE=bagofholding-backend
RUN --mount=type=cache,id=${BUILD_CACHE_SCOPE}-gomod,target=/go/pkg/mod,sharing=locked go mod download
COPY . .
ARG COMPONENT_SOURCE_COMMIT
ARG COMPONENT_INPUT_FINGERPRINT
RUN if [ -n "$COMPONENT_SOURCE_COMMIT$COMPONENT_INPUT_FINGERPRINT" ]; then \
      printf '%s' "$COMPONENT_SOURCE_COMMIT" | grep -Eq '^[a-f0-9]{40}$' && \
      printf '%s' "$COMPONENT_INPUT_FINGERPRINT" | grep -Eq '^sha256:[a-f0-9]{64}$'; fi
RUN --mount=type=cache,id=${BUILD_CACHE_SCOPE}-gomod,target=/go/pkg/mod,sharing=locked \
    --mount=type=cache,id=${BUILD_CACHE_SCOPE}-gobuild,target=/root/.cache/go-build,sharing=locked \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X main.componentSourceCommit=${COMPONENT_SOURCE_COMMIT} -X main.componentInputFingerprint=${COMPONENT_INPUT_FINGERPRINT}" -o /out/dnd-cards .

FROM ${ALPINE_IMAGE}
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app
WORKDIR /app
COPY --from=build --chown=app:app /out/dnd-cards /app/dnd-cards
USER app
EXPOSE 8080
ENTRYPOINT ["/app/dnd-cards"]
