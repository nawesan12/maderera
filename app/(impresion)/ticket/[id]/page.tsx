import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { obtenerPedido } from "@/lib/dal/admin/ventas";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { TicketImpreso } from "@/components/impresion/ticket";
import type { DocumentoTicket } from "@/lib/mostrador/ticket";

export const metadata: Metadata = {
  title: "Ticket",
  robots: { index: false, follow: false },
};


/**
 * El papel que se lleva el cliente de una venta de mostrador.
 *
 * **No es un comprobante fiscal y lo dice.** Cuando la venta sale con factura,
 * lo que se imprime es la factura, que ya tiene su propia hoja. Esto es para la
 * otra mitad de las ventas: alguien compra tres tirantes, paga y quiere algo
 * con qué volver si el largo no era el que pidió.
 *
 * Va en 80 mm porque eso es lo que hay en un mostrador. Si se imprime en A4
 * igual sale bien: es una columna angosta centrada, no una hoja rota.
 *
 * Solo el personal. Un ticket lleva el detalle de la venta y el nombre del
 * cliente, y no hay ninguna razón para que sea una dirección que cualquiera
 * pueda recorrer probando números.
 */
export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();

  const { id } = await params;
  const pedido = await obtenerPedido(id);
  if (!pedido) notFound();

  const [sucursales, ajustes] = await Promise.all([
    listarSucursalesPublicas(),
    ajustesDelSitio(),
  ]);

  const sucursal =
    sucursales.find((s) => s.nombre === pedido.sucursal) ?? sucursales[0] ?? null;

  /*
   * El mismo documento y el mismo componente que usa el ticket local.
   *
   * Antes el JSX vivía acá y la versión offline habría sido una copia: dos
   * papeles con el mismo nombre que se separan a la primera corrección. Ahora
   * las dos entradas arman un `DocumentoTicket` y lo dibuja `TicketImpreso`.
   */
  const documento: DocumentoTicket = {
    numero: pedido.numero,
    provisorio: false,
    numeroProvisorio: pedido.numeroProvisorio ?? null,
    fecha: new Date(pedido.createdAt).toISOString(),
    sucursal: {
      nombre: sucursal?.nombre ?? pedido.sucursal ?? "",
      direccion: sucursal?.direccion ?? null,
      telefono: sucursal?.telefono ?? null,
    },
    emisor: { razonSocial: "Maderera Juan B. Justo", cuit: null },
    cliente: pedido.empresa || pedido.cliente,
    items: pedido.items.map((item) => ({
      descripcion: item.descripcion,
      cantidad: Number(item.cantidad),
      unidad: item.unidad,
      precioUnitario: Number(item.precioUnitario),
      subtotal: Number(item.subtotal),
    })),
    subtotal: Number(pedido.subtotal ?? pedido.total),
    descuento: Number(pedido.descuento ?? 0),
    descuentoMotivo: pedido.descuentoMotivo ?? null,
    total: Number(pedido.total),
    medioPago: pedido.medioPago ?? null,
    enCuentaCorriente: pedido.estadoPago === "pendiente",
    whatsapp: ajustes.whatsapp_principal ?? null,
  };

  return <TicketImpreso documento={documento} />;
}
