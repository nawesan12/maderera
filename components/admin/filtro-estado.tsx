"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Búsqueda y filtro por estado, en una sola fila.
 *
 * Los estados van como botones y no dentro de un desplegable: son pocos, se usan
 * todo el tiempo y así se ve de un vistazo cuál está aplicado.
 */
export function FiltroEstado({
  ruta,
  estados,
  estadoActual,
  busquedaActual,
  placeholder,
}: {
  ruta: string;
  estados: Record<string, string>;
  estadoActual: string;
  busquedaActual: string;
  placeholder: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [texto, setTexto] = useState(busquedaActual);

  function actualizar(cambios: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (!v || v === "todos") params.delete(k);
      else params.set(k, v);
    }
    startTransition(() =>
      router.replace(params.size > 0 ? `${ruta}?${params}` : ruta, {
        scroll: false,
      }),
    );
  }

  useEffect(() => {
    if (texto === busquedaActual) return;
    const timer = setTimeout(() => actualizar({ buscar: texto }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-64 flex-1">
        <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder={placeholder}
          className="h-11 pl-11"
          aria-label={placeholder}
        />
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
        {Object.entries(estados).map(([valor, etiqueta]) => {
          const activo = estadoActual === valor;
          return (
            <button
              key={valor}
              onClick={() => actualizar({ estado: valor })}
              aria-pressed={activo}
              className={`h-10 rounded-lg px-3 text-base font-medium transition-colors ${
                activo
                  ? "boton-accion"
                  : "border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {etiqueta}
            </button>
          );
        })}
      </div>
    </div>
  );
}
