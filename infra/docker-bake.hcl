# Invoke from repository root: docker buildx bake -f infra/docker-bake.hcl
# Base images may be overridden with digest-pinned refs in the environment.
variable "GO_IMAGE" { default = "golang:1.25-alpine" }
variable "ALPINE_IMAGE" { default = "alpine:3.22" }
variable "NODE_IMAGE" { default = "node:24-slim" }
variable "NGINX_IMAGE" { default = "nginx:alpine" }
variable "BACKEND_SOURCE_COMMIT" { default = "" }
variable "BACKEND_INPUT_FINGERPRINT" { default = "" }
variable "FRONTEND_SOURCE_COMMIT" { default = "" }
variable "FRONTEND_INPUT_FINGERPRINT" { default = "" }
variable "WORKER_SOURCE_COMMIT" { default = "" }
variable "WORKER_INPUT_FINGERPRINT" { default = "" }

group "default" { targets = ["backend", "frontend", "worker"] }
target "backend" {
  context = "./backend"
  dockerfile = "Dockerfile"
  args = { GO_IMAGE = GO_IMAGE, ALPINE_IMAGE = ALPINE_IMAGE, COMPONENT_SOURCE_COMMIT = BACKEND_SOURCE_COMMIT, COMPONENT_INPUT_FINGERPRINT = BACKEND_INPUT_FINGERPRINT }
}
target "frontend" {
  context = "."
  dockerfile = "frontend/Dockerfile"
  args = { NODE_IMAGE = NODE_IMAGE, NGINX_IMAGE = NGINX_IMAGE, VITE_API_URL = "", COMPONENT_SOURCE_COMMIT = FRONTEND_SOURCE_COMMIT, COMPONENT_INPUT_FINGERPRINT = FRONTEND_INPUT_FINGERPRINT }
}
target "worker" {
  context = "."
  dockerfile = "infra/Dockerfile.rules-worker"
  args = { NODE_IMAGE = NODE_IMAGE, COMPONENT_SOURCE_COMMIT = WORKER_SOURCE_COMMIT, COMPONENT_INPUT_FINGERPRINT = WORKER_INPUT_FINGERPRINT }
}
