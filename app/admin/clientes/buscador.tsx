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
import { RUBROS_CLIENTE } from "@/lib/rubros-cliente";

/**
 * El corte de la lista de clientes es **el rubro**, no el tipo.
 *
 * Lo pidió la clienta: «cambiar lista de tipo de clientes por los rubros,
 * porque consumidor final o particular no tendría rubro». Tenía razón —
 * «particular» no es un rubro sino la ausencia de uno— y sobre todo: «cuántos
 * profesionales tengo» no se decide con nada, y «cuánto creció el rubro de las
 * constructoras» sí.
 *
 * `customers.tipo` sigue existiendo y gobernando el precio y el crédito; lo que
 * cambió es por dónde se corta la lista.
 */
const RUBROS: Record<string, string> = {
  todos: "Todos los rubros",
  ...Object.fromEntries(RUBROS_CLIENTE.map((r) => [r.valor, r.etiqueta])),
  "sin-rubro": "Sin rubro cargado",
};

export function BuscadorClientes({
  busquedaActual,
  rubroActual,
}: {
  busquedaActual: string;
  rubroActual: string;
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
        value={rubroActual}
        onValueChange={(v) => v && actualizar({ rubro: v })}
        items={RUBROS}
      >
        <SelectTrigger className="h-11 w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(RUBROS).map(([valor, texto]) => (
            <SelectItem key={valor} value={valor}>
              {texto}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
