# Um Dockerfile para todos os apps do monorepo: `--build-arg APP=<app>` escolhe
# qual app, e `--target` escolhe a imagem (runtime ou migrator).
ARG NODE_IMAGE=node:24-alpine

# Dependências completas (com dev): base do build e do migrator. Fica numa camada
# própria, então só reinstala quando package.json ou package-lock.json mudam.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

# Só as dependências de produção, para a imagem de execução. O CLI do Prisma e o
# TypeScript são dev deps, mas também peers opcionais do @prisma/client, e o npm
# os marca como "devOptional": só saem com `--omit=optional`.
FROM deps AS prod-deps
RUN npm prune --omit=dev --omit=optional

FROM deps AS build
ARG APP
COPY . .
RUN npm run prisma:generate && npx nest build ${APP}

# Roda `prisma migrate deploy` e termina. Leva o CLI do Prisma e as migrations,
# que não entram na imagem de execução.
FROM ${NODE_IMAGE} AS migrator
ARG APP
ENV APP=${APP}
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY apps/${APP}/prisma.config.ts apps/${APP}/
COPY apps/${APP}/prisma apps/${APP}/prisma
USER node
CMD ["sh", "-c", "npx prisma migrate deploy --config apps/$APP/prisma.config.ts"]

# Imagem de execução: o bundle do app e as deps de produção, sem código-fonte,
# sem dev deps e sem rodar como root.
FROM ${NODE_IMAGE} AS runtime
ARG APP
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist/apps/${APP} ./dist
USER node
CMD ["node", "dist/main.js"]
