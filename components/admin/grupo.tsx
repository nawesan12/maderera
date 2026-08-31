/**
 * Encabezado de grupo dentro de un listado.
 *
 * Separar lo abierto de lo cerrado es lo que responde "qué tengo que hacer hoy"
 * sin leer fila por fila. Una lista larga y pareja obliga a revisar cada estado
 * uno por uno para encontrar los tres que importan.
 */
export function GrupoListado({
  titulo,
  cantidad,
  detalle,
  destacado = false,
  children,
}: {
  titulo: string;
  cantidad: number;
  detalle?: string;
  destacado?: boolean;
  children: React.ReactNode;
}) {
  if (cantidad === 0) return null;

  return (
    <section className="mt-[22px]">
      <div className="mb-[11px] flex flex-wrap items-baseline gap-2.5">
        <h2
          className={`text-[17px] font-semibold tracking-[-0.015em] ${
            destacado ? "" : "text-texto-2"
          }`}
        >
          {titulo}
        </h2>
        <span
          className={`tabular rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${
            destacado
              ? "bg-brand-orange/15 text-brand-orange-dark dark:text-acento-texto"
              : "bg-chip text-texto-2"
          }`}
        >
          {cantidad}
        </span>
        {detalle && <span className="text-sm text-texto-2">{detalle}</span>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
