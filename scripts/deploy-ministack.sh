#!/bin/sh
# Despliega la lambda (imagen container) en MiniStack: crea el repositorio ECR, construye la
# imagen con el Docker local usando la URI de ese repositorio y aplica el resto de unidades.
set -e
cd "$(dirname "$0")/.."

export IMAGE_TAG="${IMAGE_TAG:-local}"
export TG_ROOT_FILE="${TG_ROOT_FILE:-ministack.hcl}"

terragrunt apply --working-dir aws/ecr --backend-bootstrap -auto-approve
repository_url=$(terragrunt output --working-dir aws/ecr -raw ecr_repository_url)

image="${repository_url}:${IMAGE_TAG}"
previous_image=$(docker images --quiet --no-trunc "$image")
docker build --tag "$image" .
current_image=$(docker images --quiet --no-trunc "$image")

# MiniStack reutiliza el contenedor ya levantado de la lambda: como el tag no cambia, hay que
# eliminar los que siguen corriendo la imagen anterior para que la proxima invocacion use la nueva.
if [ -n "$previous_image" ] && [ "$previous_image" != "$current_image" ]; then
  stale=$(docker ps --quiet --filter label=ministack=lambda --filter "ancestor=$previous_image")
  [ -z "$stale" ] || docker rm --force $stale
fi

terragrunt run --all --working-dir aws --backend-bootstrap apply -- -auto-approve
