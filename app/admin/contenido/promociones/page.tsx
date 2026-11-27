import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { requireStaff } from "@/lib/dal/session";
import { fechaParaInput, listarPromosDelPanel } from "@/lib/dal/admin/contenido";
import { EditorDePromo } from "./editor";

export const metadata: Metadata = { title: "Promociones bancarias" };

/** "2026-09-05", que es lo que espera un input de fecha. */
const paraInput = fechaParaInput;

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

  const filas = await listarPromosDelPanel();

  const ahora = new Date();
  const alAire = (p: (typeof filas)[number]) =>
    p.activo && (!p.vigenciaHasta || p.vigenciaHasta >= ahora);

  const enVivo = filas.filter(alAire).length;
  const vencidas = filas.filter(
    (p) => p.activo && p.vigenciaHasta && p.vigenciaHasta < ahora,
  ).length;
  // Se cuentan las que el sitio muestra: «7 publicadas» con 3 vencidas se
  // leía como que había 7 en la portada (M3S2-037).
  const resumen = [
    enVivo === 0 ? "Ninguna en el sitio" : `${enVivo} en el sitio`,
    vencidas > 0 ? `${vencidas} ${vencidas === 1 ? "vencida" : "vencidas"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Una fila por promo, que se abre para editarla: con los formularios
  // abiertos, ocho promos medían 13.500 px en el teléfono (M2S4-024).
  return (
    <div className="space-y-6">
      <Link
        href="/admin/contenido"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a contenido
      </Link>

      <EncabezadoPanel titulo="Promociones bancarias" resumen={resumen} />

      <details className="tarjeta group overflow-hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 text-base font-semibold hover:bg-muted/40">
          <Plus className="h-5 w-5 text-brand-orange transition-transform group-open:rotate-45" aria-hidden />
          Cargar una promoción
        </summary>
        <div className="px-5 pb-5 sm:px-8">
          <EditorDePromo promo={null} />
        </div>
      </details>

      {filas.length > 0 && (
        <div className="tarjeta divide-y overflow-hidden">
          {filas.map((p) => {
            const estado = !p.activo ? "apagado" : alAire(p) ? "al_aire" : "vencido";
            return (
              <details key={p.id} className="group">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 hover:bg-muted/40">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-semibold">{p.medio}</span>
                    <span className="block truncate text-base">{p.titulo}</span>
                    <span className="tabular block text-sm text-muted-foreground">
                      {p.vigenciaHasta ? `hasta ${dia(p.vigenciaHasta)}` : "sin vencimiento"}
                    </span>
                  </span>
                  <EtiquetaEstado estado={estado} />
                </summary>
                <div className="px-5 pb-5 sm:px-8">
                  <EditorDePromo
                    promo={{
                      id: p.id,
                      medio: p.medio,
                      titulo: p.titulo,
                      detalle: p.detalle,
                      dias: p.dias,
                      quienPaga: p.quienPaga,
                      vigenciaHasta: paraInput(p.vigenciaHasta),
                      orden: p.orden,
                      activo: p.activo,
                      imagenUrl: p.imagenUrl,
                    }}
                  />
                </div>
              </details>
            );
          })}
        </div>
      )}
    </div>
  );
}

function dia(f: Date): string {
  return f.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
}
