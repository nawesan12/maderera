import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { fechaHora } from "@/components/admin/formato";
import { verTraslado } from "@/lib/dal/admin/inventory";
import { unidadConcordada } from "@/lib/formato";
import { formatearCantidad } from "@/lib/unidades";
import { esUuid } from "@/lib/uuid";
import { AccionesDelTraslado } from "./acciones";

/**
 * El comprobante de un traslado entre sucursales: el remito interno que viaja
 * con el camión y firma quien recibe (mes simulado, H009). Mientras esté en
 * camino, «Recibir» suma lo que llegó al destino.
 *
 * Se imprime tal como se ve: `.hoja-sola` le saca al panel el menú y la
 * barra en el papel (globals.css).
 */
export default async function TrasladoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const t = await verTraslado(id);
  if (!t) notFound();
  // Recibido con diferencias: la columna de lo que llegó (M2S4-021).
  const conDiferencias = t.renglones.some((r) => r.recibido !== null && r.recibido !== r.cantidad);
  const unidad = (n: number, r: (typeof t.renglones)[number]) => unidadConcordada(n, r.unidad, `${r.producto} ${r.medida}`);

  return (
    <div className="hoja-sola mx-auto max-w-3xl space-y-6">
      <Link
        href="/admin/stock"
        className="no-imprimir inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Stock
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1>
            Traslado <span className="codigo">{t.codigo}</span>
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xl font-semibold">
            <span>{t.origen}</span>
            <ArrowRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">a</span>
            <span>{t.destino}</span>
          </p>
          <p className="tabular mt-1 text-base text-muted-foreground">
            {fechaHora.format(t.createdAt)}
            {t.creadoPor && ` · ${t.creadoPor}`}
          </p>
        </div>
        <EtiquetaEstado estado={t.estado} />
      </header>

      <AccionesDelTraslado
        id={t.id}
        codigo={t.codigo}
        enCamino={t.estado === "en-camino"}
        origenId={t.origenId}
        origen={t.origen}
        destino={t.destino}
        renglones={t.renglones.filter((r) => r.cantidad > 0)}
      />

      {t.estado === "anulado" && t.anuladoAt && (
        <p className="tarjeta-hundida tabular px-4 py-3 text-base">
          Anulado {fechaHora.format(t.anuladoAt)}
          {t.anuladoPor && ` · ${t.anuladoPor}`}
        </p>
      )}

      <section className="tarjeta overflow-hidden">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b text-left text-sm text-muted-foreground">
              <th className="px-4 py-3 font-medium">Producto</th>
              <th className="px-4 py-3 font-medium">Código</th>
              <th className="px-4 py-3 text-right font-medium">{conDiferencias ? "Mandado" : "Cantidad"}</th>
              {conDiferencias && <th className="px-4 py-3 text-right font-medium">Llegó</th>}
            </tr>
          </thead>
          <tbody>
            {t.renglones.map((r) => (
              <tr key={r.variantId} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3">
                  <span className="font-medium">{r.producto}</span>
                  <span className="text-muted-foreground"> · {r.medida}</span>
                </td>
                <td className="tabular px-4 py-3 text-muted-foreground">{r.sku}</td>
                <td className="tabular px-4 py-3 text-right text-lg font-semibold">
                  {formatearCantidad(r.cantidad)}{" "}
                  <span className="text-base font-normal text-muted-foreground">{unidad(r.cantidad, r)}</span>
                </td>
                {conDiferencias && (
                  <td
                    className={`tabular px-4 py-3 text-right text-lg font-semibold ${
                      r.recibido !== null && r.recibido < r.cantidad ? "text-saldo-debe" : ""
                    }`}
                  >
                    {formatearCantidad(r.recibido ?? 0)}{" "}
                    <span className="text-base font-normal text-muted-foreground">{unidad(r.recibido ?? 0, r)}</span>
                    {/* Mezclado (una medida se perdió y otra volvió), lo dice
                        cada renglón; si no, la línea de abajo. */}
                    {!t.faltante && r.faltante && (
                      <span className="block text-sm font-normal text-muted-foreground">
                        {r.faltante === "perdido" ? "se perdió" : `volvió a ${t.origen}`}
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {t.nota && <p className="text-base">{t.nota}</p>}
      {conDiferencias && t.faltante && (
        <p className="text-base">Lo que no llegó: {t.faltante === "perdido" ? "se perdió" : `volvió a ${t.origen}`}.</p>
      )}

      {/* Las dos firmas: la del que despacha y la del que recibe. */}
      {t.estado !== "anulado" && (
        <section className="grid gap-6 pt-6 sm:grid-cols-2">
          {[
            {
              quien: "Entregó",
              sucursal: t.origen,
              nombre: t.creadoPor,
              cuando: t.createdAt,
            },
            {
              quien: "Recibió",
              sucursal: t.destino,
              nombre: t.recibidoPor,
              cuando: t.recibidoAt,
            },
          ].map((f) => (
            <div key={f.quien}>
              <div className="h-16 border-b border-foreground/40" aria-hidden="true" />
              <p className="mt-2 text-base font-medium">
                {f.quien} · {f.sucursal}
              </p>
              {f.cuando && (
                <p className="tabular text-sm text-muted-foreground">
                  {f.nombre && `${f.nombre} · `}
                  {fechaHora.format(f.cuando)}
                </p>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
