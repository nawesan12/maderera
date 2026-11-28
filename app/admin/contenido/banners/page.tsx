import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { requireStaff } from "@/lib/dal/session";
import { fechaParaInput, listarBannersDelPanel } from "@/lib/dal/admin/contenido";
import { CrearAviso, EditorDeBanner } from "./editor";
import { UBICACIONES } from "./ubicaciones";

export const metadata: Metadata = { title: "Avisos y promociones" };

/** "2026-09-05", que es lo que espera un input de fecha. */
const paraInput = fechaParaInput;

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

  const filas = await listarBannersDelPanel();

  const ahora = new Date();
  const alAire = (b: (typeof filas)[number]) =>
    b.activo &&
    (!b.desde || b.desde <= ahora) &&
    (!b.hasta || b.hasta >= ahora);

  const enVivo = filas.filter(alAire).length;

  // Una lista que se abre de a un aviso: con todos abiertos, cada banner era
  // un formulario entero y solo se distinguían leyendo los campos (M2S1-133).
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
        resumen={enVivo === 0 ? "Ninguno al aire" : `${enVivo} al aire`}
      />

      <CrearAviso titulo="Crear un aviso">
        <Plus className="h-5 w-5 text-brand-orange transition-transform group-open:rotate-45" aria-hidden />
      </CrearAviso>

      {UBICACIONES.map((ubicacion) => {
        const deAca = filas.filter((b) => b.ubicacion === ubicacion.valor);

        return (
          <section key={ubicacion.valor} className="space-y-3">
            <h2 className="text-base font-semibold">{ubicacion.etiqueta}</h2>

            {deAca.length === 0 ? (
              <p className="tarjeta-hundida rounded-lg px-4 py-3 text-base text-muted-foreground">
                Sin avisos acá.
              </p>
            ) : (
              <div className="tarjeta divide-y overflow-hidden">
                {deAca.map((b) => {
                  const estado = !b.activo
                    ? "apagado"
                    : alAire(b)
                      ? "al_aire"
                      : b.desde && b.desde > ahora
                        ? "banner_programado"
                        : "fuera_de_fecha";
                  return (
                    <details key={b.id} className="group">
                      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 hover:bg-muted/40">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-semibold">{b.titulo}</span>
                          <span className="tabular block text-sm text-muted-foreground">
                            {vigencia(b.desde, b.hasta)}
                          </span>
                        </span>
                        <EtiquetaEstado estado={estado} />
                      </summary>
                      <div className="px-5 pb-5 sm:px-8">
                        <EditorDeBanner
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
                          }}
                        />
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** «26/11 al 30/11», «desde 26/11», «hasta 30/11» o «sin fechas». */
function vigencia(desde: Date | null, hasta: Date | null): string {
  const dia = (f: Date) =>
    f.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  if (desde && hasta) return `${dia(desde)} al ${dia(hasta)}`;
  if (desde) return `desde ${dia(desde)}`;
  if (hasta) return `hasta ${dia(hasta)}`;
  return "sin fechas";
}
