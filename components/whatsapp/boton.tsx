import type { ReactNode } from "react";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * El botón de WhatsApp del sitio: uno solo (hallazgo 27 del comité,
 * 18/11/2026).
 *
 * Había seis: naranja como «Llamar» en Sucursales, neutro en Moldava, verde
 * claro en la ficha, verde oscuro en Nosotros, cada uno con su alto. Quien
 * busca «escribir por WhatsApp» lo busca por el color, y si el color cambia
 * de pantalla en pantalla hay que leer cada botón.
 *
 * - `lleno`: la acción principal de la pantalla. Verde oscuro de la casa
 *   (`--whatsapp-boton`, 5,8:1 con el blanco), el mismo del flotante.
 * - `secundario`: cuando al lado hay otra acción que manda. Borde y texto
 *   verde, con el relieve de los secundarios.
 *
 * Los altos son los que el sitio ya usa: 44 px (`normal`, el de los botones
 * de las páginas) y 50 px (`grande`, el de «Agregar al presupuesto» en la
 * ficha). `icono` es un cuadrado de 44 px: el mínimo para el pulgar.
 *
 * Es un enlace y no un `<button>`: abre wa.me, no hace nada en la página.
 * Sin estado, así sirve igual en una página del servidor que adentro de un
 * componente de cliente.
 */
const VARIANTES = {
  lleno: "bg-whatsapp-boton text-white hover:bg-whatsapp-boton-hover",
  secundario: "border border-linea bg-card text-verde-whatsapp hover:border-verde-whatsapp/40",
} as const;

const TAMANOS = {
  normal: "h-11 gap-2 px-5 text-[15px]",
  grande: "h-[50px] gap-2.5 px-5 text-base",
  icono: "h-11 w-11 flex-none",
} as const;

export function BotonWhatsapp({
  enlace,
  children,
  variante = "lleno",
  tamano = "normal",
  className,
  "aria-label": etiqueta,
  deshabilitado = false,
}: {
  enlace: string;
  /** El texto. Con `tamano="icono"` no va, y entonces `aria-label` es obligatorio. */
  children?: ReactNode;
  variante?: keyof typeof VARIANTES;
  tamano?: keyof typeof TAMANOS;
  className?: string;
  "aria-label"?: string;
  /**
   * Sin enlace: lo que se mandaría está mal (la cantidad de la consulta,
   * comité final M19). No se activa ni con el mouse ni con el teclado.
   */
  deshabilitado?: boolean;
}) {
  const clases = cn(
    "inline-flex items-center justify-center rounded-[10px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-whatsapp-boton",
    VARIANTES[variante],
    TAMANOS[tamano],
    className,
  );
  const contenido = (
    <>
      <MessageCircle className={tamano === "grande" ? "h-[18px] w-[18px]" : "h-4 w-4"} aria-hidden />
      {tamano !== "icono" && children}
    </>
  );
  // Deshabilitado no es un <a> sin href: ahí `aria-disabled` no aplica y el
  // lector lo anuncia como texto suelto. Un enlace deshabilitado, dicho como
  // tal (revisión del comité).
  if (deshabilitado) {
    return (
      <span role="link" aria-disabled="true" aria-label={etiqueta} className={cn(clases, "cursor-not-allowed opacity-50")}>
        {contenido}
      </span>
    );
  }
  return (
    <a href={enlace} target="_blank" rel="noopener noreferrer" aria-label={etiqueta} className={clases}>
      {contenido}
    </a>
  );
}
