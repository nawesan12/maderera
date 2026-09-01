/**
 * Lo que se ve mientras una página del sitio trae sus datos.
 *
 * Sin esto, al tocar un enlace del menú no pasa nada visible hasta que el
 * servidor termina: la página anterior queda quieta y quien mira no sabe si el
 * toque se registró. En el mostrador con la conexión del local eso es un
 * segundo; desde un celular en la obra, varios.
 *
 * Es la silueta de una página cualquiera —título, bajada y una grilla— y no una
 * ruedita: ocupa el lugar que va a ocupar el contenido, así que al llegar no
 * salta. El encabezado y el pie no están acá porque los dibuja el layout, que
 * no se vuelve a armar en cada navegación.
 */
export default function CargandoSitio() {
  return (
    <div className="contenedor py-12" aria-label="Cargando" aria-busy="true">
      <div className="h-4 w-40 animate-pulse rounded bg-hundida" />

      <div className="mt-7 space-y-3">
        <div className="h-9 w-72 max-w-full animate-pulse rounded-lg bg-hundida" />
        <div className="h-5 w-[28rem] max-w-full animate-pulse rounded-lg bg-hundida" />
      </div>

      <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-[14px] border border-linea bg-card"
          >
            <div className="aspect-[4/3] animate-pulse bg-hundida" />
            <div className="space-y-2.5 p-4">
              <div className="h-4 w-3/4 animate-pulse rounded bg-hundida" />
              <div className="h-6 w-1/2 animate-pulse rounded bg-hundida" />
              <div className="h-10 w-full animate-pulse rounded-lg bg-hundida" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
