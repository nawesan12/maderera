import { cantidadConUnidad, formatearMonto, telefonoLegible } from "@/lib/formato";
import { formatearCantidad } from "@/lib/unidades";
import { esLineaDelCorte } from "@/lib/mostrador/importes";
import { fechaDelTicket, type DocumentoTicket } from "@/lib/mostrador/ticket";
import { BotonImprimir } from "@/app/(impresion)/ticket/[id]/boton";

const MEDIOS: Record<string, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  cuenta_corriente: "Cuenta corriente",
  mercado_pago: "Mercado Pago",
  cheque: "Cheque",
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
  const fecha = fechaDelTicket(documento.fecha);

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

        {/* Anulada, bien grande y arriba: el ticket completo de una venta
            anulada podía circular como válido (mes simulado, M2S1-083). */}
        {documento.anulada && <p className="anulada">ANULADA</p>}

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
                  {/* Las pasadas del corte van por su importe: «6 piezas» con
                      «14 pasada ×» abajo se leía como un cobro de más. */}
                  {!esLineaDelCorte(item) && (
                    <span className="detalle">
                      {/* La media placa dice media placa, como la pantalla:
                          «2 placas» y quien entrega da dos enteras (M2S1-084). */}
                      {item.presentacion === "media_largo" || item.presentacion === "media_ancho"
                        ? `${formatearCantidad(item.cantidad)} ${item.cantidad === 1 ? "media placa" : "medias placas"}`
                        : cantidadConUnidad(item.cantidad, item.unidad, item.descripcion)}{" "}
                      × {formatearMonto(item.precioUnitario)}
                    </span>
                  )}
                </td>
                <td className="importe">{formatearMonto(item.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* El número del corte y sus piezas: es con lo que el cliente vuelve
            a retirar (mes simulado, M2S3-095). */}
        {documento.cortes && documento.cortes.length > 0 && (
          <p className="aviso">
            {documento.cortes.map((c) => `Corte ${c.numero} · ${c.piezas} ${c.piezas === 1 ? "pieza" : "piezas"}`).join(" / ")}
          </p>
        )}

        <div className="separador" />

        <p className="total">
          <span>TOTAL</span>
          <span>{formatearMonto(documento.total)}</span>
        </p>

        {/*
          * Cómo se pagó. Con un solo pago es la línea de siempre; partido, va
          * un renglón por medio con su importe. El lote y el cupón de la
          * tarjeta salen debajo: son el dato que después pide el contador.
          */}
        {documento.pagos.length > 1 ? (
          documento.pagos.map((pago, i) => (
            <p key={i} className="linea-datos">
              <span>
                {MEDIOS[pago.medio] ?? pago.medio}
                {pago.tarjeta ? ` ${pago.tarjeta}` : ""}
                {pago.cuotas && pago.cuotas > 1 ? ` en ${pago.cuotas}` : ""}
              </span>
              <span>{formatearMonto(pago.importe)}</span>
            </p>
          ))
        ) : (
          <p className="linea-datos">
            <span>Pago</span>
            <span>
              {documento.medioPago
                ? (MEDIOS[documento.medioPago] ?? documento.medioPago)
                : "—"}
              {documento.pagos[0]?.tarjeta
                ? ` ${documento.pagos[0].tarjeta}`
                : ""}
              {/* En cuántas cuotas. El total impreso es el total: las sin
                  interés las financia el banco y no cambian lo que se cobra. */}
              {documento.pagos[0]?.cuotas && documento.pagos[0].cuotas > 1
                ? ` en ${documento.pagos[0].cuotas} cuotas`
                : ""}
            </span>
          </p>
        )}

        {/* Con cuánto pagó y el vuelto, debajo del pago en efectivo: el vuelto
            no quedaba en ningún lado (mes simulado, M3S1-061). */}
        {documento.recibido != null && documento.recibido >= documento.total && (
          <>
            <p className="linea-datos">
              <span>Recibido</span>
              <span>{formatearMonto(documento.recibido)}</span>
            </p>
            <p className="linea-datos">
              <span>Vuelto</span>
              <span>{formatearMonto(Math.round((documento.recibido - documento.total) * 100) / 100)}</span>
            </p>
          </>
        )}

        {documento.pagos.some((p) => p.nroLote || p.nroCupon) && (
          <p className="aviso">
            {documento.pagos
              .filter((p) => p.nroLote || p.nroCupon)
              .map((p) =>
                // En un cheque, el «cupón» es su número: así se lo busca en el banco.
                p.medio === "cheque"
                  ? [p.nroCupon ? `Cheque N° ${p.nroCupon}` : null]
                  : [
                      p.nroLote ? `Lote ${p.nroLote}` : null,
                      p.nroCupon ? `Cupón ${p.nroCupon}` : null,
                    ]
                  .filter(Boolean)
                  .join(" · "),
              )
              .join(" / ")}
          </p>
        )}

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
          <p className="aviso">
            {documento.importeEnCuenta > 0 &&
            documento.importeEnCuenta < documento.total
              ? `Quedan ${formatearMonto(documento.importeEnCuenta)} en cuenta corriente`
              : "Queda en cuenta corriente"}
          </p>
        )}

        {/*
          * El acopio se dice en el papel, fuerte: es la diferencia entre "me
          * llevo esto" y "esto queda acá y lo retiro en partes". Cada retiro
          * sale después con su remito.
          */}
        {documento.acopio && (
          <p className="aviso">
            MERCADERÍA EN ACOPIO. Queda en depósito; cada retiro sale con su
            remito.
          </p>
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
            Consultas por WhatsApp: {telefonoLegible(documento.whatsapp)}

          </p>
        )}
      </div>
    </div>
  );
}
