import { DatabaseZap } from "lucide-react";

/**
 * Lo que se ve cuando el panel no puede resolver quién entró.
 *
 * No muestra ni un dato del negocio, a propósito: si no se sabe quién está del
 * otro lado, lo correcto es no mostrar nada. Lo único que aporta sobre la
 * pantalla de error genérica es contexto —quien la ve es alguien del local
 * tratando de trabajar, no un visitante— y una salida al sitio público, que
 * suele seguir en pie porque buena parte de lo suyo está cacheado.
 *
 * No lleva botón de reintentar propio: recargar la página es el reintento, y en
 * una pantalla que se muestra justamente porque algo del servidor no responde,
 * un botón que parece hacer algo y no hace nada es peor que ninguno.
 */
export function PanelNoDisponible() {
  return (
    <div className="panel flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-8 text-center text-foreground">
      <span className="estado-problema flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--estado-fondo)] text-[var(--estado-tinta)]">
        <DatabaseZap className="h-8 w-8" />
      </span>

      <div className="max-w-md">
        <h1 className="text-3xl font-bold tracking-tight">
          El panel no está disponible
        </h1>
        <p className="mt-2.5 text-lg leading-relaxed text-muted-foreground">
          No se pudo conectar con la base de datos, así que no podemos confirmar
          tu acceso. Recargá la página en un momento.
        </p>
      </div>

      {/* `<a>` y no `<Link>` a propósito, por eso la regla va desactivada: esta
          es una pantalla de recuperación, y una navegación del lado del cliente
          reutiliza el estado de la aplicación que ya está en problemas. Una
          carga entera vuelve a pedirle todo al servidor, que es lo que se
          quiere cuando algo no anda. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="inline-flex h-12 items-center rounded-xl border border-linea px-6 text-base font-semibold transition-colors hover:bg-hundida"
      >
        Ir al sitio
      </a>
    </div>
  );
}
