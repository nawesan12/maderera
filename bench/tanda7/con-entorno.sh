#!/usr/bin/env bash
# Corre un comando con las variables del benchmark de la tanda 7: la base
# bench_t7, el ARCA simulado en :8407 con el certificado que escribe
# bin/simulador-arca en ./arca, y el secreto interno de la API.
dir="$(cd "$(dirname "$0")" && pwd)"
export DATABASE_URL="postgres://postgres:prueba@127.0.0.1:55480/bench_t7?sslmode=disable"
export DATABASE_POOL_MAX=20
export BETTER_AUTH_SECRET=secreto-del-bench-de-la-tanda-7-de-32
export BETTER_AUTH_URL=http://localhost:3100
export API_SECRETO_INTERNO=secreto-interno-del-bench-t7
export ARCA_CUIT=30589445259
export ARCA_CERTIFICADO_ARCHIVO="$dir/arca/cert.pem"
export ARCA_CLAVE_PRIVADA_ARCHIVO="$dir/arca/clave.pem"
export ARCA_URL_WSAA=http://127.0.0.1:8407/ws/services/LoginCms
export ARCA_URL_WSFE=http://127.0.0.1:8407/wsfev1/service.asmx
exec "$@"
