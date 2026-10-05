# Opt-in GitHub Actions overlay, for the future gated REL-04 workflow only.
# This file alone never dispatches CI, pushes images or configures a registry.
# docker buildx bake -f infra/docker-bake.hcl -f infra/docker-bake.cache-gha.hcl
target "backend" {
  cache-from = ["type=gha,scope=bagofholding-backend"]
  cache-to = ["type=gha,scope=bagofholding-backend,mode=max"]
}
target "frontend" {
  cache-from = ["type=gha,scope=bagofholding-frontend"]
  cache-to = ["type=gha,scope=bagofholding-frontend,mode=max"]
}
target "worker" {
  cache-from = ["type=gha,scope=bagofholding-worker"]
  cache-to = ["type=gha,scope=bagofholding-worker,mode=max"]
}
