"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Búsqueda y filtro por sucursal.
 *
 * El filtro de sucursal no es una comodidad: con el tablero lleno, cada local
 * necesita ver lo suyo. Casa Central mirando los pedidos del Aserradero solo
 * agrega ruido.
 */
export function BuscadorPedidos({
  busquedaActual,
  sucursalActual,
  sucursales,
}: {
  busquedaActual: string;
  sucursalActual: string;
  sucursales: { slug: string; nombre: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [texto, setTexto] = useState(busquedaActual);

  function actualizar(cambios: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (!v || v === "todas") params.delete(k);
      else params.set(k, v);
    }
    startTransition(() =>
      router.replace(
        params.size > 0 ? `/admin/pedidos?${params}` : "/admin/pedidos",
        { scroll: false },
      ),
    );
  }

  useEffect(() => {
    if (texto === busquedaActual) return;
    const timer = setTimeout(() => actualizar({ buscar: texto }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const opciones = [{ slug: "todas", nombre: "Las dos sucursales" }, ...sucursales];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-64 flex-1">
        <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar por número, cliente o dirección…"
          className="h-11 pl-11"
          aria-label="Buscar pedidos"
        />
      </div>

      <div className="flex gap-1.5" role="group" aria-label="Filtrar por sucursal">
        {opciones.map((o) => {
          const activa = sucursalActual === o.slug;
          return (
            <button
              key={o.slug}
              onClick={() => actualizar({ sucursal: o.slug })}
              aria-pressed={activa}
              className={`h-10 rounded-lg px-3 text-base font-medium transition-colors ${
                activa
                  ? "boton-accion"
                  : "border text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {o.nombre}
            </button>
          );
        })}
      </div>
    </div>
  );
}
