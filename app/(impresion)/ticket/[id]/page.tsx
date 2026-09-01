import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { obtenerPedido } from "@/lib/dal/admin/ventas";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { formatearMonto } from "@/lib/formato";
import { BotonImprimir } from "./boton";

export const metadata: Metadata = {
  title: "Ticket",
  robots: { index: false, follow: false },
};

const MEDIOS: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  cuenta_corriente: "Cuenta corriente",
  mercado_pago: "Mercado Pago",
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

  const fecha = new Date(pedido.createdAt).toLocaleString("es-AR", {
    dateStyle: "short",
    timeStyle: "short",
  });

  return (
    <div className="ticket-hoja">
      <div className="barra">
        <BotonImprimir />
      </div>

      <div className="rollo">
        <header className="cabecera">
          <p className="razon">Maderera Juan B. Justo</p>
          {sucursal && (
            <>
              <p>{sucursal.nombre}</p>
              {sucursal.direccion && <p>{sucursal.direccion}</p>}
              {sucursal.telefono && <p>{sucursal.telefono}</p>}
            </>
          )}
        </header>

        <div className="separador" />

        <p className="linea-datos">
          <span>{pedido.numero}</span>
          <span>{fecha}</span>
        </p>
        <p className="linea-datos">
          <span>Cliente</span>
          <span>{pedido.empresa || pedido.cliente}</span>
        </p>

        <div className="separador" />

        <table className="items">
          <tbody>
            {pedido.items.map((item) => (
              <tr key={item.id}>
                <td colSpan={2} className="descripcion">
                  {item.descripcion}
                  <span className="detalle">
                    {Number(item.cantidad)} {item.unidad} ×{" "}
                    {formatearMonto(item.precioUnitario)}
                  </span>
                </td>
                <td className="importe">{formatearMonto(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="separador" />

        <p className="total">
          <span>TOTAL</span>
          <span>{formatearMonto(pedido.total)}</span>
        </p>

        <p className="linea-datos">
          <span>Pago</span>
          <span>
            {pedido.medioPago ? (MEDIOS[pedido.medioPago] ?? pedido.medioPago) : "—"}
          </span>
        </p>

        {pedido.estadoPago === "pendiente" && (
          <p className="aviso">Queda en cuenta corriente</p>
        )}

        <div className="separador" />

        {/* Lo que la ley 27.743 pide decir cuando no se emite factura: que esto
            no es un comprobante fiscal. Decirlo chiquito abajo sería peor que
            no decirlo. */}
        <p className="legal">
          Documento no válido como factura.
          <br />
          Precios finales con IVA incluido · Ley 27.743
        </p>

        {ajustes.whatsapp_principal && (
          <p className="pie">
            Consultas por WhatsApp:{" "}
            {ajustes.whatsapp_principal.replace(/\D/g, "")}
          </p>
        )}
      </div>
    </div>
  );
}
