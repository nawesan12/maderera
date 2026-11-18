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

/** Un grupo de la lista (sin foto, sin stock…) con cuántos tiene. */
export interface EstadoDeLista {
  valor: string;
  texto: string;
  cantidad: number;
  /** Los que piden atención llevan el número en naranja. */
  atencion?: boolean;
}

/**
 * El filtro de la lista de productos, que también usan Stock y Precios.
 *
 * **La ruta sale de `usePathname` y no está escrita acá.** Estaba fija en
 * `/admin/productos`, así que filtrar por categoría estando en Stock o en
 * Precios te sacaba de la pantalla: escribías dos letras para acotar la
 * comparación y aparecías en otra lista, sin ninguna pista de por qué.
 *
 * Los grupos (sin precio, sin stock…) eran secciones de la misma página con
 * todas las filas adentro. Con miles de productos eso no se puede traer
 * entero: ahora son botones con su número, el grupo elegido va en la URL
 * (`?estado=`) y Go devuelve una página de ese grupo.
 */
export function BuscadorProductos({
  categorias,
  busquedaActual,
  categoriaActual,
  marcas = [],
  marcaActual = "todas",
  proveedores,
  proveedorActual = "todos",
  estados,
  estadoActual = "todos",
}: {
  categorias: { slug: string; name: string }[];
  busquedaActual: string;
  categoriaActual: string;
  marcas?: string[];
  marcaActual?: string;
  /** Solo para quien entra a Compras: el resto no ve los proveedores. */
  proveedores?: { id: string; nombre: string }[];
  proveedorActual?: string;
  estados?: EstadoDeLista[];
  estadoActual?: string;
}) {
  const ruta = usePathname();
  const { texto, setTexto, actualizar } = useFiltrosDeLista({
    ruta,
    busquedaActual,
  });

  return (
    <div className="space-y-3">
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
          <SelectTrigger className="h-11 w-56" aria-label="Categoría">
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
        {marcas.length > 0 && (
          <Select
            value={marcaActual}
            onValueChange={(v) => v && actualizar({ marca: v })}
            items={{ todas: "Todas las marcas", ...Object.fromEntries(marcas.map((m) => [m, m])) }}
          >
            <SelectTrigger className="h-11 w-48" aria-label="Marca">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las marcas</SelectItem>
              {marcas.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {proveedores && proveedores.length > 0 && (
          <Select
            value={proveedorActual}
            onValueChange={(v) => v && actualizar({ prov: v })}
            items={{
              todos: "Todos los proveedores",
              ...Object.fromEntries(proveedores.map((p) => [p.id, p.nombre])),
            }}
          >
            <SelectTrigger className="h-11 w-56" aria-label="Proveedor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los proveedores</SelectItem>
              {proveedores.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {estados && estados.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué mostrar">
          {estados.map((e) => {
            const activo = estadoActual === e.valor;
            return (
              <button
                key={e.valor}
                type="button"
                aria-pressed={activo}
                onClick={() => actualizar({ estado: e.valor })}
                className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-base font-medium transition-colors ${
                  activo ? "boton-accion" : "bg-hundida text-muted-foreground hover:text-foreground"
                }`}
              >
                {e.texto}
                <span
                  className={`tabular rounded-full px-2 py-0.5 text-[13px] font-semibold ${
                    activo
                      ? "bg-white/20"
                      : e.atencion && e.cantidad > 0
                        ? "bg-brand-orange/15 text-brand-orange-dark dark:text-acento-texto"
                        : "bg-chip text-texto-2"
                  }`}
                >
                  {e.cantidad}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
