"use client";

import {
  BotonesDeFiltro,
  CampoDeBusqueda,
  useFiltrosDeLista,
} from "@/components/admin/filtros-de-lista";

/**
 * Buscar una factura y cortarla por cómo se cobró y por lo que falta
 * autorizar.
 *
 * **Contado o cuenta corriente no es una columna de la factura**: «En cuenta
 * corriente» es la que se debe en la cuenta del cliente (se pasó a cuenta o
 * el pedido se vendió a cuenta); «De contado», la cobrada en el momento.
 * Lo decide Go (`facturacion.EnCuentaDeFactura`).
 *
 * El estado reemplaza a los grupos «Rechazados» y «Sin autorizar» que se
 * repetían enteros arriba del listado: la misma factura salía dos o tres
 * veces y la página medía 30.000 px en el teléfono.
 */
export function BuscadorDeComprobantes({
  busquedaActual,
  cobro,
  estado,
  sinAutorizar,
  rechazados,
}: {
  busquedaActual: string;
  cobro: string;
  estado: string;
  sinAutorizar: number;
  rechazados: number;
}) {
  const { texto, setTexto, actualizar } = useFiltrosDeLista({
    ruta: "/admin/facturacion",
    busquedaActual,
    neutros: ["todos"],
  });

  const estados = [
    { valor: "todos", texto: "Todos" },
    ...(sinAutorizar > 0 ? [{ valor: "emitida", texto: `Sin autorizar · ${sinAutorizar}` }] : []),
    ...(rechazados > 0 ? [{ valor: "rechazada", texto: `Rechazados · ${rechazados}` }] : []),
  ];

  return (
    <>
      <CampoDeBusqueda
        valor={texto}
        alEscribir={setTexto}
        placeholder="Número, CUIT o nombre"
        etiqueta="Buscar un comprobante"
      />
      {estados.length > 1 && (
        <BotonesDeFiltro
          etiqueta="Estado"
          actual={estado}
          alElegir={(v) => actualizar({ estado: v })}
          opciones={estados}
        />
      )}
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
