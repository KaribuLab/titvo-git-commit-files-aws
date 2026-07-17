# Imagen de runtime para el lambda de git-commit-files (modo container).
# Base lambda de AWS + git + openssh-client para clonar repos por SSH
# (evita el rate limit 429 de la API en full scan).
FROM public.ecr.aws/lambda/nodejs:22

# Instalar git y openssh-client (Amazon Linux 2023)
RUN dnf install -y git openssh-clients && dnf clean all

WORKDIR ${LAMBDA_TASK_ROOT}

# Dependencias de build (rspack/ts) y de runtime
COPY package.json package-lock.json ${LAMBDA_TASK_ROOT}/
RUN npm ci

# Código fuente
COPY tsconfig.json rspack.config.cjs ${LAMBDA_TASK_ROOT}/
COPY src ${LAMBDA_TASK_ROOT}/src

# Compilar el handler con rspack -> build/src/entrypoint.mjs
RUN npm run build \
  && cp build/src/entrypoint.mjs ${LAMBDA_TASK_ROOT}/entrypoint.mjs \
  && cp build/src/entrypoint.mjs.map ${LAMBDA_TASK_ROOT}/entrypoint.mjs.map 2>/dev/null || true \
  && rm -rf ${LAMBDA_TASK_ROOT}/src ${LAMBDA_TASK_ROOT}/build

# Handler: entrypoint.mjs (módulo ES) expone handler
CMD [ "entrypoint.handler" ]
