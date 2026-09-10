import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Landmark } from "lucide-react";
import { asc, desc } from "drizzle-orm";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { db } from "@/lib/db";
import { bankPromotions } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { EditorDePromo } from "./editor";

export const metadata: Metadata = { title: "Promociones bancarias" };

/** "2026-09-05", que es lo que espera un input de fecha. */
function paraInput(fecha: Date | null): string {
  return fecha ? fecha.toISOString().slice(0, 10) : "";
}

/**
 * Las promociones bancarias que anuncia la portada.
 *
 * **Por qué existe.** La clienta trajo la lista real —BNA con MODO, Point de
 * Mercado Pago, Clover, Fava, Naranja, Clipper— y pidió que el inicio la
 * muestre. Cada promo tiene su propia vigencia y esas fechas cambian todos los
 * meses: como texto fijo, en noviembre el sitio seguiría anunciando el
 * reintegro que venció en octubre, y ese reclamo llega al mostrador.
 *
 * Una promo con fecha se apaga sola. La que dice "hasta nuevo aviso" queda
 * hasta que alguien la apague acá.
 */
export default async function PromocionesPage() {
  await requireStaff();

  const filas = await db
    .select()
    .from(bankPromotions)
    .orderBy(asc(bankPromotions.orden), desc(bankPromotions.createdAt));

  const ahora = new Date();
  const alAire = (p: (typeof filas)[number]) =>
    p.activo && (!p.vigenciaHasta || p.vigenciaHasta >= ahora);

  const enVivo = filas.filter(alAire).length;
  const vencidas = filas.filter(
    (p) => p.activo && p.vigenciaHasta && p.vigenciaHasta < ahora,
  ).length;

  return (
    <div className="space-y-6">
      <Link
        href="/admin/contenido"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a contenido
      </Link>

      <EncabezadoPanel
        titulo="Promociones bancarias"
        detalle="Las promociones por medio de pago que anuncia el inicio del sitio, con su vigencia."
      />

      <div className="rounded-xl border bg-card p-5">
        <p className="flex items-start gap-2.5 text-base text-muted-foreground">
          <Landmark className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <span>
            {enVivo === 0 ? (
              <>
                No hay ninguna promoción publicada. Cuando el banco mande la
                lista del mes, se carga acá y aparece en el inicio.
              </>
            ) : (
              <>
                Hay <strong className="text-foreground">{enVivo}</strong>{" "}
                {enVivo === 1 ? "promoción publicada" : "promociones publicadas"}
                . Las que tienen fecha se apagan solas al vencer
                {vencidas > 0 && (
                  <>
                    {" "}
                    — {vencidas} ya {vencidas === 1 ? "venció" : "vencieron"} y
                    no se {vencidas === 1 ? "muestra" : "muestran"}
                  </>
                )}
                .
              </>
            )}
          </span>
        </p>
      </div>

      {filas.map((p) => (
        <EditorDePromo
          key={p.id}
          promo={{
            id: p.id,
            medio: p.medio,
            titulo: p.titulo,
            detalle: p.detalle,
            dias: p.dias,
            vigenciaHasta: paraInput(p.vigenciaHasta),
            orden: p.orden,
            activo: p.activo,
            alAire: alAire(p),
          }}
        />
      ))}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Cargar una promoción</h2>
        <EditorDePromo promo={null} />
      </section>
    </div>
  );
}
