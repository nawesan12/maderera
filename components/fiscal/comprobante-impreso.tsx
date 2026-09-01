import { BotonImprimir } from "./boton-imprimir";
import { qrSvg } from "@/lib/fiscal/qr";
import {
  discriminaIva,
  letraDe,
  nombreComprobante,
  numeroFormateado,
  type TipoComprobante,
} from "@/lib/fiscal/comprobantes";
import {
  fechaCorta,
  fechaSolaCorta,
  formatearCuit,
  formatearUnidad,
  moneda,
} from "@/lib/formato";
import type { ConfiguracionFiscal } from "@/lib/db/schema";

const CONDICIONES: Record<string, string> = {
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Responsable monotributo",
  exento: "IVA exento",
  consumidor_final: "Consumidor final",
  no_categorizado: "No categorizado",
};

interface ComprobanteImprimible {
  id: string;
  tipo: TipoComprobante;
  puntoVenta: number;
  numero: number;
  estado: string;
  receptorNombre: string;
  receptorCuit: string | null;
  receptorCondicionIva: string;
  receptorDomicilio: string | null;
  neto: string;
  iva21: string;
  iva105: string;
  exento: string;
  tributosTotal: string;
  total: string;
  cae: string | null;
  caeVencimiento: Date | null;
  fechaEmision: Date;
  fechaVencimiento: Date | null;
  observaciones: string | null;
  items: {
    id: string;
    descripcion: string;
    unidad: string;
    cantidad: string;
    precioUnitario: string;
    alicuotaIva: string;
    subtotal: string;
  }[];
  tributos: {
    id: string;
    descripcion: string;
    alicuota: string;
    importe: string;
  }[];
}

/**
 * El comprobante como se imprime.
 *
 * Sigue el formato que exige ARCA: la letra en un recuadro al centro, los datos
 * del emisor a la izquierda, el número y la fecha a la derecha, y abajo el CAE
 * con su vencimiento y el QR de verificación.
 *
 * Cuando no hay CAE se imprime una marca de agua diciéndolo. Un comprobante sin
 * autorizar que parece una factura es peor que no tener nada: alguien lo entrega
 * creyendo que está todo bien.
 */
export async function ComprobanteImpreso({
  comprobante,
  emisor,
}: {
  comprobante: ComprobanteImprimible;
  emisor: ConfiguracionFiscal;
}) {
  const letra = letraDe(comprobante.tipo);
  const discrimina = discriminaIva(comprobante.tipo);
  const anulada = comprobante.estado === "anulada";

  const qr =
    comprobante.cae && emisor.cuit
      ? await qrSvg({
          fecha: comprobante.fechaEmision,
          cuitEmisor: emisor.cuit,
          puntoVenta: comprobante.puntoVenta,
          tipo: comprobante.tipo,
          numero: comprobante.numero,
          total: Number(comprobante.total),
          receptorCuit: comprobante.receptorCuit,
          cae: comprobante.cae,
        })
      : null;

  return (
    <div className="comprobante-hoja">
      <div className="no-imprimir barra">
        <BotonImprimir />
      </div>

      {(!comprobante.cae || anulada) && (
        <div className="marca-agua" aria-hidden>
          {anulada ? "Anulada" : "Sin valor fiscal"}
        </div>
      )}

      <div className="hoja">
        {/* Cabecera con la letra en el medio, como exige el formato */}
        <header className="cabecera">
          <div className="emisor">
            <p className="razon">{emisor.razonSocial}</p>
            {emisor.nombreFantasia && (
              <p className="fantasia">{emisor.nombreFantasia}</p>
            )}
            <p className="datos">
              {emisor.domicilio && <>{emisor.domicilio}<br /></>}
              {emisor.localidad}
              {emisor.codigoPostal ? ` (${emisor.codigoPostal})` : ""}
              <br />
              CUIT: {formatearCuit(emisor.cuit)}
              <br />
              {CONDICIONES[emisor.condicionIva] ?? emisor.condicionIva}
              {emisor.ingresosBrutos && (
                <>
                  <br />
                  Ingresos Brutos: {emisor.ingresosBrutos}
                </>
              )}
              {emisor.inicioActividades && (
                <>
                  <br />
                  Inicio de actividades:{" "}
                  {fechaSolaCorta.format(emisor.inicioActividades)}
                </>
              )}
            </p>
          </div>

          <div className="letra-caja">
            <span className="letra">{letra}</span>
            <span className="codigo">COD. {codigoImpreso(comprobante.tipo)}</span>
          </div>

          <div className="comprobante-datos">
            <p className="titulo">{nombreComprobante(comprobante.tipo)}</p>
            <p className="numero">
              {numeroFormateado(comprobante.puntoVenta, comprobante.numero)}
            </p>
            <p className="datos">
              Fecha de emisión: {fechaCorta.format(comprobante.fechaEmision)}
              {comprobante.fechaVencimiento && (
                <>
                  <br />
                  Vencimiento del pago:{" "}
                  {fechaCorta.format(comprobante.fechaVencimiento)}
                </>
              )}
            </p>
          </div>
        </header>

        {/* Receptor */}
        <section className="receptor">
          <p className="etiqueta">Datos del cliente</p>
          <div className="receptor-grilla">
            <p>
              <span>Razón social</span>
              <strong>{comprobante.receptorNombre}</strong>
            </p>
            <p>
              <span>CUIT / DNI</span>
              <strong className="mono">
                {comprobante.receptorCuit
                  ? formatearCuit(comprobante.receptorCuit)
                  : "—"}
              </strong>
            </p>
            <p>
              <span>Condición frente al IVA</span>
              <strong>
                {CONDICIONES[comprobante.receptorCondicionIva] ??
                  comprobante.receptorCondicionIva}
              </strong>
            </p>
            <p>
              <span>Domicilio</span>
              <strong>{comprobante.receptorDomicilio ?? "—"}</strong>
            </p>
          </div>
        </section>

        {/* Detalle */}
        <table className="detalle">
          <thead>
            <tr>
              <th>Descripción</th>
              <th className="der">Cant.</th>
              <th className="der">P. unitario</th>
              {discrimina && <th className="der">IVA</th>}
              <th className="der">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {comprobante.items.map((item) => {
              const cantidad = Number(item.cantidad);
              const unitario = discrimina
                ? Number(item.precioUnitario)
                : cantidad > 0
                  ? Number(item.subtotal) / cantidad
                  : 0;

              return (
                <tr key={item.id}>
                  <td>{item.descripcion}</td>
                  <td className="der mono">
                    {cantidad} {item.unidad === "unidad" ? "" : formatearUnidad(item.unidad)}
                  </td>
                  <td className="der mono">{moneda.format(unitario)}</td>
                  {discrimina && (
                    <td className="der mono">{Number(item.alicuotaIva)}%</td>
                  )}
                  <td className="der mono">
                    {moneda.format(Number(item.subtotal))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Totales */}
        <section className="totales">
          <div className="totales-caja">
            {discrimina ? (
              <>
                <Linea etiqueta="Neto gravado" valor={comprobante.neto} />
                {Number(comprobante.iva21) > 0 && (
                  <Linea etiqueta="IVA 21%" valor={comprobante.iva21} />
                )}
                {Number(comprobante.iva105) > 0 && (
                  <Linea etiqueta="IVA 10,5%" valor={comprobante.iva105} />
                )}
                {Number(comprobante.exento) > 0 && (
                  <Linea etiqueta="Exento" valor={comprobante.exento} />
                )}
              </>
            ) : (
              <Linea
                etiqueta="Subtotal"
                valor={String(
                  Number(comprobante.total) - Number(comprobante.tributosTotal),
                )}
              />
            )}

            {comprobante.tributos.map((tributo) => (
              <Linea
                key={tributo.id}
                etiqueta={`${tributo.descripcion} ${Number(tributo.alicuota)}%`}
                valor={tributo.importe}
              />
            ))}

            <div className="total-final">
              <span>Total</span>
              <span className="mono">
                {moneda.format(Number(comprobante.total))}
              </span>
            </div>
          </div>
        </section>

        {comprobante.observaciones && (
          <section className="observaciones">
            <p className="etiqueta">Observaciones</p>
            <p>{comprobante.observaciones}</p>
          </section>
        )}

        {/* Pie fiscal */}
        <footer className="pie">
          {qr ? (
            <>
              <div
                className="qr"
                // El QR viene de `qrcode` como SVG generado en el servidor a
                // partir de datos propios: no hay entrada de terceros.
                dangerouslySetInnerHTML={{ __html: qr }}
              />
              <div className="cae">
                <p>
                  <strong>CAE:</strong>{" "}
                  <span className="mono">{comprobante.cae}</span>
                </p>
                {comprobante.caeVencimiento && (
                  <p>
                    <strong>Vencimiento del CAE:</strong>{" "}
                    <span className="mono">
                      {fechaCorta.format(comprobante.caeVencimiento)}
                    </span>
                  </p>
                )}
                <p className="chico">
                  Comprobante autorizado por ARCA. Verificable con el código QR.
                </p>
              </div>
            </>
          ) : (
            <p className="sin-cae">
              Comprobante sin autorización de ARCA: <strong>no tiene valor
              fiscal</strong>. Uso interno hasta que se lo autorice.
            </p>
          )}
        </footer>

        {emisor.leyenda && <p className="leyenda">{emisor.leyenda}</p>}
      </div>
    </div>
  );
}

function Linea({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="linea">
      <span>{etiqueta}</span>
      <span className="mono">{moneda.format(Number(valor))}</span>
    </div>
  );
}

/** Código numérico del comprobante, que va debajo de la letra. */
function codigoImpreso(tipo: TipoComprobante): string {
  const codigos: Record<string, string> = {
    factura_a: "01",
    nota_debito_a: "02",
    nota_credito_a: "03",
    factura_b: "06",
    nota_debito_b: "07",
    nota_credito_b: "08",
    factura_c: "11",
    nota_debito_c: "12",
    nota_credito_c: "13",
  };
  return codigos[tipo] ?? "01";
}
