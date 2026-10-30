import "server-only";

/**
 * Base pública del sitio, para armar los enlaces de los correos y avisos.
 *
 * Los cobros y las credenciales de Mercado Pago son de Go desde la tanda 6
 * (backend/internal/pagos: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`,
 * `PAGOS_PROVIDER` y la misma `APP_URL` van en el entorno de `api` y
 * `worker`). Esto queda porque lo usan las plantillas de correo.
 *
 * En un servidor propio no hay de dónde adivinar el dominio, y por eso ahí
 * `APP_URL` es obligatoria (ver `lib/entorno.ts`).
 */
export function urlBase(): string {
  const explicita = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (explicita) return explicita.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return "http://localhost:3000";
}
