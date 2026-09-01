import { TableSkeleton } from "@/components/admin/table-skeleton";

/**
 * Lo que se ve mientras una pantalla del panel trae sus datos.
 *
 * Es la silueta de un listado y no una ruedita: ocupa el mismo lugar que va a
 * ocupar el contenido, así que la página no salta cuando llega. Con la
 * navegación entre secciones esto es lo que se ve durante la consulta, y sin
 * esto la pantalla anterior queda congelada sin señal de que algo está
 * pasando.
 */
export default function CargandoPanel() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-hundida" />
        <div className="h-5 w-72 animate-pulse rounded-lg bg-hundida" />
      </div>
      <TableSkeleton />
    </div>
  );
}
