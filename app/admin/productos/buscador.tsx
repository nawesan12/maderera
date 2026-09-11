"use client";

import { usePathname } from "next/navigation";
import {
  CampoDeBusqueda,
  useFiltrosDeLista,
} from "@/components/admin/filtros-de-lista";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * El filtro de la lista de productos, que también usan Stock y Precios.
 *
 * **La ruta sale de `usePathname` y no está escrita acá.** Estaba fija en
 * `/admin/productos`, así que filtrar por categoría estando en Stock o en
 * Precios te sacaba de la pantalla: escribías dos letras para acotar la
 * comparación y aparecías en otra lista, sin ninguna pista de por qué.
 */
export function BuscadorProductos({
  categorias,
  busquedaActual,
  categoriaActual,
}: {
  categorias: { slug: string; name: string }[];
  busquedaActual: string;
  categoriaActual: string;
}) {
  const ruta = usePathname();
  const { texto, setTexto, actualizar } = useFiltrosDeLista({
    ruta,
    busquedaActual,
  });

  return (
    <div className="flex flex-wrap gap-3">
      <CampoDeBusqueda
        valor={texto}
        alEscribir={setTexto}
        placeholder="Filtrar esta lista…"
        etiqueta="Filtrar la lista"
      />
      <Select
        value={categoriaActual}
        onValueChange={(v) => v && actualizar({ cat: v })}
        items={{
          todos: "Todas las categorías",
          ...Object.fromEntries(categorias.map((c) => [c.slug, c.name])),
        }}
      >
        <SelectTrigger className="h-11 w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todas las categorías</SelectItem>
          {categorias.map((c) => (
            <SelectItem key={c.slug} value={c.slug}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
