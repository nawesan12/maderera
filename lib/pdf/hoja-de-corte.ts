import "server-only";

import { rgb } from "pdf-lib";
import {
  A4,
  MARGEN,
  NARANJA,
  TINTA,
  TINTA_SUAVE,
  escribir,
  escribirCentrado,
  escribirParrafo,
  linea,
  mm,
  nuevaHoja,
  serializar,
  type Hoja,
} from "@/lib/pdf/hoja";
import type { HojaDeCorte, OperacionDeCorte, PatronDeCorte } from "@/lib/cortes/secuencia";
import { formatearSierra } from "@/lib/cortes/sierra";

/**
 * La hoja de corte para la seccionadora, en PDF.
 *
 * Es la misma hoja que `/hoja-de-corte/[id]`, para guardarla, mandarla por
 * WhatsApp o imprimirla desde una PC sin navegador moderno. Se arma igual que
 * el reporte del corte (`lib/pdf/corte.ts`), con `pdf-lib` y sin navegador.
 *
 * Un patrón por hoja: el dibujo arriba, con cada corte rotulado con el número
 * de su paso, y debajo la lista de pasos con su casilla, en el orden de la
 * máquina. Si la lista no entra, sigue en la hoja siguiente.
 */

export interface CorteParaHoja {
  numero: string;
  cliente: string;
  material: string;
  deQueSale: string;
  createdAt: Date;
}

// Sin separador de miles: «1.160» se tipearía como 1,16 en la máquina.
const numero = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1, useGrouping: false });
const n = (v: number) => numero.format(v);

const ROJO_CORTE = rgb(0.76, 0.25, 0.05);
const FONDO_PLACA = rgb(0.94, 0.91, 0.88);
const GRIS_SOBRANTE = rgb(0.72, 0.69, 0.65);

export async function hojaDeCortePdf(
  corte: CorteParaHoja,
  hoja: HojaDeCorte,
): Promise<Uint8Array> {
  const h = await nuevaHoja();
  const anchoUtil = A4.ancho - MARGEN * 2;
  let y = A4.alto - MARGEN;

  const cabecera = () => {
    escribir(h, `HOJA DE CORTE ${corte.numero}`, { x: MARGEN, y, tamano: 15, fuente: h.negrita });
    escribir(h, corte.createdAt.toLocaleDateString("es-AR"), {
      x: A4.ancho - MARGEN,
      y,
      tamano: 9,
      color: TINTA_SUAVE,
      derecha: true,
    });
    y -= 15;
    escribir(
      h,
      `${corte.cliente} · ${corte.material} · ${corte.deQueSale} de ${n(hoja.placaLargo)} × ${n(hoja.placaAncho)} mm · sierra ${formatearSierra(hoja.anchoSierra)}`,
      { x: MARGEN, y, tamano: 9.5, color: TINTA_SUAVE },
    );
    y -= 10;
    linea(h, y);
    y -= 14;
  };

  const hojaNueva = () => {
    h.pagina = h.doc.addPage([A4.ancho, A4.alto]);
    y = A4.alto - MARGEN;
    cabecera();
  };

  cabecera();

  y -= escribirParrafo(
    h,
    `Las medidas son las de la pieza: la máquina descuenta la sierra sola y tiene que tener cargado un disco de ${formatearSierra(hoja.anchoSierra)}. Sin refilado: el plano usa la placa entera. Orden de la seccionadora: primero los cortes longitudinales de la placa, después los transversales de cada tira, después los de tercer nivel. Tandas de hasta 4 medidas. ${hoja.placas} ${hoja.placas === 1 ? "placa" : "placas"}, ${hoja.totalPiezas} piezas.`,
    { x: MARGEN, y, ancho: anchoUtil, tamano: 9.5 },
  );
  y -= 6;

  if (hoja.noEntran.length > 0) {
    escribir(
      h,
      `${hoja.noEntran.length === 1 ? "Una pieza no entra" : `${hoja.noEntran.length} piezas no entran`} en la placa y no está en esta hoja: ${hoja.noEntran.map((p) => `${n(p.largoMm)} × ${n(p.anchoMm)}`).join(", ")}`,
      { x: MARGEN, y, tamano: 9.5, fuente: h.negrita, color: NARANJA },
    );
    y -= 16;
  }

  if (hoja.patrones.length === 0) {
    escribir(h, "No hay nada que cortar: el trabajo no tiene piezas que entren en la placa.", {
      x: MARGEN,
      y,
      tamano: 11,
      fuente: h.negrita,
    });
  }

  hoja.patrones.forEach((patron, i) => {
    if (i > 0) hojaNueva();
    y = dibujarPatron(h, patron, hoja, y, hojaNueva, () => y, (nuevo) => (y = nuevo));
  });

  return serializar(h);
}

function dibujarPatron(
  h: Hoja,
  patron: PatronDeCorte,
  hoja: HojaDeCorte,
  desde: number,
  hojaNueva: () => void,
  leerY: () => number,
  fijarY: (y: number) => void,
): number {
  const anchoUtil = A4.ancho - MARGEN * 2;
  let y = desde;

  const cuantas = patron.placas.length;
  const titulo =
    cuantas === 1
      ? `Placa ${patron.placas[0]}`
      : `Placas ${patron.placas.join(", ")} · ×${cuantas} placas iguales`;
  escribir(h, titulo, { x: MARGEN, y, tamano: 13, fuente: h.negrita });
  y -= 13;
  escribir(
    h,
    `${patron.piezasPorPlaca} piezas · ${patron.pasadasPorPlaca} cortes${cuantas > 1 ? " por placa" : ""} · ${patron.seVendeEntera ? "se vende entera: los retales son del cliente" : "se cobra el corte: los retales quedan en la maderera"}`,
    { x: MARGEN, y, tamano: 9, color: TINTA_SUAVE },
  );
  y -= 8;

  // El dibujo, a escala, con el ancho de la hoja y sin pasar de 95 mm de alto.
  const escala = Math.min(anchoUtil / hoja.placaLargo, mm(95) / hoja.placaAncho);
  const alto = hoja.placaAncho * escala;
  const x0 = MARGEN;
  const y0 = y - alto; // abajo a la izquierda, en puntos de PDF
  // El plano tiene el origen arriba a la izquierda; PDF, abajo.
  const X = (v: number) => x0 + v * escala;
  const Y = (v: number) => y - v * escala;

  h.pagina.drawRectangle({
    x: x0,
    y: y0,
    width: hoja.placaLargo * escala,
    height: alto,
    color: FONDO_PLACA,
    borderColor: TINTA,
    borderWidth: 1.2,
  });

  for (const s of patron.dibujo.sobrantes) {
    h.pagina.drawRectangle({
      x: X(s.rect.x),
      y: Y(s.rect.y + s.rect.alto),
      width: s.rect.ancho * escala,
      height: s.rect.alto * escala,
      color: s.tipo === "retal" ? undefined : GRIS_SOBRANTE,
      opacity: s.tipo === "retal" ? undefined : 0.5,
      borderColor: GRIS_SOBRANTE,
      borderWidth: 0.6,
      borderDashArray: s.tipo === "retal" ? [3, 2] : undefined,
    });
  }

  for (const { rect, pieza } of patron.dibujo.piezas) {
    h.pagina.drawRectangle({
      x: X(rect.x),
      y: Y(rect.y + rect.alto),
      width: rect.ancho * escala,
      height: rect.alto * escala,
      color: rgb(1, 1, 1),
      borderColor: TINTA,
      borderWidth: 0.8,
    });
    const anchoPt = rect.ancho * escala;
    const altoPt = rect.alto * escala;
    const cuerpo = Math.min(10, altoPt * 0.4, anchoPt * 0.3);
    if (cuerpo >= 4) {
      escribirCentrado(h, `P${pieza.indice + 1}`, {
        centroX: X(rect.x + rect.ancho / 2),
        y: Y(rect.y + rect.alto / 2) + (altoPt > cuerpo * 2.6 ? 1 : -cuerpo * 0.35),
        tamano: cuerpo,
        fuente: h.negrita,
      });
      const medida = `${n(rect.ancho)} × ${n(rect.alto)}`;
      const cuerpoMedida = Math.min(7, cuerpo * 0.8);
      if (
        altoPt > cuerpo * 2.6 &&
        h.normal.widthOfTextAtSize(medida, cuerpoMedida) < anchoPt - 2
      ) {
        escribirCentrado(h, medida, {
          centroX: X(rect.x + rect.ancho / 2),
          y: Y(rect.y + rect.alto / 2) - cuerpoMedida - 1,
          tamano: cuerpoMedida,
          color: TINTA_SUAVE,
        });
      }
    }
  }

  for (const c of patron.dibujo.cortes) {
    h.pagina.drawLine({
      start: { x: X(c.x1), y: Y(c.y1) },
      end: { x: X(c.x2), y: Y(c.y2) },
      thickness: 1.4,
      color: ROJO_CORTE,
    });
  }
  for (const c of patron.dibujo.cortes) {
    const horizontal = c.y1 === c.y2;
    const largoPt = (horizontal ? c.x2 - c.x1 : c.y2 - c.y1) * escala;
    const corrimiento = Math.min(11, largoPt / 2);
    const cx = horizontal ? X(c.x1) + corrimiento : X(c.x1);
    const cy = horizontal ? Y(c.y1) : Y(c.y1) - corrimiento;
    h.pagina.drawCircle({ x: cx, y: cy, size: 5.2, color: ROJO_CORTE, borderColor: rgb(1, 1, 1), borderWidth: 0.8 });
    escribirCentrado(h, String(c.paso), {
      centroX: cx,
      y: cy - 2.4,
      tamano: c.paso >= 10 ? 6 : 7,
      fuente: h.negrita,
      color: rgb(1, 1, 1),
    });
  }

  y = y0 - 16;
  fijarY(y);

  if (patron.operaciones.length === 0) {
    escribir(h, "La pieza es la placa entera: no lleva cortes.", { x: MARGEN, y, tamano: 10 });
    return y - 14;
  }

  for (const op of patron.operaciones) {
    y = dibujarOperacion(h, op, patron, leerY(), hojaNueva, leerY);
    fijarY(y);
  }

  return y;
}

/** Alto de un renglón de paso. */
const RENGLON = 19;

function dibujarOperacion(
  h: Hoja,
  op: OperacionDeCorte,
  patron: PatronDeCorte,
  desde: number,
  hojaNueva: () => void,
  leerY: () => number,
): number {
  let y = desde;
  const necesita = 30 + op.pasos.length * RENGLON + op.tandas.length * 10;
  if (y - Math.min(necesita, 200) < MARGEN) {
    hojaNueva();
    y = leerY();
  }

  const veces = op.repeticiones * patron.placas.length;
  const queEs =
    op.delPaso === null
      ? "La placa"
      : `${op.repeticiones === 1 ? "El trozo" : `Los ${op.repeticiones} trozos`}${op.letra ? ` ${op.letra}` : ""} del paso ${op.delPaso}`;
  escribir(h, `${queEs}: ${n(op.largo)} × ${n(op.ancho)}`, {
    x: MARGEN,
    y,
    tamano: 11,
    fuente: h.negrita,
  });
  escribir(
    h,
    `Nivel ${op.nivel} · ${op.direccion === "longitudinal" ? "longitudinales (a lo largo)" : "transversales (de través)"}${veces > 1 ? ` · hacerlo ${veces} veces` : ""}`,
    { x: A4.ancho - MARGEN, y, tamano: 9.5, fuente: h.negrita, derecha: true, color: TINTA_SUAVE },
  );
  y -= 5;
  linea(h, y, { grosor: 0.6, color: TINTA_SUAVE });
  y -= 15;

  op.tandas.forEach((tanda, t) => {
    if (op.tandas.length > 1) {
      escribir(h, `TANDA ${t + 1} DE ${op.tandas.length}`, {
        x: MARGEN,
        y: y + 2,
        tamano: 7,
        color: TINTA_SUAVE,
      });
      y -= 10;
    }
    for (const paso of tanda) {
      if (y < MARGEN + RENGLON) {
        hojaNueva();
        y = leerY();
      }
      // La casilla para tildar.
      h.pagina.drawRectangle({
        x: MARGEN,
        y: y - 3,
        width: 11,
        height: 11,
        borderColor: TINTA,
        borderWidth: 1,
      });
      h.pagina.drawCircle({ x: MARGEN + 25, y: y + 2.5, size: 7, color: ROJO_CORTE });
      escribirCentrado(h, String(paso.numero), {
        centroX: MARGEN + 25,
        y: y - 0.5,
        tamano: 8,
        fuente: h.negrita,
        color: rgb(1, 1, 1),
      });
      escribir(h, n(paso.medida), {
        x: MARGEN + mm(36),
        y: y - 2,
        tamano: 15,
        fuente: h.negrita,
        derecha: true,
      });
      escribir(h, `×${paso.veces}`, { x: MARGEN + mm(39), y: y - 1, tamano: 12, fuente: h.negrita });
      const sale = paso.sale
        .map((s) =>
          s.tipo === "pieza"
            ? `${s.cantidad} ${s.cantidad === 1 ? "pieza" : "piezas"} P${s.renglon} ${n(s.largo)} × ${n(s.ancho)}${s.girada ? " (girada)" : ""}${s.etiqueta ? ` · ${s.etiqueta}` : ""}`
            : `${s.cantidad} ${s.cantidad === 1 ? "trozo" : "trozos"}${s.letra ? ` ${s.letra}` : ""} de ${n(s.largo)} × ${n(s.ancho)}: sigue en «${s.letra ? `${s.letra} ` : ""}del paso ${paso.numero}»`,
        )
        .join(" / ");
      const nota = paso.ultimaSinCorte
        ? paso.veces === 1
          ? " (sin cortar: es lo que queda)"
          : " (la última sin cortar)"
        : "";
      const altoTexto = escribirParrafo(h, sale + nota, {
        x: MARGEN + mm(54),
        y,
        ancho: A4.ancho - MARGEN * 2 - mm(54),
        tamano: 9,
        interlineado: 10,
      });
      // Si lo que sale ocupa varias líneas, el renglón crece con ellas.
      y -= Math.max(RENGLON, altoTexto + 9);
    }
  });

  const sobra = op.sobra
    ? `Queda: ${n(op.sobra.largo)} × ${n(op.sobra.ancho)} · ${op.sobra.tipo === "retal" ? (patron.seVendeEntera ? "retal para el cliente" : "retal al stock") : "desperdicio"}`
    : "Queda: nada, la última tira llega al borde";
  escribir(h, sobra, { x: MARGEN + mm(54), y: y + 4, tamano: 8.5, color: TINTA_SUAVE });
  return y - 12;
}
