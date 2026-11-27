/**
 * La silueta de Mi cuenta mientras llega: el saludo, la navegación y una
 * tarjeta. Usaba la del catálogo, ocho tarjetas de producto con foto que a
 * 375 px medían 9.300 px de alto (mes simulado, M2S2-118).
 */
export function CargandoCuenta() {
  return (
    <div className="min-h-screen bg-sitio-alt" aria-label="Cargando tu cuenta" aria-busy="true">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:py-10">
        <div className="mb-4 space-y-2 lg:mb-[26px]">
          <div className="h-4 w-12 animate-pulse rounded bg-hundida" />
          <div className="h-8 w-56 max-w-full animate-pulse rounded-lg bg-hundida sm:h-10" />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[236px_minmax(0,1fr)] lg:gap-[26px]">
          <div className="grid grid-cols-4 gap-1.5 lg:grid-cols-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[58px] animate-pulse rounded-[10px] bg-hundida lg:h-11" />
            ))}
          </div>
          <CargandoContenido />
        </div>
      </div>
    </div>
  );
}

/** Entre secciones el saludo y la navegación ya están: solo el contenido. */
export function CargandoContenido() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-40 animate-pulse rounded-2xl bg-hundida" />
      <div className="h-24 animate-pulse rounded-2xl bg-hundida" />
    </div>
  );
}
