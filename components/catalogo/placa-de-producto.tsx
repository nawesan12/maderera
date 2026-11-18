import type { CSSProperties } from "react";
import { TONOS, escalaDelRubro, marcaDePlaca, tonoDePlaca } from "@/lib/catalogo/placa";
import { cn } from "@/lib/utils";

/**
 * Lo que va en el lugar de la foto mientras el producto no tenga una propia
 * (hallazgo 25 del comité, 18/11/2026).
 *
 * Una etiqueta y no una foto: el tono de madera del rubro, una veta apenas
 * sugerida y el rubro estampado. **No lleva el nombre ni la medida**: la
 * tarjeta los dice abajo (el nombre, una vez) y en el lugar del precio (la
 * medida), y repetidos la grilla parecía de relleno. Arriba a la derecha,
 * MOLDAVA cuando es de esa línea; la marca de la casa no, que ya está en la
 * barra.
 *
 * Sin estado ni efectos: se dibuja igual en el servidor y adentro de la
 * tarjeta, que es de cliente. Ocupa todo el contenedor; el alto lo decide
 * quien la pone (baja en el celular, 4/3 en la grilla y en la ficha).
 */
export function PlacaDeProducto({
  rubro,
  categoria,
  marca,
  tamano = "tarjeta",
  className,
}: {
  /** Lo que se estampa: el rubro («Melamina») o, si no hay, la categoría. */
  rubro: string;
  /** El slug de la categoría: decide el tono. */
  categoria: string;
  marca?: string | null;
  /** En la ficha la placa es más grande y el rubro también. */
  tamano?: "tarjeta" | "ficha";
  className?: string;
}) {
  const tono = TONOS[tonoDePlaca(categoria)];
  const linea = marcaDePlaca(marca);
  const estilo = {
    "--placa-fondo": tono.claro.fondo,
    "--placa-texto": tono.claro.texto,
    "--placa-fondo-oscuro": tono.oscuro.fondo,
    "--placa-texto-oscuro": tono.oscuro.texto,
  } as CSSProperties;
  // Un rubro de una palabra larga («Terminaciones») se achica hasta entrar en
  // el renglón; `overflow-wrap:anywhere` y el guion son la red para un rubro
  // nuevo que pase la cuenta.
  const escala = { "--escala-rubro": escalaDelRubro(rubro, tamano) } as CSSProperties;

  return (
    <span
      style={estilo}
      className={cn(
        "placa absolute inset-0 flex flex-col justify-between overflow-hidden",
        tono.veta && "placa-veta",
        tamano === "ficha" ? "p-6 sm:p-8" : "p-4 sm:p-5",
        className,
      )}
    >
      {/* La raya naranja es la misma que marca las secciones del sitio: el
          acento sin poner texto naranja sobre madera, que no llega a 4,5:1. */}
      <span className="flex items-start justify-between gap-3">
        <span aria-hidden className="mt-1 block h-[3px] w-7 rounded-full bg-accion" />
        {linea && (
          <span className="text-[11px] font-bold tracking-[0.22em]">{linea}</span>
        )}
      </span>
      <span
        lang="es"
        style={escala}
        className={cn(
          "line-clamp-2 font-extrabold uppercase leading-[0.98] tracking-[0.01em] text-balance hyphens-auto [overflow-wrap:anywhere]",
          tamano === "ficha"
            ? "text-[length:calc(clamp(30px,6vw,46px)*var(--escala-rubro))]"
            : "text-[length:calc(clamp(24px,7vw,32px)*var(--escala-rubro))] sm:text-[length:calc(clamp(22px,2.2vw,28px)*var(--escala-rubro))]",
        )}
      >
        {rubro}
      </span>
    </span>
  );
}
