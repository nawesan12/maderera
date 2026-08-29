# Maderera Juan B. Justo

Plataforma de la Maderera Juan B. Justo (Mar del Plata, desde 1981). Sitio
público, tienda, panel de gestión, facturación electrónica y portales de
clientes y de profesionales.

Dos sucursales: **Casa Central** y **Aserradero**. Marca propia: **Moldava**.

## Cómo levantarlo

Hace falta Docker (para Postgres) y Node 20 o superior.

```bash
cp .env.example .env.local     # solo hay que completar BETTER_AUTH_SECRET
npm install
npm run db:up                  # Postgres en Docker, puerto 5433
npm run db:migrate
npm run db:seed                # catálogo, sucursales y listas de precios
npm run dev
```

El puerto de la base es el **5433** y no el 5432, porque en la máquina de
desarrollo el 5432 lo ocupa un Postgres del sistema.

Todo lo demás del `.env.local` es opcional: **sin credenciales, cada módulo
—cobros, correo, WhatsApp, ARCA— corre con su proveedor de demostración**. El
circuito completo funciona, no se manda nada real, y la interfaz lo avisa en
pantalla. El archivo `.env.example` explica cada variable y qué pasa si falta.

Para ver las pantallas con datos:

```bash
npm run db:seed-ventas         # clientes, presupuestos, pedidos y cortes
npm run db:seed-contenido      # notas del blog, testimonios y textos del sitio
npm run db:seed-whatsapp       # conversaciones de ejemplo
```

Y para entrar al panel y al portal:

```bash
npm run staff:create -- --email vos@mjbj.com.ar --password Clave123 --name "Tu Nombre" --role admin
npm run cliente:create -- --email <mail de un cliente sembrado> --password Clave123
```

`cliente:create` vincula la cuenta web con una ficha ya sembrada, así el portal
se ve con pedidos y cuenta corriente reales en vez de vacío.

## Cómo está armado

| Capa | Qué usa |
|---|---|
| Framework | Next.js 16, App Router |
| Datos | Postgres + Drizzle ORM |
| Sesión | Better Auth, con `proxy.ts` para los chequeos optimistas |
| Archivos | Disco en desarrollo, Vercel Blob en producción, detrás de la misma interfaz |
| Estilos | Tailwind 4 |

### Reglas que no se negocian

- **La base nunca se toca desde el navegador.** No hay Row Level Security: la
  credencial vive solo en el servidor y toda lectura o escritura pasa por el
  DAL (`lib/dal/`). Eso lo convierte en la única línea de defensa, así que no
  hay atajos: **ninguna query suelta dentro de un componente**.
- **Toda consulta que devuelve datos de una persona filtra por el `userId` de la
  sesión**, obtenido de `verifySession()` y nunca de un parámetro del cliente.
- **Toda mutación pasa por Server Action** que primero valida la sesión y
  después el input con Zod.
- **DTOs explícitos**: se seleccionan columnas, nunca se devuelve la fila entera.
- **El stock no se descuenta desde el front.** Los movimientos van por
  transacción, con su tabla de auditoría.

Antes de abrir una ruta pública que muestre datos de alguien, preguntarse qué la
autoriza. Si la respuesta es "conocer un identificador", ese identificador tiene
que ser impredecible: los números de pedido son consecutivos, así que la página
de seguimiento se autoriza con un token aparte (`lib/seguimiento.ts`).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm test` | Tests (vitest) |
| `npm run lint` | ESLint |
| `npm run build` | Compilación de producción |
| `npm run db:generate` | Genera la migración a partir del esquema |
| `npm run db:migrate` | Aplica las migraciones |
| `npm run db:studio` | Explorador de la base |

Los tests cubren **solo lógica que mueve plata o que rompe algo físico**:
importes, impuestos, plazos, firma de pagos, migración, y el armado del archivo
que va a la máquina de corte. No hay tests de interfaz.

## Documentación

| Archivo | Qué tiene |
|---|---|
| `docs/PLAN.md` | El plan completo: estado, arquitectura, cronograma, riesgos y el relevamiento de las máquinas de corte |
| `docs/CAMBIOS.md` | Cambios de alcance e **insumos que faltan del cliente** |
| `docs/ENTREGAS.md` | Bitácora de entregas |
| `docs/GUIAS/` | Las guías de uso del panel. Se sirven dentro del sistema en `/admin/ayuda` |

Las guías se leen del disco: `next.config.ts` incluye la carpeta con
`outputFileTracingIncludes` para que también estén en producción.

## Datos de desarrollo

El catálogo está sembrado con datos inventados: **los precios y el stock no son
reales**, y casi todos los productos comparten unas pocas fotos genéricas. Se
reemplazan cuando llegue la exportación del sistema anterior (ISIS ERP Manager)
y las fotos del cliente. La migración se corre desde `/admin/migracion`.
