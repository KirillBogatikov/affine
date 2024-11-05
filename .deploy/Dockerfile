FROM docker-registry.voopsen/open-source/affine-base AS build-server

RUN yarn workspaces focus @affine/server

RUN yarn workspace @affine/server build

FROM docker-registry.voopsen/open-source/affine-base AS build-web

RUN yarn --immutable --inline-builds; exit 0

RUN yarn nx build @affine/web --skip-nx-cache --verbose

FROM docker-registry.voopsen/open-source/affine-base AS build-admin

RUN yarn --immutable --inline-builds; exit 0

RUN yarn nx build @affine/admin --skip-nx-cache

FROM docker-registry.voopsen/open-source/affine-base AS build-mobile

RUN yarn --immutable --inline-builds; exit 0

RUN yarn nx build @affine/mobile --skip-nx-cache

FROM docker-registry.voopsen/open-source/affine-base AS build-server-native

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y

RUN apt-get update -y
RUN apt-get install -y clang

ENV PATH="/root/.cargo/bin:${PATH}"
ENV CC=clang
ENV TARGET_CC=clang

RUN yarn workspaces focus @affine/server-native

RUN yarn workspace @affine/server-native build --target x86_64-unknown-linux-gnu --use-napi-cross

FROM docker-registry.voopsen/open-source/affine-base as build-all

COPY --from=build-server /src/packages/backend/server /app
COPY --from=build-server-native /src/packages/backend/native/server-native.node /app
COPY --from=build-web /src/packages/frontend/apps/web/dist /app/static
COPY --from=build-mobile /src/packages/frontend/apps/mobile/dist /app/static/mobile
COPY --from=build-admin /src/packages/frontend/admin/dist /app/static/admin

RUN yarn config set --json supportedArchitectures.cpu '["x64", "arm64", "arm"]'
RUN yarn config set --json supportedArchitectures.libc '["glibc"]'
RUN yarn workspaces focus @affine/server --production

RUN yarn workspace @affine/server prisma generate

FROM docker-registry.voopsen/community/node:20

WORKDIR /app

COPY --from=build-all /app /app

RUN apt-get update && \
  apt-get install -y --no-install-recommends openssl

CMD ["node", "--import", "./scripts/register.js", "./dist/index.js"]
