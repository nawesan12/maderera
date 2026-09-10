import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { obtenerCorte } from "@/lib/dal/admin/cortes";
import { BotonImprimir } from "@/app/(impresion)/ticket/[id]/boton";

export const metadata: Metadata = {
  title: "Etiquetas",
  robots: { index: false, follow: false },
};

/**
 * Una etiqueta por pieza del corte, para pegar al apilar.
 *
 * Lo pidió la clienta: "posibilidad de etiquetado para piezas con
 * identificación de pegado de tapacanto". El dibujo es lo que importa: el
 * rectángulo es la pieza y **los lados gruesos son los que llevan canto**, que
 * es como lo grafica CutMaster y lo que evita que el pegado se haga en el lado
 * equivocado.
 *
 * Sale en grilla sobre A4 —papel autoadhesivo de etiquetas o tijera—. Una
 * pieza repetida imprime una etiqueta por unidad.
 */

/**
 * Tope de etiquetas por hoja de trabajo. Un despiece de mueble ronda las
 * decenas; quinientas es un error de carga y una resma desperdiciada.
 */
const TOPE = 500;

export default async function EtiquetasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();

  const { id } = await params;
  const corte = await obtenerCorte(id);
  if (!corte) notFound();

  // Una entrada por unidad física, no por renglón: la etiqueta va en la pieza.
  const etiquetas = corte.piezas.flatMap((pieza) =>
    Array.from({ length: Math.min(pieza.cantidad, TOPE) }, (_, i) => ({
      pieza,
      unidad: i + 1,
    })),
  );

  const recortadas = etiquetas.slice(0, TOPE);

  return (
    <div className="etiquetas-pagina">
      {/* Hoja propia y no la del comprobante: la grilla de etiquetas no se
          parece a un documento. Los estilos van acá para que la página sea
          autosuficiente al imprimir. */}
      <style>{`
        .etiquetas-pagina { max-width: 210mm; margin: 0 auto; padding: 8mm; font-family: var(--font-sans, sans-serif); color: #1a1a1a; }
        .etiquetas-barra { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6mm; }
        .etiquetas-grilla { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; }
        .etiqueta-pieza { border: 1px solid #bbb; border-radius: 2mm; padding: 3mm; break-inside: avoid; display: flex; gap: 3mm; align-items: center; }
        .etiqueta-datos { min-width: 0; flex: 1; }
        .etiqueta-datos .medida { font-size: 13pt; font-weight: 700; font-variant-numeric: tabular-nums; }
        .etiqueta-datos .nombre { font-size: 9pt; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .etiqueta-datos .detalle { font-size: 7.5pt; color: #555; }
        .croquis { flex-shrink: 0; position: relative; }
        .croquis .veta { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 8pt; color: #999; }
        @media print {
          .etiquetas-barra { display: none; }
          .etiquetas-pagina { padding: 0; }
        }
      `}</style>

      <div className="etiquetas-barra">
        <div>
          <p style={{ fontWeight: 700 }}>
            Etiquetas del corte {corte.numero} · {corte.cliente}
          </p>
          <p style={{ fontSize: "13px", color: "#666" }}>
            {recortadas.length} etiquetas — una por pieza. El lado grueso del
            croquis es el que lleva tapacanto
            {corte.cantoDescripcion ? ` (${corte.cantoDescripcion})` : ""}.
            {etiquetas.length > TOPE &&
              ` Se recortó a ${TOPE}: revisá las cantidades del despiece.`}
          </p>
        </div>
        <BotonImprimir />
      </div>

      <div className="etiquetas-grilla">
        {recortadas.map(({ pieza, unidad }, i) => (
          <article key={i} className="etiqueta-pieza">
            <Croquis
              cantoLargo={pieza.cantoLargo}
              cantoAncho={pieza.cantoAncho}
              respetaVeta={pieza.respetaVeta === 1}
            />
            <div className="etiqueta-datos">
              <p className="medida">
                {pieza.largoMm} × {pieza.anchoMm}
              </p>
              {pieza.etiqueta && <p className="nombre">{pieza.etiqueta}</p>}
              <p className="detalle">
                {corte.numero} · {corte.cliente}
                {pieza.cantidad > 1 && ` · ${unidad}/${pieza.cantidad}`}
              </p>
              {pieza.aclaracion && <p className="detalle">{pieza.aclaracion}</p>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

/**
 * La pieza dibujada: los bordes gruesos son los lados con tapacanto.
 *
 * El largo va horizontal, así que sus cantos son arriba y abajo; los del ancho
 * van a los costados. Con un solo lado, se pinta abajo (o a la izquierda):
 * cuál de los dos es lo decide el taller, la etiqueta solo dice cuántos.
 */
function Croquis({
  cantoLargo,
  cantoAncho,
  respetaVeta,
}: {
  cantoLargo: number;
  cantoAncho: number;
  respetaVeta: boolean;
}) {
  const fino = "1px solid #999";
  const grueso = "3px solid #1a1a1a";

  return (
    <div
      className="croquis"
      aria-label={`Canto en ${cantoLargo} lado(s) del largo y ${cantoAncho} del ancho`}
      style={{
        width: "18mm",
        height: "12mm",
        background: "#f4f1ec",
        borderTop: cantoLargo >= 2 ? grueso : fino,
        borderBottom: cantoLargo >= 1 ? grueso : fino,
        borderLeft: cantoAncho >= 1 ? grueso : fino,
        borderRight: cantoAncho >= 2 ? grueso : fino,
      }}
    >
      {respetaVeta && (
        <span className="veta" aria-hidden>
          ⇢
        </span>
      )}
    </div>
  );
}
