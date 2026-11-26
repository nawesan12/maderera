import type { Metadata } from "next";
import Link from "next/link";
import { Receipt } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { SelectorDeMes } from "@/components/admin/selector-de-mes";
import { Vacio } from "@/components/admin/vacio";
import { ETIQUETA_CIRCUITO, etiquetaDeCircuito } from "@/lib/circuito";
import { FiltroDeCircuito } from "./filtro";
import { requireStaffRole } from "@/lib/dal/session";
import {
  gastosPorCategoria,
  gastosPorCircuito,
  listarGastos,
  sucursalesParaGasto,
} from "@/lib/dal/admin/gastos";
import { proveedoresParaElegir } from "@/lib/dal/admin/proveedores";
import { leerPeriodoMensual } from "@/lib/periodos";
import { fechaCorta, formatearMonto } from "@/lib/formato";
import { CargarGasto } from "./cargar";
import { AnularGasto } from "./anular";

export const metadata: Metadata = { title: "Gastos" };

const CATEGORIAS: Record<string, string> = {
  flete: "Fletes",
  combustible: "Combustible",
  servicios: "Servicios",
  alquiler: "Alquiler",
  sueldos: "Sueldos",
  mantenimiento: "Mantenimiento",
  impuestos: "Impuestos",
  librería: "Librería",
  publicidad: "Publicidad",
  otros: "Otros",
};

/**
 * Los gastos, con su enganche a la caja.
 *
 * Existe porque lo más cercano que había era el `retiro` de caja, que además
 * exige turno abierto: un gasto pagado por transferencia un domingo no tenía
 * dónde anotarse, y uno pagado en efectivo quedaba como "retiro" sin
 * clasificar. Al cierre del mes nadie podía decir cuánto se gastó en fletes.
 */
export default async function GastosPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; circuito?: string }>;
}) {
  await requireStaffRole("admin");

  const { periodo: crudo, circuito = "todos" } = await searchParams;
  const periodo = leerPeriodoMensual(crudo, new Date());

  const [todos, porCategoria, porCircuito, sucursales, proveedores] =
    await Promise.all([
      listarGastos({ desde: periodo.desde, hasta: periodo.hasta }),
      gastosPorCategoria(periodo.desde, periodo.hasta),
      gastosPorCircuito(periodo.desde, periodo.hasta),
      sucursalesParaGasto(),
      proveedoresParaElegir(),
    ]);

  const gastos =
    circuito === "todos" ? todos : todos.filter((g) => g.circuito === circuito);

  const etiqueta = new Date(periodo.anio, periodo.mes - 1, 1).toLocaleDateString(
    "es-AR",
    { month: "long", year: "numeric" },
  );
  const total = porCategoria.reduce((s, c) => s + Number(c.total), 0);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Gastos"
        resumen={
          total > 0
            ? `${formatearMonto(total)} en ${etiqueta}`
            : `Sin gastos en ${etiqueta}`
        }
      >
        <SelectorDeMes actual={periodo.clave} />
      </EncabezadoPanel>

      <FiltroDeCircuito actual={circuito} />

      {/* Los dos circuitos, uno al lado del otro.

          Es el número por el que se pidió la columna: el total del mes sumado
          no contesta nada si la mitad salió por cada lado. */}
      {porCircuito.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["blanco", "negro"] as const).map((c) => {
            const fila = porCircuito.find((x) => x.circuito === c);
            return (
              <Link
                key={c}
                href={`/admin/compras/gastos?periodo=${periodo.clave}&circuito=${c}`}
                className="tarjeta block p-4 transition-colors hover:border-brand-orange/40 hover:bg-hundida"
              >
                <p className="text-sm text-muted-foreground">
                  {ETIQUETA_CIRCUITO[c]} · {etiqueta}
                </p>
                <p className="tabular mt-0.5 text-2xl font-bold">
                  {formatearMonto(Number(fila?.total ?? 0))}
                </p>
                <p className="text-sm text-muted-foreground">
                  {fila?.cantidad ?? 0} gasto
                  {(fila?.cantidad ?? 0) === 1 ? "" : "s"}
                </p>
              </Link>
            );
          })}
        </div>
      )}

      {porCategoria.length > 0 && (
        <section className="tarjeta overflow-hidden">
          <header className="border-b border-linea px-5 py-3.5">
            <h2 className="text-base font-semibold">
              Por categoría · {etiqueta}
            </h2>
          </header>
          <ul className="divide-y divide-linea">
            {porCategoria.map((c) => (
              <li
                key={c.categoria}
                className="flex items-center gap-3 px-5 py-2.5"
              >
                <span className="min-w-0 flex-1">
                  {CATEGORIAS[c.categoria] ?? c.categoria}
                  <span className="ml-2 text-sm text-muted-foreground">
                    ({c.cantidad})
                  </span>
                </span>
                {/* La barra vale más que el porcentaje solo: el ojo encuentra
                    la categoría que se lleva la mitad sin leer números. */}
                <span className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-hundida sm:block">
                  <span
                    className="block h-full rounded-full bg-accion"
                    style={{ width: `${(Number(c.total) / total) * 100}%` }}
                  />
                </span>
                <span className="tabular shrink-0 font-semibold">
                  {formatearMonto(Number(c.total))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <CargarGasto
        sucursales={sucursales.map((s) => ({
          id: s.id,
          nombre: s.nombre,
          conTurno: Boolean(s.turnoAbierto),
          deLaSesion: s.deLaSesion,
          enCaja: s.enCaja,
          cambioFijo: s.cambioFijo,
        }))}
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
      />

      <section className="tarjeta @container overflow-hidden">
        {gastos.length === 0 ? (
          <Vacio icono={Receipt} titulo={`Sin gastos en ${etiqueta}`} />
        ) : (
          <>
            <table className="hidden w-full text-base @4xl:table" data-tabla="fija">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2.5 font-semibold">Fecha</th>
                  <th className="px-5 py-2.5 font-semibold">Gasto</th>
                  <th className="px-5 py-2.5 font-semibold">Pago</th>
                  <th className="px-5 py-2.5 font-semibold">Circuito</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Importe</th>
                  <th className="w-14 px-2 py-2.5">
                    <span className="sr-only">Anular</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {gastos.map((g) => (
                  <tr key={g.id} className={g.anuladoAt ? "opacity-60" : undefined}>
                    <td className="tabular px-5 py-3 text-muted-foreground">{fechaCorta.format(g.fecha)}</td>
                    <td className="px-5 py-3">
                      <span className="block">{g.descripcion}</span>
                      <DeQuien g={g} />
                      <Anulado g={g} />
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      <Medio g={g} />
                    </td>
                    <td className="px-5 py-3">
                      <Circuito g={g} />
                    </td>
                    <td className={`tabular px-5 py-3 text-right font-semibold ${g.anuladoAt ? "line-through" : ""}`}>
                      {formatearMonto(Number(g.importe))}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <Anular g={g} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* En el teléfono: qué fue y cuánto arriba; a quién y de dónde,
                cada cosa en su renglón. Apilada, la descripción, el
                proveedor y la sucursal iban en tres columnitas de una palabra. */}
            <ul className="divide-y divide-linea @4xl:hidden">
              {gastos.map((g) => (
                <li key={g.id} className={`space-y-1 px-4 py-3 ${g.anuladoAt ? "opacity-60" : ""}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words text-base font-semibold">{g.descripcion}</span>
                    <span className={`tabular shrink-0 text-base font-semibold ${g.anuladoAt ? "line-through" : ""}`}>
                      {formatearMonto(Number(g.importe))}
                    </span>
                  </div>
                  <DeQuien g={g} />
                  <div className="flex items-center gap-2">
                    <p className="tabular flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span>{fechaCorta.format(g.fecha)}</span>
                      <span>·</span>
                      <Medio g={g} />
                      <Circuito g={g} />
                    </p>
                    <Anular g={g} />
                  </div>
                  <Anulado g={g} />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

type Gasto = Awaited<ReturnType<typeof listarGastos>>[number];

const MEDIOS: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  debito: "Débito",
  credito: "Crédito",
  cheque: "Cheque",
};

/** A quién se le pagó y en qué sucursal: el gasto suele ser la punta del ovillo. */
function DeQuien({ g }: { g: Gasto }) {
  return (
    <span className="block text-sm text-muted-foreground">
      {CATEGORIAS[g.categoria] ?? g.categoria}
      {g.proveedor && (
        <>
          {" · "}
          <Link href={`/admin/proveedores/${g.supplierId}`} className="hover:text-brand-orange hover:underline">
            {g.proveedor}
          </Link>
        </>
      )}
      {g.sucursal && ` · ${g.sucursal}`}
    </span>
  );
}

/** El motivo de la anulación, donde se lee el gasto. */
function Anulado({ g }: { g: Gasto }) {
  if (!g.anuladoAt) return null;
  return (
    <span className="block text-sm font-medium text-saldo-debe">
      Anulado{g.motivoAnulacion && ` · ${g.motivoAnulacion}`}
    </span>
  );
}

/** Anular, con lo que vuelve: el efectivo a la caja y la factura que vino con él. */
function Anular({ g }: { g: Gasto }) {
  if (g.anuladoAt) return null;
  return (
    <AnularGasto
      id={g.id}
      titulo={`Anular el gasto de ${formatearMonto(Number(g.importe))}: ${g.descripcion}`}
      detalle={[
        "Deja de contar en los gastos del mes.",
        g.enCaja ? `Los ${formatearMonto(Number(g.importe))} en efectivo vuelven a la caja${g.sucursal ? ` de ${g.sucursal}` : ""}.` : "",
        g.factura ? `La factura ${g.factura} queda anulada.` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

function Medio({ g }: { g: Gasto }) {
  return (
    <span>
      {MEDIOS[g.medio] ?? g.medio}
      {g.enCaja && " de la caja"}
    </span>
  );
}

/** El circuito y, si tiene, la factura: una sola marca, sin «Facturas · sin factura». */
function Circuito({ g }: { g: Gasto }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className={`rounded-full px-2.5 py-0.5 text-sm font-medium ${
          g.circuito === "negro" ? "bg-chip text-texto-2" : "bg-naranja-claro text-acento-sobre-claro"
        }`}
      >
        {etiquetaDeCircuito(g.circuito)}
      </span>
      {g.factura && g.purchaseInvoiceId && (
        <Link href={`/admin/compras/facturas/${g.purchaseInvoiceId}`} className="codigo text-sm hover:underline">
          {g.factura}
        </Link>
      )}
    </span>
  );
}
