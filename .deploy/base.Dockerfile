FROM docker-registry.voopsen/community/node:20

WORKDIR /src

COPY .. .

RUN ./scripts/set-version.sh internal

ENV BUILD_TYPE=canary
ENV SELF_HOSTED=true

RUN yarn config set nmMode classic && \
    yarn config set enableScripts true
