import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * El estado vacío de una lista del panel.
 *
 * Existe porque casi todos los "Todavía no hay…" del panel eran un párrafo
 * suelto. Una lista vacía es el momento en que alguien más necesita saber qué
 * hacer, y era justo donde no se le ofrecía nada: leía "no hay proveedores" y
 * tenía que adivinar que el botón de alta estaba arriba, fuera de su vista.
 *
 * Por eso la acción viaja con el vacío y no al lado. Cuando de verdad no hay
 * nada que hacer —un grupo que quedó sin pendientes— se usa sin `accion`, y
 * entonces el texto es una confirmación y no una tarea: "todo entregado".
 */
export function Vacio({
  icono: Icono,
  titulo,
  detalle,
  accion,
}: {
  icono?: LucideIcon;
  titulo: string;
  /** Una línea de contexto. Opcional: muchas veces el título ya lo dice todo. */
  detalle?: string;
  /** El botón que resuelve el vacío. Puede ser un enlace o un componente propio. */
  accion?: { texto: string; href: string } | React.ReactNode;
}) {
  const esEnlace =
    accion !== undefined &&
    accion !== null &&
    typeof accion === "object" &&
    "href" in accion;

  // Un renglón hundido, no una tarjeta de 200 px con un ícono al medio: un
  // hueco se ve hundido, y el vacío no es el contenido de la pantalla
  // (revisión de diseño, 18/11/2026).
  return (
    <div className="tarjeta-hundida m-3 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl px-4 py-4">
      {Icono && <Icono className="h-5 w-5 shrink-0 text-texto-3" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium">{titulo}</p>
        {detalle && <p className="text-sm text-muted-foreground">{detalle}</p>}
      </div>
      {accion !== undefined && accion !== null &&
        (esEnlace ? (
          <Link
            href={(accion as { href: string }).href}
            className="inline-flex h-11 items-center rounded-lg bg-accion px-4 text-base font-medium text-white transition-opacity hover:opacity-90"
          >
            {(accion as { texto: string }).texto}
          </Link>
        ) : (
          (accion as React.ReactNode)
        ))}
    </div>
  );
}
