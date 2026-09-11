"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface AccionRapida {
  texto: string;
  /**
   * El ícono **ya renderizado**: `<Eye className="h-4 w-4" />`, no `Eye`.
   *
   * Un componente de Lucide es una función, y una función no cruza la frontera
   * entre servidor y cliente: React la rechaza en tiempo de ejecución con
   * "Functions cannot be passed directly to Client Components". Un elemento
   * ya creado sí viaja. Y esto no lo detectan ni `tsc` ni el linter —el tipo
   * `LucideIcon` es perfectamente válido en los dos lados—, así que queda
   * escrito acá: se vio abriendo la pantalla.
   */
  icono?: React.ReactNode;
  /** A dónde lleva. Excluyente con `alElegir`. */
  href?: string;
  /** Qué hace. Excluyente con `href`. */
  alElegir?: () => void;
  /** Para lo que borra o anula: se pinta en rojo y se separa del resto. */
  peligrosa?: boolean;
  /** Una acción que hoy no corresponde se muestra apagada, no se esconde. */
  deshabilitada?: boolean;
}

/**
 * El menú de acciones de una fila.
 *
 * Antes no existía ninguno en el panel: cada lista o bien no dejaba hacer nada,
 * o bien obligaba a entrar al detalle para todo. Entrar al detalle está bien
 * cuando hay que mirar algo; está mal cuando uno ya sabe qué quiere hacer y la
 * fila se lo está diciendo —"esta factura está impaga", "este producto no se
 * vende hace un año"—.
 *
 * **Las acciones que no corresponden se muestran apagadas y no se esconden.**
 * Un menú que cambia de largo según la fila obliga a leerlo entero cada vez; y
 * "Anular" en gris enseña que la anulación existe y por qué acá no se puede,
 * que es más de lo que enseña un menú que no la nombra.
 */
export function AccionesRapidas({
  acciones,
  etiqueta,
}: {
  acciones: AccionRapida[];
  /** Para el lector de pantalla: "Acciones de PED-0231". */
  etiqueta: string;
}) {
  const normales = acciones.filter((a) => !a.peligrosa);
  const peligrosas = acciones.filter((a) => a.peligrosa);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={etiqueta}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-linea text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {normales.map((a) => (
          <Item key={a.texto} accion={a} />
        ))}
        {peligrosas.length > 0 && normales.length > 0 && (
          <DropdownMenuSeparator />
        )}
        {peligrosas.map((a) => (
          <Item key={a.texto} accion={a} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Item({ accion }: { accion: AccionRapida }) {
  const contenido = (
    <>
      {accion.icono}
      {accion.texto}
    </>
  );

  const clases = `gap-2 text-base ${accion.peligrosa ? "text-destructive" : ""}`;

  if (accion.href && !accion.deshabilitada) {
    return (
      <DropdownMenuItem className={clases} render={<Link href={accion.href} />}>
        {contenido}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      className={clases}
      disabled={accion.deshabilitada}
      onClick={accion.alElegir}
    >
      {contenido}
    </DropdownMenuItem>
  );
}
