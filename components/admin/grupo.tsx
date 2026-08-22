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
    <section className="mt-6">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
        <h2
          className={`text-base font-semibold ${
            destacado ? "" : "text-muted-foreground"
          }`}
        >
          {titulo}
        </h2>
        <span
          className={`tabular rounded-full px-2 py-0.5 text-sm font-medium ${
            destacado
              ? "bg-brand-orange/15 text-brand-orange-dark"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {cantidad}
        </span>
        {detalle && (
          <span className="text-base text-muted-foreground">{detalle}</span>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
