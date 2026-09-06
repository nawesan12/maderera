import "server-only";

import {
  A4,
  MARGEN,
  TINTA_SUAVE,
  encabezadoEmisor,
  escribir,
  linea,
  mm,
  nuevaHoja,
  serializar,
  type Hoja,
} from "./hoja";
import { moneda } from "@/lib/formato";

/**
 * La lista de precios en PDF.
 *
 * El brief la pide como **documentación técnica descargable para
 * profesionales**: "Listas de precios PDF". La plataforma solo exportaba CSV,
 * que sirve para trabajar la planilla pero no para mandársela a un cliente:
 * un mayorista que pide la lista quiere un papel con el membrete, no un
 * archivo que se abre corrido en el teléfono.
 *
 * **Lleva la fecha en grande y el aviso de vigencia.** Los precios de la
 * maderera se mueven todas las semanas —lo dice el propio brief—, así que una
 * lista sin fecha reenviada tres meses después es una discusión asegurada en
 * el mostrador.
 */

export interface FilaDeLista {
  sku: string;
  producto: string;
  medida: string;
  categoria: string;
  precio: string | null;
}

/** Alto de cada renglón. */
const RENGLON = 14;

export async function pdfDeListaDePrecios(datos: {
  titulo: string;
  filas: FilaDeLista[];
  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
  } | null;
  /** "Precios finales con IVA" o "Precios netos, sin IVA". */
  leyendaIva: string;
}): Promise<Uint8Array> {
  const hoja = await nuevaHoja();
  const derecha = A4.ancho - MARGEN;

  let y = encabezadoEmisor(hoja, datos.emisor, hoja.y);

  escribir(hoja, datos.titulo, {
    x: derecha,
    y: hoja.y,
    tamano: 13,
    fuente: hoja.negrita,
    derecha: true,
  });

  const hoy = new Date();
  escribir(hoja, `Vigente al ${hoy.toLocaleDateString("es-AR")}`, {
    x: derecha,
    y: hoja.y - 15,
    tamano: 9,
    derecha: true,
  });

  y -= 8;
  linea(hoja, y);
  y -= 14;

  y = encabezadoDeTabla(hoja, y, derecha);

  // Agrupado por categoría: una lista de mil renglones de ferretería sin
  // separaciones no se puede recorrer con el dedo.
  let categoriaActual = "";

  for (const fila of datos.filas) {
    // Salto de página. Se deja lugar para el pie.
    if (y < MARGEN + mm(20)) {
      hoja.pagina = hoja.doc.addPage([A4.ancho, A4.alto]);
      y = A4.alto - MARGEN;
      y = encabezadoDeTabla(hoja, y, derecha);
      categoriaActual = "";
    }

    if (fila.categoria !== categoriaActual) {
      categoriaActual = fila.categoria;
      y -= 4;
      escribir(hoja, categoriaActual.toUpperCase(), {
        x: MARGEN,
        y,
        tamano: 8,
        fuente: hoja.negrita,
      });
      y -= RENGLON;
    }

    escribir(hoja, fila.sku, { x: MARGEN, y, tamano: 7.5, fuente: hoja.mono });
    escribir(hoja, fila.producto, { x: MARGEN + mm(28), y, tamano: 8 });
    escribir(hoja, fila.medida, {
      x: MARGEN + mm(105),
      y,
      tamano: 8,
      color: TINTA_SUAVE,
    });
    escribir(hoja, fila.precio ? moneda.format(Number(fila.precio)) : "a consultar", {
      x: derecha,
      y,
      tamano: 8.5,
      fuente: fila.precio ? hoja.negrita : hoja.normal,
      color: fila.precio ? undefined : TINTA_SUAVE,
      derecha: true,
    });

    y -= RENGLON;
  }

  y -= 6;
  linea(hoja, y);
  escribir(
    hoja,
    `${datos.leyendaIva}. Los precios pueden cambiar sin aviso; consultá vigencia antes de comprar.`,
    { x: MARGEN, y: y - 12, tamano: 7.5, color: TINTA_SUAVE },
  );

  return serializar(hoja);
}

function encabezadoDeTabla(hoja: Hoja, y: number, derecha: number): number {
  escribir(hoja, "CÓDIGO", { x: MARGEN, y, tamano: 7, color: TINTA_SUAVE });
  escribir(hoja, "PRODUCTO", { x: MARGEN + mm(28), y, tamano: 7, color: TINTA_SUAVE });
  escribir(hoja, "MEDIDA", { x: MARGEN + mm(105), y, tamano: 7, color: TINTA_SUAVE });
  escribir(hoja, "PRECIO", { x: derecha, y, tamano: 7, color: TINTA_SUAVE, derecha: true });

  const siguiente = y - 5;
  linea(hoja, siguiente);
  return siguiente - 12;
}
