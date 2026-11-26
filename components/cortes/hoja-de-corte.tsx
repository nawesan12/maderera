import Link from "next/link";
import { BotonImprimir } from "@/components/fiscal/boton-imprimir";
import { CasillasRecordadas } from "./casillas-recordadas";
import { fechaCorta } from "@/lib/formato";
import { formatearSierra } from "@/lib/cortes/sierra";
import { queSeHaceConLaPlaca, sobraDelCliente } from "@/lib/cortes/de-quien";
import type {
  HojaDeCorte,
  OperacionDeCorte,
  PatronDeCorte,
  Salida,
} from "@/lib/cortes/tipos";

/**
 * La hoja de corte para la seccionadora, en papel y en la tablet del taller.
 *
 * Reemplaza lo que le daba Cutty al operario en el semiautomático de WinCut:
 * placa por placa, qué medida tipear, cuántas veces, y qué sale. La secuencia
 * la arma `lib/cortes/secuencia.ts`; acá solo se dibuja.
 *
 * **Letra grande y casillas de verdad.** Se lee parado frente a la máquina, a
 * un metro, muchas veces impresa en blanco y negro: la medida va en 20 puntos y
 * monoespaciada, y cada paso tiene su casilla para tildar. En la tablet las
 * casillas se tocan; en el papel se marcan con birome.
 *
 * El dibujo es el de la secuencia, no el de la ficha: el número rotulado en
 * cada corte es el del paso de la lista.
 */

// Sin separador de miles: «1.160» en la hoja termina tipeado como 1,16 en el
// teclado de la máquina. La coma decimal sí, que es como se escribe acá.
const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1, useGrouping: false });
const mm = (n: number) => numero.format(n);

/** El canto de una pieza, como lo dicen la etiqueta y el plano (H233). */
export interface CantoDePieza {
  largo: number;
  ancho: number;
}

function textoDelCanto(c: CantoDePieza | undefined): string | null {
  if (!c || (c.largo <= 0 && c.ancho <= 0)) return null;
  const lados = [
    c.largo > 0 ? `${c.largo} ${c.largo === 1 ? "largo" : "largos"}` : null,
    c.ancho > 0 ? `${c.ancho} ${c.ancho === 1 ? "ancho" : "anchos"}` : null,
  ].filter(Boolean);
  return `canto ${lados.join(" y ")}`;
}

export function HojaDeCorteImpresa({
  hoja,
  corte,
}: {
  hoja: HojaDeCorte;
  corte: {
    id: string;
    numero: string;
    cliente: string;
    material: string;
    createdAt: Date;
    deQueSale: string;
    notas: string | null;
    /** El tapacanto del trabajo, si lleva. */
    canto?: string | null;
    /** El canto de cada renglón del despiece (P1 es el 0). */
    cantos?: CantoDePieza[];
    /**
     * Si sale de media placa: la entera y en qué sentido se parte. La hoja
     * arrancaba en la media, como si llegara cortada, y la otra mitad no
     * figuraba en ningún lado (H402).
     */
    mitad?: { sentido: "largo" | "ancho"; enteraLargo: number; enteraAncho: number } | null;
    /** Una reposición sin cargo: el retal queda en la maderera. */
    sinCargo?: boolean;
  };
}) {
  const media = Boolean(corte.mitad);
  const rotuloPlacas = media
    ? hoja.placas === 1 ? "media placa" : "medias placas"
    : hoja.placas === 1 ? "placa" : "placas";
  // Cuántas enteras se parten y si sobra una media (vuelve al stock).
  const enteras = Math.ceil(hoja.placas / 2);
  const sobraUnaMedia = hoja.placas % 2 === 1;
  return (
    <div className="hoja-corte">
      <style>{ESTILOS}</style>
      {/* Lo tildado queda en el dispositivo mientras dura el corte (H117). */}
      <CasillasRecordadas clave={`hoja-corte:${corte.id}`} />

      <div className="hc-barra">
        <div>
          <p className="hc-titulo">
            Hoja de corte {corte.numero} · {corte.cliente}
          </p>
          <p className="hc-sub">
            {corte.material} · {corte.deQueSale} de {mm(hoja.placaLargo)} ×{" "}
            {mm(hoja.placaAncho)} mm · {fechaCorta.format(corte.createdAt)}
            {corte.canto ? ` · canto ${corte.canto}` : ""}
          </p>
        </div>
        <div className="no-imprimir hc-acciones">
          <BotonImprimir />
          <a href={`/api/cortes/${corte.id}/hoja`} className="hc-boton">
            Bajar en PDF
          </a>
          <Link href={`/plano/${corte.id}`} className="hc-boton">
            Ver el plano
          </Link>
        </div>
      </div>

      <div className="hc-numeros">
        <Numero valor={String(hoja.placas)} rotulo={rotuloPlacas} />
        <Numero valor={String(hoja.totalPiezas)} rotulo={hoja.totalPiezas === 1 ? "pieza" : "piezas"} />
        <Numero valor={formatearSierra(hoja.anchoSierra)} rotulo="de sierra por corte" />
        <Numero
          valor={String(hoja.patrones.length)}
          rotulo={hoja.patrones.length === 1 ? "patrón distinto" : "patrones distintos"}
        />
      </div>

      {/* Lo que el operario tiene que saber antes de tipear la primera medida. */}
      <div className="hc-reglas">
        <p>
          <strong>Las medidas son las de la pieza.</strong> La máquina descuenta
          la sierra sola: tiene que tener cargado un disco de{" "}
          {formatearSierra(hoja.anchoSierra)}. Si en WinCut figura otro, este
          plano no sirve tal cual: avisá antes de cortar.
        </p>
        <p>
          <strong>Sin refilado.</strong> El plano usa {media ? "la media" : "la placa entera"} de{" "}
          {mm(hoja.placaLargo)} × {mm(hoja.placaAncho)} mm. Si hay que refilar un
          borde golpeado, fijate en «queda» de cada corte cuánto margen hay.
        </p>
        <p>
          <strong>El orden es el de la seccionadora:</strong> primero los cortes
          longitudinales de la placa (tiras), después los transversales de cada
          tira, después los de tercer nivel. Las medidas van en tandas de hasta{" "}
          4, que es lo que acepta el semiautomático.
        </p>
      </div>

      {corte.notas && <p className="hc-aviso">Indicaciones: {corte.notas}</p>}

      {/* El primer corte de una media placa es partir la entera. */}
      {corte.mitad && (
        <section className="hc-partir">
          <h2 className="hc-patron-titulo">
            Partir {enteras === 1 ? "la placa" : `las ${enteras} placas`}
            <span className="hc-patron-datos">
              {mm(corte.mitad.enteraLargo)} × {mm(corte.mitad.enteraAncho)}
            </span>
          </h2>
          <table className="hc-pasos">
            <tbody>
              <tr>
                <td className="hc-casilla">
                  <input type="checkbox" data-paso="partir" aria-label="Placa partida" />
                </td>
                <td className="hc-num">
                  <span>0</span>
                </td>
                <td className="hc-medida">{mm(corte.mitad.sentido === "largo" ? hoja.placaAncho : hoja.placaLargo)}</td>
                <td className="hc-veces">×{enteras}</td>
                <td className="hc-sale">
                  <p>
                    <strong>
                      {hoja.placas} {hoja.placas === 1 ? "media" : "medias"}
                    </strong>{" "}
                    de {mm(hoja.placaLargo)} × {mm(hoja.placaAncho)}
                    {corte.mitad.sentido === "largo" ? " (a lo largo)" : " (al ancho)"}
                  </p>
                  {sobraUnaMedia && (
                    <p>
                      1 media de {mm(hoja.placaLargo)} × {mm(hoja.placaAncho)} <strong>vuelve al stock</strong>
                    </p>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {hoja.noEntran.length > 0 && (
        <p className="hc-aviso">
          <strong>
            {hoja.noEntran.length === 1
              ? "Una pieza no entra en la placa"
              : `${hoja.noEntran.length} piezas no entran en la placa`}
            :
          </strong>{" "}
          {hoja.noEntran.map((p) => `${mm(p.largoMm)} × ${mm(p.anchoMm)} mm`).join(", ")}
          . No están en esta hoja: hay que corregir el despiece.
        </p>
      )}

      {hoja.patrones.length === 0 && (
        <p className="hc-aviso">
          <strong>No hay nada que cortar.</strong> El trabajo no tiene piezas
          que entren en la placa.
        </p>
      )}

      {hoja.patrones.map((patron, i) => (
        <Patron key={i} patron={patron} hoja={hoja} indice={i} cantos={corte.cantos ?? []} media={media} sinCargo={Boolean(corte.sinCargo)} />
      ))}

      <p className="hc-pie">
        La secuencia sale del plano que calcula la plataforma, el mismo con el
        que se cobró el trabajo. Antes de la primera placa, comprobá una pieza
        con el metro.
      </p>
    </div>
  );
}

function Numero({ valor, rotulo }: { valor: string; rotulo: string }) {
  return (
    <div>
      <p className="hc-valor">{valor}</p>
      <p className="hc-rotulo">{rotulo}</p>
    </div>
  );
}

function Patron({
  patron,
  hoja,
  indice,
  cantos,
  media,
  sinCargo,
}: {
  patron: PatronDeCorte;
  hoja: HojaDeCorte;
  indice: number;
  cantos: CantoDePieza[];
  media: boolean;
  sinCargo: boolean;
}) {
  const delCliente = sobraDelCliente(patron.seVendeEntera, { sinCargo });
  const cuantas = patron.placas.length;
  const nombre = media ? "Media" : "Placa";
  const placas =
    cuantas === 1
      ? `${nombre} ${patron.placas[0]}`
      : `${media ? "Medias" : "Placas"} ${patron.placas.slice(0, -1).join(", ")} y ${patron.placas.at(-1)}`;

  return (
    <section className="hc-patron">
      <h2 className="hc-patron-titulo">
        {placas}
        {cuantas > 1 && <span className="hc-repetida">×{cuantas} {media ? "medias iguales" : "placas iguales"}</span>}
        <span className="hc-patron-datos">
          {patron.piezasPorPlaca} {patron.piezasPorPlaca === 1 ? "pieza" : "piezas"} ·{" "}
          {patron.pasadasPorPlaca} {patron.pasadasPorPlaca === 1 ? "corte" : "cortes"}
          {cuantas > 1 ? " por placa" : ""}
        </span>
      </h2>
      <p className="hc-duenio">
        {queSeHaceConLaPlaca(patron.seVendeEntera, { sinCargo, media })}
        {delCliente ? ": los retales son del cliente y se van con él." : ": los retales quedan en la maderera."}
      </p>

      <Dibujo patron={patron} hoja={hoja} indice={indice} />
      {/* En el teléfono las medidas de adentro del dibujo no se leen: van
          debajo, pieza por pieza (H125). */}
      <p className="hc-leyenda">
        {[...new Map(patron.dibujo.piezas.map(({ rect, pieza }) => [pieza.indice, `P${pieza.indice + 1} ${mm(rect.ancho)} × ${mm(rect.alto)}`])).values()].join(" · ")}
      </p>

      {patron.operaciones.length === 0 ? (
        <p className="hc-aviso">La pieza es la placa entera: no lleva cortes.</p>
      ) : (
        patron.operaciones.map((op) => (
          <Operacion key={op.numero} op={op} patron={patron} indice={indice} cantos={cantos} media={media} delCliente={delCliente} />
        ))
      )}
    </section>
  );
}

function Operacion({
  op,
  patron,
  indice,
  cantos,
  media,
  delCliente,
}: {
  op: OperacionDeCorte;
  patron: PatronDeCorte;
  indice: number;
  cantos: CantoDePieza[];
  media: boolean;
  delCliente: boolean;
}) {
  const multiplicador = patron.placas.length;
  const veces = op.repeticiones * multiplicador;
  const queEs =
    op.delPaso === null
      ? media
        ? "La media"
        : "La placa"
      : `${op.repeticiones === 1 ? "El trozo" : `Los ${op.repeticiones} trozos`}${op.letra ? ` ${op.letra}` : ""} del paso ${op.delPaso}`;

  return (
    <div className="hc-operacion">
      <h3>
        <span className="hc-op-que">
          {queEs}: {mm(op.largo)} × {mm(op.ancho)}
        </span>
        <span className={`hc-op-dir hc-${op.direccion}`}>
          Nivel {op.nivel} · cortes {op.direccion === "longitudinal" ? "longitudinales (a lo largo)" : "transversales (de través)"}
        </span>
        {veces > 1 && (
          <span className="hc-op-veces">
            hacerlo {veces} veces
            {multiplicador > 1 && op.repeticiones > 1
              ? ` (${op.repeticiones} por placa)`
              : ""}
          </span>
        )}
      </h3>

      {op.tandas.map((tanda, t) => (
        <div key={t} className="hc-tanda">
          {op.tandas.length > 1 && (
            <p className="hc-tanda-titulo">
              Tanda {t + 1} de {op.tandas.length}
            </p>
          )}
          <table className="hc-pasos">
            <tbody>
              {tanda.map((paso) => (
                <tr key={paso.numero}>
                  <td className="hc-casilla">
                    <input
                      type="checkbox"
                      data-paso={`${indice}-${paso.numero}`}
                      aria-label={`Paso ${paso.numero} hecho`}
                    />
                  </td>
                  <td className="hc-num">
                    <span>{paso.numero}</span>
                  </td>
                  <td className="hc-medida">{mm(paso.medida)}</td>
                  <td className="hc-veces">
                    ×{paso.veces}
                    {paso.ultimaSinCorte && (
                      <span className="hc-sin-corte">
                        {paso.veces === 1
                          ? "sin cortar: es lo que queda"
                          : "la última sin cortar: es lo que queda"}
                      </span>
                    )}
                  </td>
                  <td className="hc-sale">
                    {paso.sale.map((s, k) => (
                      <SaleDe key={k} salida={s} paso={paso.numero} cantos={cantos} />
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <p className="hc-queda">
        Queda:{" "}
        {op.sobra ? (
          <>
            <strong>
              {mm(op.sobra.largo)} × {mm(op.sobra.ancho)}
            </strong>{" "}
            {/* De la placa que se vende entera, todo lo que sobra es del
                cliente, también lo que no llega a retal (H402). */}
            {delCliente
              ? "· del cliente"
              : op.sobra.tipo === "retal"
                ? "· retal al stock"
                : "· desperdicio"}
          </>
        ) : (
          "nada: la última tira llega al borde"
        )}
      </p>
    </div>
  );
}

function SaleDe({ salida, paso, cantos }: { salida: Salida; paso: number; cantos: CantoDePieza[] }) {
  if (salida.tipo === "pieza") {
    const canto = textoDelCanto(cantos[(salida.renglon ?? 1) - 1]);
    return (
      <p>
        <strong>
          {salida.cantidad} {salida.cantidad === 1 ? "pieza" : "piezas"} P{salida.renglon}
        </strong>{" "}
        {mm(salida.largo)} × {mm(salida.ancho)}
        {salida.girada ? " (girada)" : ""}
        {salida.etiqueta ? ` · ${salida.etiqueta}` : ""}
        {canto && <span className="hc-canto"> · {canto}</span>}
      </p>
    );
  }
  return (
    <p>
      {salida.cantidad} {salida.cantidad === 1 ? "trozo" : "trozos"}
      {salida.letra ? <strong> {salida.letra}</strong> : null} de{" "}
      {mm(salida.largo)} × {mm(salida.ancho)}{" "}
      <span className="hc-sigue">
        → se sigue cortando abajo, en «{salida.letra ? `${salida.letra} ` : ""}del paso {paso}»
      </span>
    </p>
  );
}

/**
 * La placa a escala, con cada corte rotulado con el número de su paso.
 *
 * En milímetros de placa, como el plano del taller: el `viewBox` es la placa y
 * cada cosa se dibuja con sus números, sin conversiones.
 */
function Dibujo({
  patron,
  hoja,
  indice,
}: {
  patron: PatronDeCorte;
  hoja: HojaDeCorte;
  indice: number;
}) {
  const { placaLargo, placaAncho } = hoja;
  // El rótulo se ve igual en una placa entera que en una media: se escala
  // contra el lado mayor.
  const escala = Math.max(placaLargo, placaAncho) / 2750;
  const radio = 34 * escala;
  const idRayado = `hc-rayado-${indice}`;

  return (
    <svg
      viewBox={`-60 -70 ${placaLargo + 120} ${placaAncho + 130}`}
      className="hc-dibujo"
      role="img"
      aria-label={`Dibujo de ${patron.placas.length === 1 ? "la placa" : "las placas"} con ${patron.piezasPorPlaca} piezas y ${patron.dibujo.cortes.length} cortes numerados`}
    >
      <defs>
        <pattern id={idRayado} width={40} height={40} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={40} stroke="#b9b0a5" strokeWidth={10} />
        </pattern>
      </defs>

      <rect x={0} y={0} width={placaLargo} height={placaAncho} fill="#efe9e0" stroke="#1a1a1a" strokeWidth={5} />

      {patron.dibujo.sobrantes.map((s, i) => (
        <g key={`s${i}`}>
          <rect
            x={s.rect.x}
            y={s.rect.y}
            width={s.rect.ancho}
            height={s.rect.alto}
            fill={s.tipo === "retal" ? "none" : `url(#${idRayado})`}
            stroke="#8a8178"
            strokeWidth={2}
            strokeDasharray={s.tipo === "retal" ? "14 10" : undefined}
          />
          {s.tipo === "retal" && Math.min(s.rect.ancho, s.rect.alto) > 140 && (
            <text
              x={s.rect.x + s.rect.ancho / 2}
              y={s.rect.y + s.rect.alto / 2 + 12}
              fontSize={Math.min(40 * escala, s.rect.alto * 0.3, (s.rect.ancho * 1.4) / 14)}
              textAnchor="middle"
              fill="#6b635a"
              className="hc-txt-medida"
            >
              retal {mm(s.rect.ancho)} × {mm(s.rect.alto)}
            </text>
          )}
        </g>
      ))}

      {patron.dibujo.piezas.map(({ rect, pieza }, i) => {
        const medida = `${mm(rect.ancho)} × ${mm(rect.alto)}`;
        const cuerpoP = Math.min(60 * escala, rect.alto * 0.42, rect.ancho * 0.3);
        // Una pieza angosta y alta lleva la medida parada, debajo de su
        // número: acostada se pisaba con la de al lado (H194). Un dígito
        // ocupa ~0,6 del cuerpo.
        const parada = rect.alto > rect.ancho * 1.4;
        const disponible = parada ? rect.alto - cuerpoP * 2.4 : rect.ancho;
        const cuerpo = Math.min(
          46 * escala,
          parada ? rect.ancho * 0.55 : rect.alto * 0.3,
          (disponible * 0.9) / (medida.length * 0.6),
        );
        const entranDos = parada ? disponible > 0 : rect.alto > cuerpoP + cuerpo + 20;
        const cx = rect.x + rect.ancho / 2;
        const yP = parada
          ? rect.y + cuerpoP * 1.15
          : entranDos
            ? rect.y + rect.alto / 2 - 4
            : rect.y + rect.alto / 2 + cuerpoP * 0.35;
        const cyMedida = parada ? rect.y + cuerpoP * 2.4 + disponible / 2 : rect.y + rect.alto / 2 + cuerpo + 4;
        return (
          <g key={`p${i}`}>
            <rect x={rect.x} y={rect.y} width={rect.ancho} height={rect.alto} fill="#ffffff" stroke="#1a1a1a" strokeWidth={3} />
            <text x={cx} y={yP} fontSize={cuerpoP} fontWeight={700} textAnchor="middle" fill="#1a1a1a">
              P{pieza.indice + 1}
            </text>
            {entranDos && cuerpo >= 12 && (
              <text
                className="hc-txt-medida"
                x={cx}
                y={parada ? cyMedida + cuerpo * 0.35 : cyMedida}
                fontSize={cuerpo}
                textAnchor="middle"
                fill="#444"
                transform={parada ? `rotate(-90 ${cx} ${cyMedida})` : undefined}
              >
                {medida}
              </text>
            )}
          </g>
        );
      })}

      {patron.dibujo.cortes.map((c, i) => (
        <line
          key={`c${i}`}
          x1={c.x1}
          y1={c.y1}
          x2={c.x2}
          y2={c.y2}
          stroke="#c2410c"
          strokeWidth={Math.max(hoja.anchoSierra, 6 * escala)}
        />
      ))}

      {/* Los números van encima de todo para que ninguna pieza los tape. */}
      {patron.dibujo.cortes.map((c, i) => {
        const horizontal = c.y1 === c.y2;
        const largo = horizontal ? c.x2 - c.x1 : c.y2 - c.y1;
        const corrimiento = Math.min(radio * 2.2, largo / 2);
        const cx = horizontal ? c.x1 + corrimiento : c.x1;
        const cy = horizontal ? c.y1 : c.y1 + corrimiento;
        return (
          <g key={`n${i}`}>
            <circle cx={cx} cy={cy} r={radio} fill="#c2410c" stroke="#ffffff" strokeWidth={4 * escala} />
            <text x={cx} y={cy + radio * 0.42} fontSize={radio * 1.15} fontWeight={700} textAnchor="middle" fill="#ffffff">
              {c.paso}
            </text>
          </g>
        );
      })}

      <text x={placaLargo / 2} y={-22} fontSize={44 * escala} textAnchor="middle" fill="#555">
        {mm(placaLargo)} mm (largo)
      </text>
      <text
        x={-22}
        y={placaAncho / 2}
        fontSize={44 * escala}
        textAnchor="middle"
        fill="#555"
        transform={`rotate(-90 -22 ${placaAncho / 2})`}
      >
        {mm(placaAncho)} mm
      </text>
    </svg>
  );
}

const ESTILOS = `
  .hoja-corte { max-width: 210mm; margin: 0 auto; padding: 8mm; font-family: var(--font-sans, sans-serif); color: #1a1a1a; background: #fff; font-size: 12pt; }
  .hc-barra { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 4mm; }
  .hc-titulo { font-size: 17pt; font-weight: 700; }
  .hc-sub { font-size: 11pt; color: #444; margin-top: 1mm; }
  .hc-acciones { display: flex; flex-wrap: wrap; gap: 8px; }
  .hc-boton, .hoja-corte .boton-imprimir { display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 14px; border: 1px solid #bbb; border-radius: 8px; background: #fff; font-size: 12pt; font-weight: 600; color: #1a1a1a; text-decoration: none; cursor: pointer; }
  .hc-numeros { display: flex; flex-wrap: wrap; gap: 6mm; margin: 0 0 4mm; padding: 3mm 4mm; border: 1px solid #ccc; border-radius: 2mm; background: #faf8f5; }
  .hc-valor { font-size: 17pt; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .hc-rotulo { font-size: 9.5pt; color: #444; }
  .hc-reglas { margin-bottom: 4mm; padding: 3mm 4mm; border-left: 4px solid #1a1a1a; background: #f5f3f0; font-size: 11pt; }
  .hc-reglas p + p { margin-top: 1.5mm; }
  .hc-aviso { margin: 3mm 0; padding: 3mm 4mm; border-left: 4px solid #c2410c; background: #fff5ef; font-size: 11.5pt; }
  .hc-patron { margin-top: 6mm; padding-top: 4mm; border-top: 2px solid #1a1a1a; }
  .hc-patron + .hc-patron { break-before: page; }
  .hc-patron-titulo { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3mm; font-size: 16pt; font-weight: 700; }
  .hc-repetida { padding: 0.5mm 2.5mm; border: 2px solid #c2410c; border-radius: 1.5mm; color: #c2410c; font-size: 13pt; }
  .hc-patron-datos { font-size: 11pt; font-weight: 400; color: #444; }
  .hc-duenio { margin: 1mm 0 2mm; font-size: 11pt; color: #444; }
  .hc-dibujo { width: 100%; height: auto; display: block; margin: 2mm 0 4mm; break-inside: avoid; }
  .hc-operacion { margin-bottom: 4mm; break-inside: avoid; }
  .hc-operacion h3 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2mm 4mm; padding: 1.5mm 0; border-bottom: 1px solid #999; font-size: 13pt; }
  .hc-op-que { font-weight: 700; font-variant-numeric: tabular-nums; }
  .hc-op-dir { font-size: 11pt; font-weight: 600; }
  .hc-longitudinal { color: #1f4f8a; }
  .hc-transversal { color: #7a3d0c; }
  .hc-op-veces { font-size: 11pt; font-weight: 700; padding: 0.3mm 2mm; border: 1.5px solid #1a1a1a; border-radius: 1mm; }
  .hc-tanda { margin-top: 1.5mm; }
  .hc-tanda + .hc-tanda { margin-top: 2.5mm; padding-top: 1.5mm; border-top: 1px dashed #aaa; }
  .hc-tanda-titulo { font-size: 10pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
  .hc-pasos { width: 100%; border-collapse: collapse; }
  .hc-pasos td { padding: 1.8mm 2mm; border-bottom: 1px solid #e3e0dc; vertical-align: middle; }
  .hc-casilla { width: 12mm; }
  .hc-casilla input { width: 30px; height: 30px; accent-color: #1a1a1a; }
  .hc-num { width: 11mm; }
  .hc-num span { display: inline-flex; align-items: center; justify-content: center; min-width: 9mm; height: 9mm; padding: 0 1mm; border-radius: 50%; background: #c2410c; color: #fff; font-weight: 700; font-size: 13pt; }
  .hc-medida { width: 34mm; font-family: var(--font-mono, ui-monospace, monospace); font-size: 22pt; font-weight: 700; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
  .hc-veces { width: 30mm; font-size: 16pt; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .hc-sin-corte { display: block; font-size: 9.5pt; font-weight: 400; color: #555; white-space: normal; }
  .hc-sale { font-size: 12pt; }
  .hc-sale p + p { margin-top: 1mm; }
  .hc-sigue { color: #555; }
  .hc-queda { margin-top: 1.5mm; font-size: 11.5pt; color: #333; }
  .hc-pie { margin-top: 6mm; font-size: 10pt; color: #555; }
  .hc-canto { font-weight: 600; }
  .hc-partir { margin-top: 6mm; padding-top: 4mm; border-top: 2px solid #1a1a1a; }
  .hc-partir .hc-sale p + p { margin-top: 1mm; }
  .hc-leyenda { display: none; margin: -2mm 0 3mm; font-size: 12pt; font-variant-numeric: tabular-nums; color: #333; }
  @media print {
    .no-imprimir { display: none !important; }
    .hoja-corte { padding: 0; max-width: none; }
    @page { size: A4; margin: 10mm; }
  }
  /* En el teléfono cada paso es una fila de dos renglones: arriba la casilla,
     el número, la medida y las veces; abajo, de borde a borde, qué sale. Era
     una columna de tres palabras por renglón (H125). */
  @media screen and (max-width: 640px) {
    .hoja-corte { padding: 16px; font-size: 16px; }
    .hc-barra, .hc-acciones { width: 100%; }
    .hc-acciones > * { flex: 1 1 0; justify-content: center; }
    .hc-numeros { gap: 12px 20px; }
    .hc-pasos, .hc-pasos tbody { display: block; }
    .hc-pasos tr { display: grid; grid-template-columns: 40px 40px minmax(0, 1fr) auto; align-items: center; column-gap: 8px; padding: 8px 0; border-bottom: 1px solid #e3e0dc; }
    .hc-pasos td { display: block; width: auto; padding: 0; border: 0; }
    .hc-medida { text-align: left; font-size: 24px; }
    .hc-veces { font-size: 18px; }
    .hc-sale { grid-column: 1 / -1; padding-top: 6px !important; font-size: 16px; }
    .hc-txt-medida { display: none; }
    .hc-leyenda { display: block; margin: 0 0 12px; font-size: 16px; }
  }
`;
