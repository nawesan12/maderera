/**
 * Encabezado de las pantallas del panel.
 *
 * Un solo lugar donde viven el título, el contexto y la acción principal, para
 * que todas las secciones se lean igual y el ojo sepa siempre dónde mirar.
 */
export function EncabezadoPanel({
  titulo,
  detalle,
  children,
}: {
  titulo: string;
  detalle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {detalle && (
          <p className="mt-0.5 text-base text-muted-foreground">{detalle}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
