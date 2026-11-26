import { BotonImprimir } from "@/components/fiscal/boton-imprimir";
import { formatearMonto, formatearUnidad, unidadDeVenta, unidadEnPlural } from "@/lib/formato";
import { fechaDelRemito, fechaHoraDeFirma } from "@/lib/entregas/fecha";
import type { obtenerConfiguracionFiscal } from "@/lib/fiscal/emitir";

type ConfiguracionFiscal = Awaited<ReturnType<typeof obtenerConfiguracionFiscal>>;
import type { RemitoCompleto } from "@/lib/dal/admin/entregas";
import { LogoEmisor } from "@/components/impresion/logo-emisor";
import { lineasDeLaFactura } from "@/lib/entregas/factura-del-remito";

/**
 * El remito en papel.
 *
 * Reemplaza al talonario: es lo que se le da a quien retira y lo que queda como
 * constancia de qué salió del depósito y quién se lo llevó.
 *
 * **No lleva precios.** Un remito documenta una entrega, no una venta; el
 * importe va en la factura. Ponerlo acá haría que el flete que retira la
 * mercadería vea lo que pagó el cliente.
 *
 * Comparte la hoja de estilos del comprobante fiscal —la misma tipografía, las
 * mismas medidas en milímetros— para que los dos papeles de la empresa se
 * reconozcan como de la misma casa.
 */
export function RemitoImpreso({
  remito,
  emisor,
}: {
  remito: RemitoCompleto;
  emisor: ConfiguracionFiscal | null;
}) {
  const anulado = remito.estado === "anulada";

  /*
   * Completo o de acopio, con las palabras que pidió la clienta.
   *
   * Estaba solo en el PDF (`lib/pdf/remito.ts`): el mismo remito decía "Remito
   * de entrega parcial" bajado como PDF y "Remito de entrega" impreso desde la
   * pantalla, y no listaba lo que quedaba guardado. Dos papeles con el mismo
   * número diciendo cosas distintas es peor que cualquiera de los dos.
   */
  const deAcopio = remito.pendientes.length > 0;
  const envio = remito.tipo === "envio";

  return (
    <div className="comprobante-hoja">
      <div className="barra no-imprimir">
        <BotonImprimir />
      </div>

      <div className="hoja">
        {anulado && <div className="marca-agua">Anulado</div>}

        <header className="cabecera">
          <div>
            <LogoEmisor />
            <p className="razon">
              {emisor?.razonSocial || "Maderera Juan B. Justo"}
            </p>
            {emisor?.nombreFantasia && (
              <p className="fantasia">{emisor.nombreFantasia}</p>
            )}
            <div className="datos">
              {emisor?.domicilio && <div>{emisor.domicilio}</div>}
              {emisor?.cuit && <div>CUIT {emisor.cuit}</div>}
              {remito.sucursal && (
                <div>
                  {remito.sucursal}
                  {remito.sucursalDireccion
                    ? ` · ${remito.sucursalDireccion}`
                    : ""}
                </div>
              )}
            </div>
          </div>

          <div className="letra-caja">
            <span className="letra">R</span>
            <span className="codigo">REMITO</span>
          </div>

          <div className="comprobante-datos">
            <p className="titulo">
              {deAcopio ? "Remito de entrega parcial" : "Remito de entrega total"}
            </p>
            <p className="numero">{remito.numero}</p>
            <div className="datos">
              <div>Fecha {fechaDelRemito.format(remito.createdAt)}</div>
              <div>Pedido {remito.pedidoNumero}</div>
              {/* La factura con su CAE: el CAE es de la factura, y el remito
                  dice con cuál viaja la mercadería. */}
              {lineasDeLaFactura(remito.factura).map((linea) => (
                <div key={linea}>{linea}</div>
              ))}
              <div>
                {remito.tipo === "envio" ? "Envío a domicilio" : "Retiro en sucursal"}
              </div>
            </div>
          </div>
        </header>

        <section className="receptor">
          <p className="etiqueta">Destinatario</p>
          <div className="receptor-grilla">
            <div>
              <span>Cliente</span>
              <strong>{remito.clienteNombre}</strong>
            </div>
            <div>
              <span>{envio ? "Recibe" : "Retira"}</span>
              <strong>{remito.receptorNombre || "—"}</strong>
            </div>
            {remito.clienteDireccion && (
              <div>
                {/* En un retiro no se entrega nada en esa dirección: es el
                    domicilio del cliente y va como dato de la ficha. Rotularlo
                    "domicilio de entrega" en un remito de mostrador invita a
                    cargar el camión para un pedido que la persona ya se llevó. */}
                <span>
                  {remito.tipo === "envio"
                    ? "Domicilio de entrega"
                    : "Domicilio del cliente"}
                </span>
                <strong>{remito.clienteDireccion}</strong>
              </div>
            )}
            {remito.receptorDocumento && (
              <div>
                <span>Documento</span>
                <strong className="mono">{remito.receptorDocumento}</strong>
              </div>
            )}
            {remito.transportista && (
              <div>
                <span>Transporte</span>
                <strong>
                  {remito.transportista}
                  {remito.numeroSeguimiento
                    ? ` · ${remito.numeroSeguimiento}`
                    : ""}
                </strong>
              </div>
            )}
            {/* Si lo que sale está pago o no: quien entrega tiene que saberlo
                sin ir a buscar la factura. Sin los precios de los renglones;
                en un envío contra entrega, cuánto traer y en qué medio
                (pdf.CondicionDePago, el mismo texto del PDF). */}
            <div>
              <span>Condición de pago</span>
              <strong>{condicionDePago(remito)}</strong>
            </div>
          </div>
        </section>

        <table className="detalle">
          <thead>
            <tr>
              <th>Descripción</th>
              <th className="der">Cantidad</th>
              <th className="der">Unidad</th>
            </tr>
          </thead>
          <tbody>
            {remito.lineas.map((linea, i) => (
              <tr key={i}>
                <td>
                  {linea.descripcion}
                  {/* Lo que sale cortado y según qué corte. */}
                  {linea.corte && <span className="chico" style={{ display: "block" }}>{linea.corte}</span>}
                </td>
                <td className="der mono">{linea.cantidad}</td>
                <td className="der">{unidadDe(linea.unidad, linea.cantidad, linea.descripcion)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Qué le queda guardado. No alcanza con decir "entrega parcial": la
            pregunta que se hace el cliente al leerlo es *qué* le queda, y si el
            papel no lo dice hay que llamar. Sin importes, como todo el remito. */}
        {deAcopio && (
          <section className="acopio">
            {/* En un envío no es acopio: es lo que falta llevar (lo que no
                había, o el segundo viaje). */}
            <p className="etiqueta">{envio ? "Falta entregar" : "Queda en acopio"}</p>
            <ul>
              {remito.pendientes.map((p, i) => (
                <li key={i}>
                  <span className="mono">{p.pendiente}</span>{" "}
                  {unidadDe(p.unidad, p.pendiente, p.descripcion)} · {p.descripcion}
                </li>
              ))}
            </ul>
            {!envio && (
              <p className="chico">
                Esta mercadería queda guardada en la maderera a nombre del cliente
                y se retira contra este remito.
              </p>
            )}
          </section>
        )}

        {remito.notas && (
          <p className="observaciones">{remito.notas}</p>
        )}

        <section className="firma-zona">
          <div className="firma-caja">
            <p className="etiqueta">Firma de quien recibe</p>

            {remito.firmaUrl ? (
              <>
                {/* Imagen sin optimizar a propósito: es una firma en un
                    documento y tiene que salir en la impresión tal cual se
                    trazó, sin pasar por un redimensionado. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={remito.firmaUrl}
                  alt={`Firma de ${remito.receptorNombre ?? "quien retiró"}`}
                  className="firma-imagen"
                />
                <p className="chico">
                  Firmado el{" "}
                  {remito.firmadoAt ? fechaHoraDeFirma.format(remito.firmadoAt) : "—"}
                </p>
              </>
            ) : (
              <div className="firma-vacia" />
            )}
          </div>

          <div className="firma-caja">
            <p className="etiqueta">Aclaración y documento</p>
            {/* Firmado en la pantalla, la aclaración es quien firmó: el
                recuadro quedaba en blanco y el nombre iba debajo de la firma
                (mes simulado). Sin firma, en blanco para el papel. */}
            {remito.firmaUrl && remito.receptorNombre ? (
              <div className="firma-aclaracion">
                <strong>{remito.receptorNombre}</strong>
                {remito.receptorDocumento && <span className="mono">{remito.receptorDocumento}</span>}
              </div>
            ) : (
              <div className="firma-vacia" />
            )}
          </div>
        </section>

        {/* Sin factura no se manda a buscar los importes a un comprobante
            que no existe (decía «Sin factura asociada» arriba). */}
        <p className="leyenda">
          {remito.factura
            ? "Documento no válido como factura. Los importes se detallan en el comprobante fiscal correspondiente."
            : "Documento no válido como factura."}
        </p>
      </div>
    </div>
  );
}

/** La unidad concordada: «placas», «rollos»; lo abreviado no cambia. */
function unidadDe(unidad: string, cantidad: number, descripcion: string): string {
  if (unidad === "pasada") return cantidad === 1 ? "corte" : "cortes";
  const u = formatearUnidad(unidadDeVenta(unidad, descripcion));
  return cantidad === 1 ? u : unidadEnPlural(u);
}

const MEDIO: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  debito: "Débito",
  credito: "Crédito",
  mercado_pago: "Mercado Pago",
  cheque: "Cheque",
};

/** Gemelo de pdf.CondicionDePago (backend/internal/pdf/remito.go). */
function condicionDePago(r: RemitoCompleto): string {
  if (r.tipo === "envio" && r.sinCobrar != null && r.sinCobrar > 0.009 && r.medioPago !== "cuenta_corriente") {
    const medio = r.medioPago ? MEDIO[r.medioPago] : null;
    return `A cobrar ${formatearMonto(r.sinCobrar)}${medio ? ` · ${medio}` : ""}`;
  }
  switch (r.estadoPago) {
    case "pagado":
      return "Pagado";
    case "parcial":
      return "Pagado en parte · resto en cuenta corriente";
    case "pendiente":
      return r.medioPago === "cuenta_corriente" ? "Cuenta corriente" : "Pendiente de pago";
    case "reintegrado":
      return "Reintegrado";
    case "rechazado":
      return "Pago rechazado";
    default:
      return "—";
  }
}
