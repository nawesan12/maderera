import { BotonImprimir } from "@/components/fiscal/boton-imprimir";
import { fechaCorta, formatearMonto } from "@/lib/formato";
import type { ConfiguracionFiscal } from "@/lib/db/schema";
import type { ResumenDeCuenta } from "@/lib/dal/admin/resumen-cuenta";

const NOMBRE_DEL_TIPO: Record<string, string> = {
  compra: "Compra",
  pago: "Pago",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  ajuste: "Ajuste",
};

/**
 * El resumen de cuenta en papel.
 *
 * Es lo que se le manda a un cliente con cuenta corriente cuando pregunta
 * cuánto debe, y hasta ahora había que armarlo a mano mirando la ficha del
 * panel, que además solo muestra los últimos veinte movimientos.
 *
 * **Lleva la columna de saldo acumulado**, que es la que se sigue con el dedo
 * cuando alguien discute un importe: sin ella hay que ir sumando de a uno para
 * encontrar dónde empezó la diferencia.
 *
 * Y lleva la antigüedad de la deuda, que es lo que convierte un número en una
 * decisión: medio millón de la semana pasada y medio millón de hace cuatro
 * meses son el mismo saldo y no el mismo problema.
 *
 * Comparte la hoja de estilos del comprobante fiscal y del remito, para que los
 * papeles de la empresa se reconozcan como de la misma casa.
 */
export function ResumenImpreso({
  resumen,
  emisor,
}: {
  resumen: ResumenDeCuenta;
  emisor: ConfiguracionFiscal | null;
}) {
  const { cliente, movimientos, saldo, aging } = resumen;

  return (
    <div className="comprobante-hoja">
      <div className="barra no-imprimir">
        <BotonImprimir />
      </div>

      <div className="hoja">
        <header className="cabecera">
          <div>
            <p className="razon">
              {emisor?.razonSocial || "Maderera Juan B. Justo"}
            </p>
            {emisor?.nombreFantasia && (
              <p className="fantasia">{emisor.nombreFantasia}</p>
            )}
            {emisor?.domicilio && <p className="chico">{emisor.domicilio}</p>}
            {emisor?.cuit && <p className="chico">CUIT {emisor.cuit}</p>}
          </div>

          <div className="der">
            <p className="numero">Resumen de cuenta</p>
            <p className="chico">Al {fechaCorta.format(new Date())}</p>
          </div>
        </header>

        <section className="comprobante-datos">
          <p className="etiqueta">Cliente</p>
          <p>
            <strong>{cliente.razonSocial ?? cliente.nombre}</strong>
          </p>
          {cliente.razonSocial && <p className="chico">{cliente.nombre}</p>}
          {cliente.cuit && <p className="chico">CUIT {cliente.cuit}</p>}
          {cliente.direccion && <p className="chico">{cliente.direccion}</p>}
        </section>

        {movimientos.length === 0 ? (
          <p className="leyenda">
            No hay movimientos en la cuenta corriente de este cliente.
          </p>
        ) : (
          <table className="detalle">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Concepto</th>
                <th className="der">Debe</th>
                <th className="der">Haber</th>
                <th className="der">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id}>
                  <td>{fechaCorta.format(m.fecha)}</td>
                  <td>
                    {m.detalle ?? NOMBRE_DEL_TIPO[m.tipo] ?? m.tipo}
                    {m.referencia && m.referencia !== m.detalle && (
                      <span className="chico"> · {m.referencia}</span>
                    )}
                  </td>
                  {/* Debe y haber en columnas separadas, como en cualquier
                      resumen: un solo importe con signo obliga a fijarse en el
                      menos para saber si sumó o restó. */}
                  <td className="der mono">
                    {m.monto > 0 ? formatearMonto(m.monto) : ""}
                  </td>
                  <td className="der mono">
                    {m.monto < 0 ? formatearMonto(-m.monto) : ""}
                  </td>
                  <td className="der mono">{formatearMonto(m.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <section className="comprobante-datos">
          <p className="etiqueta">
            {saldo > 0
              ? "Saldo deudor"
              : saldo < 0
                ? "Saldo a favor"
                : "Saldo"}
          </p>
          <p className="numero mono">{formatearMonto(Math.abs(saldo))}</p>

          {cliente.limiteCredito > 0 && (
            <p className="chico">
              Límite de crédito acordado: {formatearMonto(cliente.limiteCredito)}
            </p>
          )}
        </section>

        {aging.total > 0 && (
          <section className="comprobante-datos">
            <p className="etiqueta">Antigüedad de la deuda</p>

            <table className="detalle">
              <thead>
                <tr>
                  {aging.tramos.map((t) => (
                    <th key={t.etiqueta} className="der">
                      {t.etiqueta}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {aging.tramos.map((t) => (
                    <td key={t.etiqueta} className="der mono">
                      {t.monto > 0 ? formatearMonto(t.monto) : "—"}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>

            {aging.diasDeLaMasVieja !== null && aging.diasDeLaMasVieja > 30 && (
              <p className="chico">
                La deuda más antigua sin cancelar tiene{" "}
                {aging.diasDeLaMasVieja} días.
              </p>
            )}
          </section>
        )}

        <footer className="pie">
          <p className="leyenda">
            Los pagos se imputan a la deuda más antigua. Si encontrás una
            diferencia, escribinos y la revisamos.
          </p>
        </footer>
      </div>
    </div>
  );
}
