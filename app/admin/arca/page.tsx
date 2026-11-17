import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { BookOpen, CircleAlert, Settings } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { SelectorDeMes } from "@/components/admin/selector-de-mes";
import { hoyEnArgentina, moneda, plural } from "@/lib/formato";
import { leerPeriodoMensual } from "@/lib/periodos";
import {
  configuracionFiscalActual,
  estadoArca,
  libroIvaVentas,
  resumenFacturacion,
} from "@/lib/dal/admin/facturacion";
import { libroIvaCompras } from "@/lib/dal/admin/compras-fiscal";
import { creditoPorRetenciones } from "@/lib/dal/admin/retenciones-sufridas";
import { daCreditoFiscal } from "@/lib/fiscal/comprobantes-compra";

export const metadata: Metadata = { title: "ARCA" };

const REGIMENES: Record<string, string> = {
  local: "Local",
  convenio_multilateral: "Convenio Multilateral",
  exento: "Exento",
  no_inscripto: "No inscripto",
};

const IMPUESTOS: Record<string, string> = {
  ganancias: "Ganancias",
  iva: "IVA",
  suss: "SUSS",
  iibb: "Ingresos Brutos",
};

/**
 * El mes que se declara: el anterior al de hoy (hora argentina). El IVA de
 * octubre se presenta en noviembre, así que quien abre la pantalla en
 * noviembre viene a ver octubre.
 */
function mesADeclarar(): string {
  const [anio, mes] = hoyEnArgentina().split("-").map(Number);
  return mes === 1
    ? `${anio - 1}-12`
    : `${anio}-${String(mes - 1).padStart(2, "0")}`;
}

/**
 * Los impuestos del mes.
 *
 * Antes la pantalla mostraba siempre el mes en curso, sin forma de cambiarlo,
 * y el IVA se declara del mes anterior: el número que se buscaba no estaba.
 * Además arrancaba con la configuración (emisor, puntos de venta, la conexión)
 * que se toca una vez por año; eso pasó a /admin/arca/configuracion, detrás
 * de un botón. Acá queda lo de todos los meses: la posición de IVA, lo
 * percibido de Ingresos Brutos, las retenciones sufridas y los libros, todo
 * del mes elegido con el mismo selector que los libros y el cierre.
 *
 * La posición es débito menos crédito computable: solo dan crédito los
 * comprobantes que discriminan IVA (la B y la C lo llevan adentro y sumarlas
 * infla la posición contra un papel que no la respalda). Las retenciones
 * sufridas se muestran aparte y no se restan: cuáles se computan contra qué
 * lo decide el contador.
 */
export default async function ArcaPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  // El mes por omisión depende del reloj: con Cache Components, leerlo sin
  // haber leído antes algo del pedido es un error de compilación.
  await connection();
  const { periodo: crudo } = await searchParams;
  const periodo = leerPeriodoMensual(crudo ?? mesADeclarar(), new Date());

  const [emisor, estado, resumen, libro, compras, retenciones] =
    await Promise.all([
      configuracionFiscalActual(),
      estadoArca(),
      resumenFacturacion(),
      libroIvaVentas(periodo.clave),
      libroIvaCompras(periodo.desde, periodo.hasta),
      creditoPorRetenciones(periodo.desde, periodo.hasta),
    ]);

  const etiqueta = new Date(periodo.anio, periodo.mes - 1, 1).toLocaleDateString(
    "es-AR",
    { month: "long", year: "numeric" },
  );
  const debito = libro.totales.iva21 + libro.totales.iva105 + libro.totales.iva27;
  const credito = compras.filas
    .filter((f) => daCreditoFiscal(f.tipo))
    .reduce((s, f) => s + f.iva21 + f.iva105 + f.iva27, 0);
  const posicion = debito - credito;
  const conMes = (ruta: string) => `${ruta}?periodo=${periodo.clave}`;

  return (
    <div className="space-y-6">
      <EncabezadoPanel titulo="Impuestos del mes" resumen={etiqueta}>
        <SelectorDeMes actual={periodo.clave} />
        <Link
          href="/admin/arca/configuracion"
          className="tarjeta inline-flex h-11 items-center gap-2 px-3.5 text-base font-medium transition-colors hover:text-acento-texto"
        >
          <Settings className="h-5 w-5" />
          Configuración
        </Link>
      </EncabezadoPanel>

      {(!estado.operativo || resumen.pendientesDeAutorizar > 0) && (
        <section className="tarjeta-atencion flex flex-wrap items-center gap-3 p-4">
          <CircleAlert className="h-5 w-5 shrink-0 text-brand-orange" />
          <p className="flex-1 text-base font-medium">
            {!estado.operativo
              ? "Sin conexión con ARCA"
              : `${plural(resumen.pendientesDeAutorizar, "comprobante")} sin autorizar`}
          </p>
          <Link
            href={estado.operativo ? "/admin/facturacion" : "/admin/arca/configuracion"}
            className="tarjeta inline-flex h-11 items-center px-3.5 text-base font-medium"
          >
            {estado.operativo ? "Ir a facturación" : "Ver qué falta"}
          </Link>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <Cifra titulo="IVA débito" valor={debito} />
        <Cifra titulo="IVA crédito computable" valor={credito} />
        <Cifra
          titulo={posicion >= 0 ? "IVA a pagar" : "Saldo a favor"}
          valor={Math.abs(posicion)}
          destacado
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="tarjeta p-5">
          <h2 className="text-lg font-semibold">IVA por alícuota</h2>
          <table className="mt-3 w-full text-left text-base">
            <tbody className="divide-y divide-linea-suave">
              <Fila titulo="Neto gravado" valor={libro.totales.neto} />
              <Fila titulo="IVA 21 %" valor={libro.totales.iva21} />
              <Fila titulo="IVA 10,5 %" valor={libro.totales.iva105} />
              <Fila titulo="Exento" valor={libro.totales.exento} />
              <Fila titulo="Total facturado" valor={libro.totales.total} fuerte />
            </tbody>
          </table>
        </section>

        <section className="tarjeta p-5">
          <h2 className="text-lg font-semibold">Ingresos Brutos</h2>
          <table className="mt-3 w-full text-left text-base">
            <tbody className="divide-y divide-linea-suave">
              <tr>
                <td className="py-2.5 text-muted-foreground">Régimen</td>
                <td className="py-2.5 text-right">
                  {REGIMENES[emisor.regimenIibb] ?? emisor.regimenIibb}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-muted-foreground">Percibe a clientes</td>
                <td className="py-2.5 text-right">
                  {emisor.percibeIibb
                    ? `Sí, ${Number(emisor.alicuotaPercepcionIibb)} %`
                    : "No"}
                </td>
              </tr>
              <Fila titulo="Percibido" valor={libro.totales.tributos} />
              <Fila
                titulo="Percepciones sufridas en compras"
                valor={compras.totales.percepciones}
              />
            </tbody>
          </table>
        </section>
      </div>

      <section className="tarjeta p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Retenciones sufridas</h2>
          <Link
            href={conMes("/admin/arca/retenciones")}
            className="text-base font-medium text-acento-texto hover:underline"
          >
            Ver y cargar
          </Link>
        </div>
        {retenciones.length === 0 ? (
          <p className="mt-2 text-base text-muted-foreground">
            Ninguna en {etiqueta}.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {retenciones.map((r) => (
              <div key={r.impuesto} className="tarjeta-hundida p-4">
                <p className="text-base text-muted-foreground">
                  {IMPUESTOS[r.impuesto] ?? r.impuesto}
                </p>
                <p className="tabular text-xl font-semibold">
                  {moneda.format(Number(r.total))}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-wrap gap-3">
        <Link
          href={conMes("/admin/arca/libro-iva")}
          className="tarjeta inline-flex h-11 items-center gap-2 px-4 text-base font-medium transition-colors hover:text-acento-texto"
        >
          <BookOpen className="h-5 w-5" />
          Libro IVA ventas · {plural(libro.filas.length, "comprobante")}
        </Link>
        <Link
          href={conMes("/admin/arca/libro-iva-compras")}
          className="tarjeta inline-flex h-11 items-center gap-2 px-4 text-base font-medium transition-colors hover:text-acento-texto"
        >
          <BookOpen className="h-5 w-5" />
          Libro IVA compras · {plural(compras.filas.length, "comprobante")}
        </Link>
        <Link
          href={conMes("/admin/cierre")}
          className="tarjeta inline-flex h-11 items-center gap-2 px-4 text-base font-medium transition-colors hover:text-acento-texto"
        >
          Cierre del mes
        </Link>
      </section>
    </div>
  );
}

function Cifra({
  titulo,
  valor,
  destacado = false,
}: {
  titulo: string;
  valor: number;
  destacado?: boolean;
}) {
  return (
    <div className={destacado ? "tarjeta p-5" : "tarjeta-hundida p-5"}>
      <p className="text-base font-semibold text-texto-2">{titulo}</p>
      <p className="tabular mt-1 text-[34px] font-bold leading-none tracking-[-0.03em]">
        {moneda.format(valor)}
      </p>
    </div>
  );
}

function Fila({
  titulo,
  valor,
  fuerte = false,
}: {
  titulo: string;
  valor: number;
  fuerte?: boolean;
}) {
  return (
    <tr className={fuerte ? "font-semibold" : ""}>
      <td className={`py-2.5 ${fuerte ? "" : "text-muted-foreground"}`}>{titulo}</td>
      <td className="tabular py-2.5 text-right">{moneda.format(valor)}</td>
    </tr>
  );
}
