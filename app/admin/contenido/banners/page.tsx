import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Megaphone } from "lucide-react";
import { asc, desc } from "drizzle-orm";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { db } from "@/lib/db";
import { banners } from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { EditorDeBanner } from "./editor";
import { UBICACIONES } from "./ubicaciones";

export const metadata: Metadata = { title: "Avisos y promociones" };

/** "2026-09-05", que es lo que espera un input de fecha. */
function paraInput(fecha: Date | null): string {
  return fecha ? fecha.toISOString().slice(0, 10) : "";
}

/**
 * Los avisos y promociones del sitio.
 *
 * **Por qué existe.** La maderera cambia precios todas las semanas, tiene
 * promociones con MODO y con tarjetas, y descuentos por pagar de contado.
 * Nada de eso se podía anunciar: el sitio no tenía un solo lugar donde poner
 * un aviso, así que una promoción de quince días o exigía un despliegue o
 * directamente no se publicaba.
 *
 * Las fechas son lo que hace que sirva de verdad: un banner con fecha de fin
 * se apaga solo, y no queda anunciando en noviembre una promo de septiembre.
 */
export default async function BannersPage() {
  await requireStaff();

  const filas = await db
    .select()
    .from(banners)
    .orderBy(asc(banners.ubicacion), asc(banners.orden), desc(banners.createdAt));

  const ahora = new Date();
  const alAire = (b: (typeof filas)[number]) =>
    b.activo &&
    (!b.desde || b.desde <= ahora) &&
    (!b.hasta || b.hasta >= ahora);

  const enVivo = filas.filter(alAire).length;

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
        titulo="Avisos y promociones"
        detalle="Los banners del sitio, con la fecha en que empiezan y terminan."
      />

      <div className="rounded-xl border bg-card p-5">
        <p className="flex items-start gap-2.5 text-base text-muted-foreground">
          <Megaphone className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <span>
            {enVivo === 0 ? (
              <>
                No hay ningún aviso al aire. Este es el lugar para anunciar una
                promoción, un descuento por transferencia o una semana temática.
              </>
            ) : (
              <>
                Hay <strong className="text-foreground">{enVivo}</strong>{" "}
                {enVivo === 1 ? "aviso" : "avisos"} al aire.{" "}
                <strong>Poné siempre la fecha de fin</strong>: un banner vencido
                que sigue anunciando un descuento termina en un reclamo en el
                mostrador.
              </>
            )}
          </span>
        </p>
      </div>

      {UBICACIONES.map((ubicacion) => {
        const deAca = filas.filter((b) => b.ubicacion === ubicacion.valor);

        return (
          <section key={ubicacion.valor} className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">{ubicacion.etiqueta}</h2>
              <p className="text-sm text-muted-foreground">{ubicacion.ayuda}</p>
            </div>

            {deAca.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-3 text-base text-muted-foreground">
                Sin avisos acá.
              </p>
            ) : (
              deAca.map((b) => (
                <EditorDeBanner
                  key={b.id}
                  banner={{
                    id: b.id,
                    ubicacion: b.ubicacion,
                    etiqueta: b.etiqueta,
                    titulo: b.titulo,
                    bajada: b.bajada,
                    enlace: b.enlace,
                    textoEnlace: b.textoEnlace,
                    imagenUrl: b.imagenUrl,
                    desde: paraInput(b.desde),
                    hasta: paraInput(b.hasta),
                    orden: b.orden,
                    activo: b.activo,
                    alAire: alAire(b),
                  }}
                />
              ))
            )}
          </section>
        );
      })}

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Crear un aviso</h2>
        <EditorDeBanner banner={null} />
      </section>
    </div>
  );
}
