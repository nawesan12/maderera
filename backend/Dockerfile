# La imagen del backend en Go: un solo binario (`mjbj`) que cada servicio del
# compose corre con su papel (`mjbj correo`, y más adelante `mjbj api`,
# `mjbj worker`…). Ver docs/go/PLAN.md.
#
# Tres etapas y solo la última llega al servidor: la SPA del webmail se
# compila con Node, el binario con Go (y la SPA adentro, con go:embed), y lo
# que corre es una imagen distroless con el binario solo —sin shell, sin
# paquetes, unos 20 MB—.

FROM node:24-alpine AS web-correo
WORKDIR /web
COPY web/correo/package.json web/correo/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/correo/ ./
RUN npm run build


FROM golang:1.27-alpine AS binario
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=web-correo /web/dist ./web/correo/dist
# Estático (CGO_ENABLED=0) para correr en distroless; -trimpath para que las
# rutas de esta máquina no queden en el binario.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /mjbj ./cmd/mjbj


FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=binario /mjbj /mjbj
USER nonroot:nonroot
ENTRYPOINT ["/mjbj"]
