import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { puedeEntrar } from "@/lib/roles";
import { datosDeEtiquetas } from "@/lib/dal/admin/products";
import { moneda } from "@/lib/formato";
import {
  FORMATOS_DE_ETIQUETA,
  formatoDeEtiqueta,
  leerPedidoDeEtiquetas,
  repartirEnHojas,
} from "@/lib/etiquetas-de-medidas";
import { CodigoDeBarras } from "@/components/admin/codigo-de-barras";
import { BotonImprimir } from "@/app/(impresion)/ticket/[id]/boton";
import { EscalaDeLaHoja } from "./escala";

export const metadata: Metadata = {
  title: "Etiquetas",
  robots: { index: false, follow: false },
};

/**
 * La hoja de etiquetas con código de barras de las medidas.
 *
 * Es HTML y no un PDF de Go: la grilla de etiquetas sale igual de exacta con
 * `@page` y milímetros en CSS, el navegador manda a cualquier impresora
 * (también a la térmica de rollo, que trae su driver) y el código de barras
 * ya viene armado de Go como módulos, que acá se dibujan en SVG.
 *
 * Dos formatos: la plancha A4 de 3 × 7 (63,5 × 38,1 mm) y el rollo de
 * 50 × 25 mm, una etiqueta por página.
 */
export default function EtiquetasDeMedidasPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[]; formato?: string; precio?: string }>;
}) {
  // Depende de quién pide y de la URL: va detrás de un <Suspense>, como las
  // demás hojas (ver preparando.tsx).
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center p-8" aria-busy="true">
          <span className="text-base text-muted-foreground">Preparando la hoja…</span>
        </div>
      }
    >
      <Contenido searchParams={searchParams} />
    </Suspense>
  );
}

async function Contenido({
  searchParams,
}: {
  searchParams: Promise<{ m?: string | string[]; formato?: string; precio?: string }>;
}) {
  const usuario = await requireStaff();
  if (!puedeEntrar("/admin/stock", usuario.staffRole)) redirect("/admin");

  const params = await searchParams;
  const pedido = leerPedidoDeEtiquetas(params.m);
  const formato = formatoDeEtiqueta(params.formato);
  const medidas = FORMATOS_DE_ETIQUETA[formato];
  const datos = pedido.length > 0
    ? await datosDeEtiquetas({ medidas: pedido.map((p) => p.id), precio: params.precio === "1" })
    : [];
  const hojas = repartirEnHojas(datos, pedido, medidas.porHoja);
  const total = hojas.reduce((s, h) => s + h.length, 0);

  // A4: márgenes de la plancha de 3 × 7 (15,1 mm arriba y abajo, 7,2 a los
  // costados, 2,5 mm entre columnas). Rollo: la página es la etiqueta.
  const pagina =
    formato === "a4"
      ? "@page { size: A4; margin: 15.1mm 7.2mm; }"
      : `@page { size: ${medidas.ancho}mm ${medidas.alto}mm; margin: 0; }`;

  return (
    <div className="etiquetas-medidas">
      <EscalaDeLaHoja />
      <style>{`
        ${pagina}
        .etiquetas-medidas { font-family: var(--font-sans, sans-serif); color: #000; background: #e9e6e1; min-height: 100vh; padding-bottom: 12mm; }
        .etiquetas-medidas .barra { position: sticky; top: 0; z-index: 10; display: flex; justify-content: center; align-items: center; gap: 1rem; background: #1a1a1a; color: #fff; padding: 0.75rem 1.5rem; font-size: 0.95rem; }
        .etiquetas-medidas .boton-imprimir { display: inline-flex; align-items: center; gap: 0.5rem; border-radius: 0.5rem; background: oklch(0.68 0.19 48); padding: 0.5rem 1.25rem; font-weight: 600; color: #fff; }
        .etiquetas-medidas .hoja { background: #fff; margin: 8mm auto; box-shadow: 0 2px 12px rgb(0 0 0 / 0.1); }
        .etiquetas-medidas .hoja.a4 { width: 210mm; padding: 15.1mm 7.2mm; display: grid; grid-template-columns: repeat(3, 63.5mm); grid-auto-rows: 38.1mm; column-gap: 2.5mm; }
        @media screen { .etiquetas-medidas .hoja.a4 { zoom: var(--escala-hoja, 1); } }
        @media screen and (max-width: 809px) { .etiquetas-medidas .hoja.a4 { zoom: var(--escala-hoja, 0.43); } }
        @media screen and (max-width: 640px) { .etiquetas-medidas .barra { flex-wrap: wrap; padding: 0.75rem 1rem; } }
        .etiquetas-medidas .hoja.rollo { width: 50mm; height: 25mm; }
        .etiquetas-medidas .etiqueta { overflow: hidden; display: flex; flex-direction: column; padding: 2mm 3mm; break-inside: avoid; }
        .etiquetas-medidas .rollo .etiqueta { width: 50mm; height: 25mm; padding: 1.5mm 2mm; }
        .etiquetas-medidas .a4 .etiqueta { width: 63.5mm; height: 38.1mm; }
        .etiquetas-medidas .arriba { display: flex; justify-content: space-between; gap: 2mm; align-items: flex-start; }
        .etiquetas-medidas .nombre { font-weight: 700; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .etiquetas-medidas .a4 .nombre { font-size: 10pt; }
        .etiquetas-medidas .rollo .nombre { font-size: 7pt; -webkit-line-clamp: 1; }
        .etiquetas-medidas .precio { font-weight: 800; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .etiquetas-medidas .a4 .precio { font-size: 12pt; }
        .etiquetas-medidas .rollo .precio { font-size: 8pt; }
        .etiquetas-medidas .medida { line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .etiquetas-medidas .a4 .medida { font-size: 9pt; }
        .etiquetas-medidas .rollo .medida { font-size: 6.5pt; }
        .etiquetas-medidas .barras { margin-top: auto; width: 100%; }
        .etiquetas-medidas .a4 .barras { height: 13mm; }
        .etiquetas-medidas .rollo .barras { height: 9mm; }
        .etiquetas-medidas .numero { margin-top: 0.8mm; text-align: center; color: #000; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; line-height: 1.1; }
        .etiquetas-medidas .a4 .numero { font-size: 8pt; }
        .etiquetas-medidas .rollo .numero { font-size: 6pt; }
        /* La hoja es papel: siempre clara, aunque el panel esté en oscuro. */
        :root { color-scheme: light; }
        html, body { background: #e9e6e1; }
        @media print {
          html, body { background: #fff !important; }
          .etiquetas-medidas { background: none; padding: 0; min-height: 0; }
          .etiquetas-medidas .barra { display: none; }
          .etiquetas-medidas .hoja { margin: 0; box-shadow: none; break-after: page; }
          .etiquetas-medidas .hoja:last-child { break-after: auto; }
          .etiquetas-medidas .hoja.a4 { padding: 0; width: auto; zoom: 1; }
        }
      `}</style>

      <div className="barra">
        <span className="tabular">
          {total === 1 ? "1 etiqueta" : `${total} etiquetas`} ·{" "}
          {formato === "a4" ? "A4, 21 por hoja" : "rollo de 50 × 25 mm"}
        </span>
        {total > 0 && <BotonImprimir />}
      </div>

      {hojas.map((hoja, h) => (
        <div key={h} className={`hoja ${formato}`}>
          {hoja.map((e, i) => (
            <article key={i} className="etiqueta">
              <div className="arriba">
                <p className="nombre">{e.nombreCorto}</p>
                {e.precio && <p className="precio">{moneda.format(Number(e.precio))}</p>}
              </div>
              <p className="medida">{e.medida}</p>
              {e.barras && (
                <CodigoDeBarras modulos={e.barras.modulos} etiqueta={e.codigo} className="barras" />
              )}
              {/* No es el `.codigo` del panel: ese es una pastilla hundida que
                  en oscuro salía como una banda negra pegada a las barras
                  (mes simulado, M2S2-056, M3S1-056). */}
              <p className="numero">{e.codigo}</p>
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}
