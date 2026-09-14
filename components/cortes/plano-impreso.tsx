import { BotonImprimir } from "@/components/fiscal/boton-imprimir";
import { fechaCorta } from "@/lib/formato";
import type { PlanoDeCorte, PlacaDelPlano } from "@/lib/cortes/plano";

/**
 * El plano de corte en papel.
 *
 * Es la hoja que baja al taller con el trabajo: una placa por recuadro, cada
 * pieza dibujada donde cae, y arriba los tres números que el operario necesita
 * antes de encender la máquina —cuántas placas, cuántas pasadas, cuánto se
 * desperdicia—.
 *
 * **Se dibuja a escala y las medidas van escritas igual.** Un plano a escala
 * sirve para entender el acomodo de un vistazo; para cortar, el operario lee el
 * número. Confiar en la escala de una impresión es como medir con una foto.
 *
 * El orden de lectura es el orden de corte: las tiras de arriba hacia abajo,
 * y adentro de cada tira de izquierda a derecha. Por eso las piezas van
 * numeradas: es la secuencia en la que salen de la seccionadora.
 */
export function PlanoImpreso({
  plano,
  corte,
}: {
  plano: PlanoDeCorte;
  corte: {
    numero: string;
    cliente: string;
    material: string;
    cantoDescripcion: string | null;
    createdAt: Date;
  };
}) {
  const desperdicio = 1 - plano.aprovechadoTotal;

  return (
    <div className="plano-pagina">
      <style>{`
        .plano-pagina { max-width: 297mm; margin: 0 auto; padding: 10mm; font-family: var(--font-sans, sans-serif); color: #1a1a1a; }
        .plano-barra { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 6mm; }
        .plano-titulo { font-size: 15pt; font-weight: 700; }
        .plano-sub { font-size: 10pt; color: #555; margin-top: 1mm; }
        .plano-numeros { display: flex; gap: 6mm; margin: 0 0 6mm; padding: 3mm 4mm; border: 1px solid #ddd; border-radius: 2mm; background: #faf8f5; }
        .plano-numero .valor { font-size: 16pt; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
        .plano-numero .rotulo { font-size: 8pt; color: #555; }
        .plano-placa { margin-bottom: 7mm; break-inside: avoid; }
        .plano-placa h3 { font-size: 10pt; font-weight: 700; margin: 0 0 2mm; }
        .plano-placa h3 span { font-weight: 400; color: #555; }
        .plano-placa h3 .sello-entera, .plano-placa h3 .sello-corte { display: inline-block; margin-left: 2mm; padding: 0.3mm 1.6mm; border-radius: 1mm; font-size: 7.5pt; font-weight: 600; border: 1px solid; }
        .plano-placa h3 .sello-entera { color: #c2410c; border-color: #c2410c; background: #fdf1ea; }
        .plano-placa h3 .sello-corte { color: #555; border-color: #bbb; background: #f5f3f0; }
        .plano-aviso { margin-bottom: 5mm; padding: 3mm 4mm; border-left: 3px solid #c2410c; background: #fff5ef; font-size: 9pt; }
        .plano-tabla { width: 100%; border-collapse: collapse; font-size: 8.5pt; margin-top: 4mm; }
        .plano-tabla th { text-align: left; border-bottom: 1px solid #ccc; padding: 1.5mm 2mm; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #555; }
        .plano-tabla td { border-bottom: 1px solid #eee; padding: 1.5mm 2mm; }
        .plano-tabla .num { text-align: right; font-variant-numeric: tabular-nums; }
        .plano-pie { margin-top: 5mm; font-size: 8pt; color: #666; }
        @media print {
          .no-imprimir { display: none; }
          .plano-pagina { padding: 0; }
        }
      `}</style>

      <div className="plano-barra">
        <div>
          <p className="plano-titulo">
            Plano de corte {corte.numero} · {corte.cliente}
          </p>
          <p className="plano-sub">
            {corte.material} · placa {plano.placaLargo} × {plano.placaAncho} mm
            {corte.cantoDescripcion ? ` · canto ${corte.cantoDescripcion}` : ""}
            {" · "}
            {fechaCorta.format(corte.createdAt)}
          </p>
        </div>
        <div className="no-imprimir">
          <BotonImprimir />
        </div>
      </div>

      {/* Los tres números que se miran antes de encender la máquina. Las
          pasadas son de las que sale el precio del trabajo. */}
      {/* Los números que se miran antes de encender la máquina. Las pasadas
          son las del trabajo; cuáles se cobran lo decide el mostrador y está en
          la ficha, no acá: al taller le interesa cuánto hay que cortar. */}
      <div className="plano-numeros">
        <div className="plano-numero">
          <p className="valor">{plano.placas.length}</p>
          <p className="rotulo">
            {plano.placas.length === 1 ? "placa" : "placas"}
          </p>
        </div>
        {plano.placasEnteras > 0 && (
          <div className="plano-numero">
            <p className="valor">{plano.placasEnteras}</p>
            <p className="rotulo">
              {plano.placasEnteras === 1
                ? "se vende entera"
                : "se venden enteras"}
            </p>
          </div>
        )}
        <div className="plano-numero">
          <p className="valor">{plano.pasadas}</p>
          <p className="rotulo">pasadas de sierra</p>
        </div>
        <div className="plano-numero">
          <p className="valor">{Math.round(desperdicio * 100)}%</p>
          <p className="rotulo">sobra de lo comprado</p>
        </div>
        <div className="plano-numero">
          <p className="valor">{plano.totalPiezas}</p>
          <p className="rotulo">piezas</p>
        </div>
      </div>

      {plano.noEntran.length > 0 && (
        <p className="plano-aviso">
          <strong>
            {plano.noEntran.length === 1
              ? "Una pieza no entra en la placa"
              : `${plano.noEntran.length} piezas no entran en la placa`}
            :
          </strong>{" "}
          {plano.noEntran
            .map((p) => `${p.largoMm} × ${p.anchoMm} mm`)
            .join(", ")}
          . Revisá las medidas del despiece o elegí una placa más grande. Si la
          pieza respeta la veta, girarla no es una opción.
        </p>
      )}

      {plano.placas.map((placa) => (
        <section key={placa.numero} className="plano-placa">
          <h3>
            Placa {placa.numero} de {plano.placas.length}{" "}
            <span>
              · {placa.piezas.length}{" "}
              {placa.piezas.length === 1 ? "pieza" : "piezas"} ·{" "}
              {Math.round(placa.aprovechado * 100)}% aprovechado
            </span>
            {/* Qué pasa con lo que sobra de esta placa. No es un detalle
                administrativo: de una placa vendida entera **el recorte es del
                cliente** y se va con él. Guardarlo en el depósito sería
                quedarse con material ajeno. */}
            <span
              className={placa.seVendeEntera ? "sello-entera" : "sello-corte"}
            >
              {placa.seVendeEntera
                ? "Se vende entera · el recorte se lo lleva el cliente"
                : "Se cobra el corte · el recorte queda en la maderera"}
            </span>
          </h3>
          <DibujoDePlaca placa={placa} plano={plano} />
        </section>
      ))}

      {plano.placas.length > 0 && <TablaDePiezas plano={plano} />}

      <p className="plano-pie">
        Las piezas están numeradas en el orden en que salen de la máquina: las
        tiras de arriba hacia abajo, y adentro de cada tira de izquierda a
        derecha. Entre pieza y pieza se descuentan {plano.anchoSierra} mm de
        sierra. El dibujo está a escala, pero para cortar vale el número escrito.
        Los recuadros punteados son los pedazos que quedan enteros; lo que sobra
        fuera de ellos no da para nada. **Ojo con a quién pertenecen**: de una
        placa que se vende entera el recorte es del cliente y se va con él; de
        una que se cobró por corte, vuelve al stock. Cada uno está rotulado.
      </p>
    </div>
  );
}

/**
 * Una placa dibujada, en SVG y a escala.
 *
 * SVG y no imagen porque tiene que imprimirse nítido en cualquier tamaño y
 * porque el texto de adentro se puede leer y buscar. Las medidas del `viewBox`
 * son las de la placa en milímetros: así no hay ninguna conversión a mano y
 * cada pieza se dibuja con los números que ya tiene.
 */
function DibujoDePlaca({
  placa,
  plano,
}: {
  placa: PlacaDelPlano;
  plano: PlanoDeCorte;
}) {
  const { placaLargo, placaAncho } = plano;

  return (
    <svg
      viewBox={`-6 -6 ${placaLargo + 12} ${placaAncho + 12}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label={`Placa ${placa.numero} con ${placa.piezas.length} piezas`}
    >
      {/* El recorte: lo que queda de placa sin usar. Va de fondo para que lo
          que se ve en blanco sea exactamente lo que se tira. */}
      <rect
        x={0}
        y={0}
        width={placaLargo}
        height={placaAncho}
        fill="#f1ece4"
        stroke="#1a1a1a"
        strokeWidth={4}
      />

      {placa.piezas.map((p, i) => {
        /*
         * El texto se achica hasta entrar, en vez de desaparecer.
         *
         * Antes una pieza fina —un travesaño de 764 × 140— salía dibujada con
         * su número y sin una sola medida: el operario veía un rectángulo
         * flaco y tenía que ir a buscar la tabla. Ahora la tipografía se
         * calcula contra el alto y el ancho disponibles, y solo se cae la
         * etiqueta cuando de verdad no hay lugar para las dos líneas.
         */
        const medida = `${p.ancho} × ${p.alto}`;
        const cuerpo = Math.min(
          44,
          p.alto * 0.34,
          (p.ancho * 1.7) / medida.length,
        );
        const cuerpoEtiqueta = Math.min(32, cuerpo * 0.72);
        const entraLaEtiqueta =
          Boolean(p.etiqueta || p.girada) &&
          p.alto > cuerpo + cuerpoEtiqueta + 26;
        const cuerpoNumero = Math.min(38, p.alto * 0.42, p.ancho * 0.22);
        const nota = [p.etiqueta, p.girada ? "girada" : null]
          .filter(Boolean)
          .join(" · ");
        // Con etiqueta, la medida sube para que las dos líneas queden
        // centradas como bloque y no una encima de la otra.
        const yMedida = entraLaEtiqueta
          ? p.y + p.alto / 2 - cuerpoEtiqueta * 0.35
          : p.y + p.alto / 2 + cuerpo * 0.35;

        return (
          <g key={i}>
            <rect
              x={p.x}
              y={p.y}
              width={p.ancho}
              height={p.alto}
              fill="#ffffff"
              stroke="#1a1a1a"
              strokeWidth={3}
            />
            {/* El número de orden, arriba a la izquierda de la pieza. */}
            <text
              x={p.x + 14}
              y={p.y + cuerpoNumero + 8}
              fontSize={cuerpoNumero}
              fontWeight={700}
              fill="#c2410c"
            >
              {i + 1}
            </text>
            {cuerpo >= 14 && (
              <text
                x={p.x + p.ancho / 2}
                y={yMedida}
                fontSize={cuerpo}
                fontWeight={700}
                textAnchor="middle"
                fill="#1a1a1a"
              >
                {medida}
              </text>
            )}
            {entraLaEtiqueta && cuerpoEtiqueta >= 12 && (
              <text
                x={p.x + p.ancho / 2}
                y={yMedida + cuerpoEtiqueta + 12}
                fontSize={cuerpoEtiqueta}
                textAnchor="middle"
                fill="#666"
              >
                {nota}
              </text>
            )}
          </g>
        );
      })}

      {/* Los pedazos enteros que sobran y sirven para otro trabajo. Van
          rotulados para que quien apila sepa cuál guardar y de qué medida. */}
      {placa.recortes.map((r, i) => (
        <g key={`r${i}`}>
          <rect
            x={r.x}
            y={r.y}
            width={r.ancho}
            height={r.alto}
            fill="none"
            stroke="#8a8178"
            strokeWidth={2}
            strokeDasharray="14 10"
          />
          {Math.min(r.ancho, r.alto) > 190 && (
            <text
              x={r.x + r.ancho / 2}
              y={r.y + r.alto / 2 + 10}
              fontSize={Math.min(30, r.alto * 0.3, (r.ancho * 1.5) / 12)}
              textAnchor="middle"
              fill="#8a8178"
            >
              {placa.seVendeEntera ? "para el cliente" : "al stock"} {r.ancho}{" "}
              × {r.alto}
            </text>
          )}
        </g>
      ))}

      {/* Cada pasada de sierra. Van dibujadas sobre el pedazo que parten y no
          de borde a borde de la placa: el corte guillotina es recursivo, así
          que el segundo corte ya trabaja sobre lo que dejó el primero. */}
      {placa.cortes.map((c, i) => (
        <line
          key={`c${i}`}
          x1={c.x1}
          y1={c.y1}
          x2={c.x2}
          y2={c.y2}
          stroke="#c2410c"
          strokeWidth={3}
          strokeDasharray="18 12"
        />
      ))}

      {/* Las cotas de la placa, fuera del recuadro. */}
      <text
        x={placaLargo / 2}
        y={-14}
        fontSize={42}
        textAnchor="middle"
        fill="#555"
      >
        {placaLargo} mm
      </text>
      <text
        x={-14}
        y={placaAncho / 2}
        fontSize={42}
        textAnchor="middle"
        fill="#555"
        transform={`rotate(-90 -14 ${placaAncho / 2})`}
      >
        {placaAncho} mm
      </text>
    </svg>
  );
}

/** El listado de piezas, en el mismo orden que el dibujo. */
function TablaDePiezas({ plano }: { plano: PlanoDeCorte }) {
  return (
    <table className="plano-tabla">
      <thead>
        <tr>
          <th>Placa</th>
          <th>N.º</th>
          <th>Medida sobre la placa</th>
          <th>Como se pidió</th>
          <th>Etiqueta</th>
          <th className="num">Posición</th>
        </tr>
      </thead>
      <tbody>
        {plano.placas.flatMap((placa) =>
          placa.piezas.map((p, i) => (
            <tr key={`${placa.numero}-${i}`}>
              <td>{placa.numero}</td>
              <td>{i + 1}</td>
              <td>
                {p.ancho} × {p.alto} mm{p.girada ? " (girada)" : ""}
              </td>
              <td>
                {p.largoOriginal} × {p.anchoOriginal} mm
              </td>
              <td>{p.etiqueta || "—"}</td>
              <td className="num">
                x {p.x} · y {p.y}
              </td>
            </tr>
          )),
        )}
      </tbody>
    </table>
  );
}
