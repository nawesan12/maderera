"use client";

import { useSearchParams } from "next/navigation";
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
  const parametros = useSearchParams();
  const estado = parametros.get("estado") ?? "todos";

  const { texto, setTexto, actualizar } = useFiltrosDeLista({
    ruta: "/admin/proveedores",
    busquedaActual: parametros.get("q") ?? "",
    claveBusqueda: "q",
  });

  return (
    <div className="flex flex-wrap gap-3">
      <CampoDeBusqueda
        valor={texto}
        alEscribir={setTexto}
        placeholder="Nombre, CUIT, rubro o con quién se habla…"
        etiqueta="Buscar proveedores"
      />
      <Select
        value={estado}
        onValueChange={(v) => v && actualizar({ estado: v })}
        items={ESTADOS}
      >
        <SelectTrigger className="h-11 w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(ESTADOS).map(([valor, texto]) => (
            <SelectItem key={valor} value={valor}>
              {texto}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
