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

  return (
    <div className="px-5 py-12 text-center">
      {Icono && (
        <Icono
          className="mx-auto h-8 w-8 text-muted-foreground"
          aria-hidden="true"
        />
      )}
      <p className="mt-3 text-base font-medium">{titulo}</p>
      {detalle && (
        <p className="mx-auto mt-1 max-w-md text-base text-muted-foreground">
          {detalle}
        </p>
      )}
      {accion !== undefined && accion !== null && (
        <div className="mt-4 flex justify-center">
          {esEnlace ? (
            <Link
              href={(accion as { href: string }).href}
              className="inline-flex h-11 items-center rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-opacity hover:opacity-90"
            >
              {(accion as { texto: string }).texto}
            </Link>
          ) : (
            (accion as React.ReactNode)
          )}
        </div>
      )}
    </div>
  );
}
