/**
 * Lo que se ve mientras una pantalla del panel trae sus datos.
 *
 * Es la silueta de un listado y no una ruedita: ocupa el mismo lugar que va a
 * ocupar el contenido, así que la página no salta cuando llega. Con la
 * navegación entre secciones esto es lo que se ve durante la consulta, y sin
 * esto la pantalla anterior queda congelada sin señal de que algo está
 * pasando.
 *
 * Tiene forma de tarjetas, como casi todas las pantallas del panel: la de
 * tabla hacía saltar la página cuando llegaba el contenido.
 */
export default function CargandoPanel() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-hundida" />
        <div className="h-5 w-72 animate-pulse rounded-lg bg-hundida" />
      </div>
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 w-32 animate-pulse rounded-lg bg-hundida" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="tarjeta flex gap-4 p-4">
            <div className="h-20 w-20 shrink-0 animate-pulse rounded-lg bg-hundida" />
            <div className="flex-1 space-y-2.5 py-1">
              <div className="h-5 w-3/5 animate-pulse rounded bg-hundida" />
              <div className="h-4 w-2/5 animate-pulse rounded bg-hundida" />
              <div className="h-4 w-1/4 animate-pulse rounded bg-hundida" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
