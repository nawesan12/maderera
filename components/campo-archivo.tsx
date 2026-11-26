"use client";

import { useState } from "react";
import { Paperclip } from "lucide-react";

/**
 * Un campo de archivo en castellano.
 *
 * El `<input type="file">` del navegador escribe sus propios textos en el
 * idioma del navegador («Choose File / No file chosen», simulación del mes,
 * H095). El input queda (lo manda el formulario y valida `required`), oculto
 * a la vista, y el rótulo hace de botón.
 */
export function CampoArchivo({
  id,
  name,
  accept,
  required,
  className = "",
}: {
  id: string;
  name: string;
  accept?: string;
  required?: boolean;
  className?: string;
}) {
  const [nombre, setNombre] = useState<string | null>(null);

  return (
    <label
      htmlFor={id}
      className={`flex h-11 cursor-pointer items-center gap-3 rounded-lg bg-hundida px-2 text-sm focus-within:ring-2 focus-within:ring-accion/40 ${className}`}
    >
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        className="sr-only"
        onChange={(e) => setNombre(e.target.files?.[0]?.name ?? null)}
      />
      <span className="superficie inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-card px-2.5 font-medium">
        <Paperclip className="h-4 w-4" aria-hidden />
        Elegir archivo
      </span>
      <span className="min-w-0 truncate text-muted-foreground">{nombre ?? "Ningún archivo"}</span>
    </label>
  );
}
