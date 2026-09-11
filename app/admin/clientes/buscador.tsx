"use client";

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

const TIPOS = {
  todos: "Todos los clientes",
  profesional: "Profesionales",
  particular: "Particulares",
};

export function BuscadorClientes({
  busquedaActual,
  tipoActual,
}: {
  busquedaActual: string;
  tipoActual: string;
}) {
  const { texto, setTexto, actualizar } = useFiltrosDeLista({
    ruta: "/admin/clientes",
    busquedaActual,
  });

  return (
    <div className="flex flex-wrap gap-3">
      <CampoDeBusqueda
        valor={texto}
        alEscribir={setTexto}
        placeholder="Buscar por nombre, empresa, CUIT o rubro…"
        etiqueta="Buscar clientes"
      />
      <Select
        value={tipoActual}
        onValueChange={(v) => v && actualizar({ tipo: v })}
        items={TIPOS}
      >
        <SelectTrigger className="h-11 w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(TIPOS).map(([valor, texto]) => (
            <SelectItem key={valor} value={valor}>
              {texto}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
