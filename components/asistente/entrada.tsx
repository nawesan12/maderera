"use client";

import { PersonajeAsistente } from "@/components/asistente/personaje";
import { ETIQUETA_ASISTENTE, abrirAsistente } from "@/lib/asistente/abrir";
import { cn } from "@/lib/utils";

/**
 * Una puerta al asistente, con el personaje y su nombre a la vista (hallazgo
 * 27, 18/11/2026). El círculo naranja flotante no decía qué era; esto sí, y
 * va donde alguien está buscando: al lado del buscador, en el menú del
 * celular y en la página de «no existe».
 *
 * `alAbrir` es para quien tiene que cerrarse primero, como el menú del
 * celular: el asistente se abre encima y el menú quedaría atrás.
 */
export function EntradaAlAsistente({
  className,
  alAbrir,
}: {
  className?: string;
  alAbrir?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        alAbrir?.();
        abrirAsistente();
      }}
      aria-haspopup="dialog"
      className={cn(
        "inline-flex h-12 items-center gap-2.5 rounded-[10px] border border-linea bg-card pl-2 pr-4 text-[15px] font-semibold transition-colors hover:border-accion/40",
        className,
      )}
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-naranja-claro">
        <PersonajeAsistente className="h-[18px] w-[18px] text-acento-sobre-claro" />
      </span>
      {ETIQUETA_ASISTENTE}
    </button>
  );
}
