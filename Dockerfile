# syntax=docker/dockerfile:1

# Imagen de la aplicación, para correr en un servidor propio.
#
# Cuatro etapas, y la última es la única que llega a producción: el servidor
# `standalone`, los estáticos y nada más. Es lo que permite reconstruir y
# desplegar en una máquina chica sin que el despliegue tarde una eternidad.
#
# La etapa `migrador` es aparte a propósito. Correr las migraciones necesita
# `drizzle-kit` con todas sus dependencias, que el servidor no usa y que el
# empaquetado `standalone` deja afuera. El intento anterior copiaba la carpeta
# de `drizzle-kit` sola a la imagen final, y eso no anda: le faltan esbuild y
# compañía. Con una etapa propia que sale de `deps`, la imagen del migrador
# reusa la capa de `node_modules` que ya se construyó y no ocupa disco de más.

FROM node:24-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1


FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci


# Las migraciones y los scripts de mudanza (`scripts/mudar-subidas.ts`).
#
# Corre como el mismo usuario que la aplicación (1001) para que lo que escriba
# en el volumen de subidas lo pueda borrar después el panel.
FROM deps AS migrador
COPY drizzle.config.ts tsconfig.json ./
COPY drizzle ./drizzle
COPY lib/db/schema ./lib/db/schema
COPY scripts ./scripts
RUN mkdir -p /datos/subidas /datos/privado && chown 1001:1001 /datos/subidas /datos/privado
ENV HOME=/tmp
USER 1001:1001
CMD ["node_modules/.bin/drizzle-kit", "migrate"]


FROM deps AS build
COPY . .

# El build **necesita la base**, y conviene saberlo antes de que falle: Next
# prerenderiza las páginas públicas —«Quiénes somos», sucursales, contacto— y
# esas leen los ajustes del sitio, las sucursales y los avisos. Sin base, el
# build no termina.
#
# En el servidor propio no es problema: la base corre en la misma máquina, así
# que el build se hace contra ella por la red del host. El compose se encarga
# de pasar la URL.
#
# La contraseña queda en el historial de esta imagen. Es aceptable porque la
# imagen no sale de la máquina donde se construye; si alguna vez se publicara
# en un registro, hay que pasar a `--secret`.
ARG DATABASE_URL
ARG DATABASE_SSL=off
ENV DATABASE_URL=$DATABASE_URL
ENV DATABASE_SSL=$DATABASE_SSL

# Lo que se hornea en las páginas estáticas: `robots.txt` decide si se indexa
# con `APP_ENV` y `SEO_INDEXAR`, y las canónicas y el `metadataBase` salen de
# `APP_URL`. Si llegaran recién al arrancar, la página ya estaría armada con
# los valores por omisión.
ARG APP_URL
ARG APP_ENV=production
ARG SEO_INDEXAR
ENV APP_URL=$APP_URL
ENV APP_ENV=$APP_ENV
ENV SEO_INDEXAR=$SEO_INDEXAR

# Better Auth se carga mientras se prerenderiza y, sin estas dos, llena el
# registro del build de errores que no son: «falta el secreto», «falta la URL».
# El secreto de acá es de mentira y **solo vive en esta etapa**: la imagen final
# sale de `runner`, que no lo hereda, y el verdadero llega al arrancar por el
# `env_file`. Nada de lo que se prerenderiza firma ni lee una sesión.
ENV BETTER_AUTH_URL=$APP_URL
ENV BETTER_AUTH_SECRET=solo-para-el-build-no-firma-nada-real-000000

# La API de Go: lo público en caché (rubros, sucursales, el equipaje del
# asistente) se arma en el build y sus datos salen de ahí. La pasa el compose
# (loopback del servidor, como la base); en la imagen final la pisa el
# `environment` del compose con la red interna.
ARG API_URL
ENV API_URL=$API_URL

# El commit, para el identificador del build (ver `next.config.ts`). Adentro
# del build no hay `.git`: lo pasa `scripts/desplegar.sh`.
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA

RUN npm run build


FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Sin privilegios: si algún día alguien consigue ejecutar algo dentro del
# contenedor, que no sea como root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

# Las carpetas donde se monta un volumen tienen que existir en la imagen y
# ser del usuario de la aplicación. Un volumen nuevo hereda el dueño de la
# carpeta que tapa; si la carpeta no existe, nace de root y la primera foto que
# se sube desde el panel falla con «permission denied».
RUN mkdir -p .next/cache /datos/subidas /datos/privado \
  && chown -R nextjs:nodejs .next/cache /datos/subidas /datos/privado

USER nextjs
EXPOSE 3000

# `node` directo y no `npm start`: así es el proceso 1 del contenedor y recibe
# el SIGTERM de `docker stop`. Next lo atiende solo —deja de aceptar pedidos,
# termina los que están en curso y corre lo pendiente de `after()`— antes de
# salir; el compose le da treinta segundos para eso.
CMD ["node", "server.js"]
