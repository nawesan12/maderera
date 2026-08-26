import { BotonImprimir } from "@/components/fiscal/boton-imprimir";
import { fechaCorta, fechaHora, formatearUnidad } from "@/lib/formato";
import type { ConfiguracionFiscal } from "@/lib/db/schema";
import type { RemitoCompleto } from "@/lib/dal/admin/entregas";

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

  return (
    <div className="comprobante-hoja">
      <div className="barra no-imprimir">
        <BotonImprimir />
      </div>

      <div className="hoja">
        {anulado && <div className="marca-agua">Anulado</div>}

        <header className="cabecera">
          <div>
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
            <p className="titulo">Remito de entrega</p>
            <p className="numero">{remito.numero}</p>
            <div className="datos">
              <div>Fecha {fechaCorta.format(remito.createdAt)}</div>
              <div>Pedido {remito.pedidoNumero}</div>
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
              <span>Retira</span>
              <strong>{remito.receptorNombre || "—"}</strong>
            </div>
            {remito.clienteDireccion && (
              <div>
                <span>Domicilio de entrega</span>
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
                <td>{linea.descripcion}</td>
                <td className="der mono">{linea.cantidad}</td>
                <td className="der">{formatearUnidad(linea.unidad)}</td>
              </tr>
            ))}
          </tbody>
        </table>

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
                  {remito.firmadoAt ? fechaHora.format(remito.firmadoAt) : "—"}
                  {remito.receptorNombre ? ` por ${remito.receptorNombre}` : ""}
                </p>
              </>
            ) : (
              <div className="firma-vacia" />
            )}
          </div>

          <div className="firma-caja">
            <p className="etiqueta">Aclaración y documento</p>
            <div className="firma-vacia" />
          </div>
        </section>

        <p className="leyenda">
          Documento no válido como factura. Los importes se detallan en el
          comprobante fiscal correspondiente.
        </p>
      </div>
    </div>
  );
}
