import { formatearMonto } from "@/lib/formato";
import type { DocumentoTicket } from "@/lib/mostrador/ticket";
import { BotonImprimir } from "@/app/(impresion)/ticket/[id]/boton";

const MEDIOS: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  cuenta_corriente: "Cuenta corriente",
  mercado_pago: "Mercado Pago",
};

/**
 * El papel que se lleva el cliente, dibujado.
 *
 * Presentacional puro: no busca datos ni sabe de dónde vienen. Eso es lo que
 * permite que lo usen las dos entradas —la de servidor, que reimprime una venta
 * vieja, y la local, que imprime una venta que todavía está en la cola— sin que
 * el papel salga distinto según el camino.
 *
 * **No es un comprobante fiscal y lo dice.** Cuando la venta sale con factura,
 * lo que se imprime es la factura, que tiene su propia hoja.
 *
 * Va en 80 mm porque eso es lo que hay en un mostrador. Si se imprime en A4
 * igual sale bien: es una columna angosta centrada, no una hoja rota.
 */
export function TicketImpreso({ documento }: { documento: DocumentoTicket }) {
  const fecha = new Date(documento.fecha).toLocaleString("es-AR", {
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
          <p className="razon">{documento.emisor.razonSocial}</p>
          <p>{documento.sucursal.nombre}</p>
          {documento.sucursal.direccion && <p>{documento.sucursal.direccion}</p>}
          {documento.sucursal.telefono && <p>{documento.sucursal.telefono}</p>}
        </header>

        <div className="separador" />

        <p className="linea-datos">
          <span>{documento.numero}</span>
          <span>{fecha}</span>
        </p>

        {/*
          * Que el número es provisorio se dice acá arriba y no en una nota al
          * pie: es lo primero que hay que saber si mañana hay que buscar esta
          * venta, y quien atiende tiene que poder explicarlo con el papel en la
          * mano.
          */}
        {documento.provisorio && (
          <p className="aviso">
            Número provisorio. El definitivo se asigna cuando vuelva la conexión.
          </p>
        )}

        {!documento.provisorio && documento.numeroProvisorio && (
          <p className="linea-datos">
            <span>Referencia</span>
            <span>{documento.numeroProvisorio}</span>
          </p>
        )}

        <p className="linea-datos">
          <span>Cliente</span>
          <span>{documento.cliente}</span>
        </p>

        <div className="separador" />

        <table className="items">
          <tbody>
            {documento.items.map((item, i) => (
              <tr key={i}>
                <td colSpan={2} className="descripcion">
                  {item.descripcion}
                  <span className="detalle">
                    {item.cantidad} {item.unidad} ×{" "}
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
          <span>{formatearMonto(documento.total)}</span>
        </p>

        <p className="linea-datos">
          <span>Pago</span>
          <span>
            {documento.medioPago
              ? (MEDIOS[documento.medioPago] ?? documento.medioPago)
              : "—"}
          </span>
        </p>

        {/*
          * El descuento va como nota y no como "subtotal menos descuento".
          * Los renglones de arriba ya están con el precio rebajado —tienen que
          * estarlo, porque es lo que se cobró y lo que va a la factura—, así
          * que poner un subtotal más alto dejaría un papel cuyas cuentas no
          * cierran a la vista. Igual dice cuánto se ahorró, que es lo que el
          * cliente quiere ver.
          */}
        {documento.descuento > 0 && (
          <p className="aviso">
            Incluye {formatearMonto(documento.descuento)} de descuento
            {documento.descuentoMotivo ? ` · ${documento.descuentoMotivo}` : ""}
          </p>
        )}

        {documento.enCuentaCorriente && (
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

        {documento.whatsapp && (
          <p className="pie">
            Consultas por WhatsApp: {documento.whatsapp.replace(/\D/g, "")}
          </p>
        )}
      </div>
    </div>
  );
}
