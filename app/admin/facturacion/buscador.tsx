"use client";

import {
  BotonesDeFiltro,
  CampoDeBusqueda,
  useFiltrosDeLista,
} from "@/components/admin/filtros-de-lista";

/**
 * Buscar una factura y cortarla por cómo se cobró.
 *
 * **Contado o cuenta corriente no es una columna de la factura**: se deduce de
 * los cobros registrados. Una factura con algún cobro de contado —efectivo,
 * transferencia, tarjeta, cheque— cuenta como contado; una sin ningún cobro, o
 * cobrada solo contra la cuenta, es cuenta corriente. Está explicado así en
 * `listarComprobantes`, que es donde se aplica.
 */
export function BuscadorDeComprobantes({
  busquedaActual,
  cobro,
}: {
  busquedaActual: string;
  cobro: string;
}) {
  const { texto, setTexto, actualizar } = useFiltrosDeLista({
    ruta: "/admin/facturacion",
    busquedaActual,
    neutros: ["todos"],
  });

  return (
    <>
      <CampoDeBusqueda
        valor={texto}
        alEscribir={setTexto}
        placeholder="Número, CUIT o nombre"
        etiqueta="Buscar un comprobante"
      />
      <BotonesDeFiltro
        etiqueta="Cómo se cobró"
        actual={cobro}
        alElegir={(v) => actualizar({ cobro: v })}
        opciones={[
          { valor: "todos", texto: "Todas" },
          { valor: "contado", texto: "De contado" },
          { valor: "cuenta", texto: "En cuenta corriente" },
        ]}
      />
    </>
  );
}
