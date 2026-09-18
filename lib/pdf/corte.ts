import "server-only";

import {
  A4,
  LINEA,
  MARGEN,
  NARANJA,
  TINTA,
  TINTA_SUAVE,
  encabezadoEmisor,
  escribir,
  escribirParrafo,
  linea,
  mm,
  nuevaHoja,
  serializar,
  type Hoja,
} from "@/lib/pdf/hoja";
import { superficieDeSierra, type PlanoDeCorte } from "@/lib/cortes/plano";
import { rgb } from "pdf-lib";

/**
 * El reporte del trabajo de corte, en PDF.
 *
 * Lo pidió la clienta: «agregar reporte del corte, tabla de medidas hasta el
 * sobrante y todo lo máximo posible». Hasta ahora lo único que bajaba al taller
 * era la hoja HTML del plano, que se imprime pero no se guarda ni se manda por
 * WhatsApp, y que no decía qué sobraba ni cuánto se llevaba la sierra.
 *
 * Lleva, en una hoja:
 *
 * 1. **La cabecera del trabajo**: número, cliente, material, de qué sale
 *    —placa entera o media— y con qué medida se calculó.
 * 2. **Los números**: placas, pasadas, piezas, aprovechado y lo que se lleva el
 *    disco. Es la respuesta a «¿por qué necesito tres placas?».
 * 3. **La tabla de piezas**, placa por placa, con la medida pedida y la medida
 *    sobre la placa —que difiere cuando la pieza va girada— y su posición.
 * 4. **La tabla de sobrantes**, con la medida de cada recorte, su superficie y
 *    de quién es: de una placa vendida entera el recorte se lo lleva el
 *    cliente; de una cobrada por corte, vuelve al stock.
 *
 * Es un documento de taller, no fiscal: no lleva CAE ni numeración, y por eso
 * puede crecer a varias hojas sin ningún problema de numeración.
 */

export interface CorteParaPdf {
  numero: string;
  cliente: string;
  material: string;
  cantoDescripcion: string | null;
  /** «Placa entera» o de qué media sale. */
  deQueSale: string;
  createdAt: Date;
  /** Metros de tapacanto del trabajo, ya calculados. */
  metrosCanto: number;
}

export async function cortePdf(
  corte: CorteParaPdf,
  plano: PlanoDeCorte,
  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
  } | null,
): Promise<Uint8Array> {
  const hoja = await nuevaHoja();
  const anchoUtil = A4.ancho - MARGEN * 2;

  let y = encabezadoEmisor(hoja, emisor, hoja.y);

  escribir(hoja, "REPORTE DE CORTE", {
    x: A4.ancho - MARGEN,
    y: hoja.y,
    tamano: 15,
    fuente: hoja.negrita,
    derecha: true,
  });
  escribir(hoja, corte.numero, {
    x: A4.ancho - MARGEN,
    y: hoja.y - 16,
    tamano: 11,
    fuente: hoja.mono,
    derecha: true,
  });
  escribir(hoja, corte.createdAt.toLocaleDateString("es-AR"), {
    x: A4.ancho - MARGEN,
    y: hoja.y - 28,
    tamano: 8,
    color: TINTA_SUAVE,
    derecha: true,
  });

  y -= 10;
  linea(hoja, y);
  y -= 16;

  // Quién y qué se corta.
  for (const [rotulo, valor] of [
    ["Cliente", corte.cliente],
    ["Material", corte.material],
    [
      "De qué sale",
      `${corte.deQueSale} de ${plano.placaLargo} × ${plano.placaAncho} mm`,
    ],
    ["Tapacanto", corte.cantoDescripcion || "Sin tapacanto"],
  ] as const) {
    escribir(hoja, rotulo, {
      x: MARGEN,
      y,
      tamano: 7.5,
      color: TINTA_SUAVE,
    });
    escribir(hoja, valor, {
      x: MARGEN + mm(28),
      y,
      tamano: 9.5,
      fuente: hoja.negrita,
    });
    y -= 14;
  }

  y -= 6;

  // Los números del trabajo.
  const sierra = plano.placas.reduce(
    (total, placa) => total + superficieDeSierra(placa, plano.anchoSierra),
    0,
  );

  const cifras: [string, string][] = [
    [String(plano.placas.length), plano.placas.length === 1 ? "placa" : "placas"],
    [String(plano.totalPiezas), "piezas"],
    [String(plano.pasadas), "pasadas"],
    [`${Math.round(plano.aprovechadoTotal * 100)}%`, "aprovechado"],
    [`${plano.anchoSierra} mm`, "se lleva la sierra"],
    [`${metros(corte.metrosCanto)} m`, "de tapacanto"],
  ];

  const anchoCifra = anchoUtil / cifras.length;
  hoja.pagina.drawRectangle({
    x: MARGEN,
    y: y - mm(11),
    width: anchoUtil,
    height: mm(13),
    color: rgb(0.98, 0.97, 0.95),
  });

  cifras.forEach(([valor, rotulo], i) => {
    escribir(hoja, valor, {
      x: MARGEN + mm(3) + i * anchoCifra,
      y: y - mm(3),
      tamano: 12,
      fuente: hoja.negrita,
    });
    escribir(hoja, rotulo, {
      x: MARGEN + mm(3) + i * anchoCifra,
      y: y - mm(8),
      tamano: 7,
      color: TINTA_SUAVE,
    });
  });

  y -= mm(18);

  if (plano.noEntran.length > 0) {
    escribir(
      hoja,
      `${plano.noEntran.length === 1 ? "Una pieza no entra" : `${plano.noEntran.length} piezas no entran`} en la placa: ${plano.noEntran
        .map((p) => `${p.largoMm} × ${p.anchoMm} mm`)
        .join(", ")}`,
      { x: MARGEN, y, tamano: 9, fuente: hoja.negrita, color: NARANJA },
    );
    y -= 16;
  }

  // Las piezas, placa por placa.
  y = tabla(
    hoja,
    y,
    "Piezas",
    ["Placa", "N.º", "Sobre la placa", "Como se pidió", "Etiqueta", "Posición"],
    plano.placas.flatMap((placa) =>
      placa.piezas.map((p, i) => [
        String(placa.numero),
        String(i + 1),
        `${p.ancho} × ${p.alto} mm${p.girada ? " (girada)" : ""}`,
        `${p.largoOriginal} × ${p.anchoOriginal} mm`,
        p.etiqueta || "—",
        `x ${p.x} · y ${p.y}`,
      ]),
    ),
  );

  y -= 10;

  // Lo que sobra.
  y = tabla(
    hoja,
    y,
    "Sobrantes",
    ["Placa", "N.º", "Medida", "m²", "De quién es"],
    plano.placas.flatMap((placa) =>
      placa.recortes.length === 0
        ? [
            [
              String(placa.numero),
              "—",
              "Sin pedazos enteros que valga guardar",
              "—",
              "—",
            ],
          ]
        : placa.recortes.map((r, i) => [
            String(placa.numero),
            String(i + 1),
            `${r.ancho} × ${r.alto} mm`,
            metros((r.ancho * r.alto) / 1_000_000),
            placa.seVendeEntera ? "Del cliente" : "Al stock",
          ]),
    ),
  );

  y -= 14;

  escribirParrafo(
    hoja,
    `De lo comprado, el ${Math.round(plano.aprovechadoTotal * 100)}% sale en piezas. La sierra se come ${metros(sierra / 1_000_000)} m² en ${plano.pasadas} ${plano.pasadas === 1 ? "pasada" : "pasadas"} de ${plano.anchoSierra} mm, y el resto queda en los sobrantes de la tabla. De una placa que se vende entera el recorte es del cliente y se va con él; de una que se cobró por corte, vuelve al stock.`,
    { x: MARGEN, y, ancho: anchoUtil, tamano: 8, color: TINTA_SUAVE },
  );

  return serializar(hoja);
}

/**
 * Una tabla con encabezado, que abre hoja nueva cuando se acaba el papel.
 *
 * Un despiece de cuarenta piezas no entra en una carilla, y una tabla cortada
 * al pie de la hoja es exactamente el papel que vuelve al mostrador con una
 * pregunta.
 */
function tabla(
  hoja: Hoja,
  desde: number,
  titulo: string,
  columnas: string[],
  filas: string[][],
): number {
  const anchoUtil = A4.ancho - MARGEN * 2;
  const anchoColumna = anchoUtil / columnas.length;
  let y = desde;

  function encabezado() {
    escribir(hoja, titulo, {
      x: MARGEN,
      y,
      tamano: 10,
      fuente: hoja.negrita,
    });
    y -= 13;

    columnas.forEach((columna, i) => {
      escribir(hoja, columna.toUpperCase(), {
        x: MARGEN + i * anchoColumna,
        y,
        tamano: 6.5,
        color: TINTA_SUAVE,
      });
    });

    y -= 5;
    hoja.pagina.drawLine({
      start: { x: MARGEN, y },
      end: { x: A4.ancho - MARGEN, y },
      thickness: 0.5,
      color: LINEA,
    });
    y -= 11;
  }

  encabezado();

  for (const fila of filas) {
    if (y < MARGEN + mm(18)) {
      hoja.pagina = hoja.doc.addPage([A4.ancho, A4.alto]);
      y = A4.alto - MARGEN;
      encabezado();
    }

    fila.forEach((celda, i) => {
      escribir(hoja, celda, {
        x: MARGEN + i * anchoColumna,
        y,
        tamano: 8,
        color: TINTA,
      });
    });

    y -= 12;
  }

  return y;
}

/** Dos decimales con coma, como se escriben los metros acá. */
function metros(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}
