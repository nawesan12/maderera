"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

const ESTADOS = {
  todos: "Todos",
  activo: "Activos",
  inactivo: "Inactivos",
};

/**
 * Busca por nombre, razón social, CUIT, rubro o contacto.
 *
 * El texto va a la dirección y no al estado local: así el listado se puede
 * compartir y el botón de atrás vuelve a la búsqueda anterior, que es lo que
 * alguien espera de una tabla que se está mirando en una reunión.
 */
export function BuscadorDeProveedores() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [, empezar] = useTransition();

  const actual = parametros.get("q") ?? "";
  const estado = parametros.get("estado") ?? "todos";
  const [texto, setTexto] = useState(actual);

  function actualizar(cambios: Record<string, string | null>) {
    const params = new URLSearchParams(parametros.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (!v || v === "todos") params.delete(k);
      else params.set(k, v);
    }
    empezar(() =>
      router.replace(
        params.size > 0 ? `/admin/proveedores?${params}` : "/admin/proveedores",
        { scroll: false },
      ),
    );
  }

  useEffect(() => {
    if (texto === actual) return;
    const t = setTimeout(() => actualizar({ q: texto }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  return (
    <div className="flex flex-wrap gap-2">
      <label className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Nombre, CUIT, rubro o con quién se habla…"
          className="h-11 w-full rounded-lg border border-linea bg-card pl-9 pr-3 text-base"
        />
      </label>

      <select
        value={estado}
        onChange={(e) => actualizar({ estado: e.target.value })}
        className="h-11 shrink-0 rounded-lg border border-linea bg-card px-3 text-base"
      >
        {Object.entries(ESTADOS).map(([valor, texto]) => (
          <option key={valor} value={valor}>
            {texto}
          </option>
        ))}
      </select>
    </div>
  );
}
