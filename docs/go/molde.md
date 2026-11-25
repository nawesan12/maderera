# El molde: cómo se muda un módulo a Go

Lo que hicieron las tandas 1–3, para que cada tanda nueva salga igual. Leé
también las reglas y «Lo aprendido» de [progreso.md](progreso.md).

## Los pasos

1. **Leer el TS entero** del módulo: acciones (`app/**/actions.ts`), DAL
   (`lib/dal/**`), lógica (`lib/<módulo>/**`), rutas (`app/api/**`), trabajos
   de la cola y tareas de `lib/tareas`. Anotar qué candados toma
   (`pg_advisory_xact_lock`), qué numeración usa, qué escribe en la bitácora y
   qué revalida.
2. **Golden de la lógica pura** (`scripts/golden/<módulo>.ts` → 
   `backend/testdata/golden/<módulo>/*.json`): corre el TS real —o una copia
   textual de una función no exportada, con el commit de origen anotado— sobre
   los casos de vitest más miles al azar con semilla. Los esquemas de zod
   también: el primer error (mensaje y campo) o los datos ya transformados.
   Go compara **exacto**.
3. **Consultas** en `backend/db/consultas/<módulo>.sql`, `~/go/bin/sqlc
   generate` desde `backend/`. Si sqlc pierde la nulabilidad (casts,
   `coalesce`, `nullif`, subconsultas), traé la columna cruda y formateá en
   Go, o escribí esa consulta a mano con pgx.
4. **Servicio** en `backend/internal/<módulo>/`: la lógica, con los mismos
   mensajes de error que el TS (`plataforma.Invalido(map[campo]mensaje)`), la
   bitácora (`bitacora.Anotar`) y los mismos candados y numeración.
5. **Contrato** `backend/api/<módulo>.yaml` + `<módulo>.gen.yaml` (copiá el
   de contenido cambiando el nombre) + una línea en `api/generar.go`;
   `go generate ./api`. Los handlers en `internal/<módulo>/http.go` con el
   tipo `respuesta` (ver `internal/stock/http.go`); permisos con
   `auth.Exigir(ctx, roles.QuienEntra("/admin/<pantalla>")...)` (el mismo
   ACCESO que la pantalla) o `auth.ExigirStaff`. Registrar en
   `cmd/mjbj/api.go` (handler + `GetSwagger` en los validadores).
6. **Pruebas de Go** contra la base (`pruebas.Base(t)`, con
   `MJBJ_PRUEBA_BASE=postgres://postgres:prueba@127.0.0.1:55480/postgres`) y
   el contrato en cada respuesta (`pruebas.ConContrato`). Las de
   concurrencia: correrlas **sin** el arreglo y verlas fallar.
7. **Next**: `npm run api:gen`, sumar el dominio a `lib/api/tipos/index.ts`,
   y reescribir el DAL y las acciones como envoltorios (`api()` con la
   cookie, `apiPublica` para lo cacheado, `comoFormulario` + `soloCampos`
   para multipart). Las acciones conservan su firma, su `EstadoX` y sus
   `revalidatePath`/`updateTag`. Borrar el TS que quedó sin uso.
8. **E2E** en `e2e/<módulo>.spec.ts` con `test.use({ storageState:
   SESION_ADMIN })`; dejar los datos de desarrollo como estaban.
9. **Benchmark** en `bench/<tanda>/` (TS de antes contra Go, mismo trabajo,
   misma base), y los números en progreso.md.
10. `gofmt -l . && go vet ./... && go test ./...`, `npx tsc --noEmit -p .`,
    `npx vitest run`, commit por bloque.

## Lo que no se negocia

- La plata en float64 con `internal/jsmath` (`Round`, `ToFixed`, `Fijo2`,
  `Numero`, `Texto`), nunca decimal ni `math.Round`.
- Mismos candados (mismas claves) y misma numeración que el TS.
- Las URLs que llama alguien de afuera no cambian.
- Un bug del TS se arregla solo si es claro y queda probado (como el candado
  del stock en la tanda 3); si no, se reproduce y se anota.
- Nada de `.env` en comandos (hay un hook que lo bloquea).
