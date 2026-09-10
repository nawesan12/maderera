import "server-only";

import {
  A4,
  LINEA,
  MARGEN,
  TINTA,
  TINTA_SUAVE,
  encabezadoEmisor,
  escribir,
  escribirCentrado,
  escribirParrafo,
  linea,
  mm,
  nuevaHoja,
  recuadro,
  serializar,
  type Hoja,
} from "./hoja";
import { desagregar } from "@/lib/fiscal/impuestos";
import { fechaSolaCorta, formatearUnidad, moneda } from "@/lib/formato";
import { SUCURSALES } from "@/lib/sucursales";
import type { PresupuestoCompleto } from "@/lib/dal/admin/ventas";
import type { DatosParaTransferir } from "@/lib/dal/pagos";

/**
 * El presupuesto en PDF.
 *
 * El modelo es el que la maderera imprime hoy desde su sistema de escritorio
 * —la clienta mandó uno real, el de Serymat Atlántica, "para que hagamos así o
 * mejor"—. De ahí salen las cosas que el papel tiene que decir sí o sí: el
 * número, el vendedor, el código de cliente, la condición de IVA, el neto y el
 * IVA discriminados para un inscripto, la advertencia de la percepción de IIBB
 * y el pie con las dos sucursales y los datos para transferir.
 *
 * **El IVA se discrimina según quién mira**, igual que en pantalla: un
 * responsable inscripto o un monotributista ven neto + IVA; un consumidor
 * final ve el total con la leyenda de IVA incluido. La alícuota es la del
 * producto de cada línea, no un 21 parejo.
 */

const PIE_ALTO = mm(30);

/** Corta de página cuando el detalle no entra. El pie va solo en la última. */
function asegurarEspacio(hoja: Hoja, cursor: number, necesario: number): number {
  if (cursor - necesario > MARGEN + PIE_ALTO) return cursor;

  hoja.pagina = hoja.doc.addPage([A4.ancho, A4.alto]);
  return A4.alto - MARGEN;
}

export async function presupuestoPdf(
  presupuesto: PresupuestoCompleto,
  emisor: {
    razonSocial?: string | null;
    nombreFantasia?: string | null;
    domicilio?: string | null;
    cuit?: string | null;
  } | null,
  banco: DatosParaTransferir | null,
): Promise<Uint8Array> {
  const hoja = await nuevaHoja();
  const derecha = A4.ancho - MARGEN;

  const finEmisor = encabezadoEmisor(hoja, emisor, A4.alto - MARGEN - 10);

  // Encabezado derecho: qué es, qué número tiene y cuándo se hizo.
  let y = A4.alto - MARGEN - 10;
  escribir(hoja, "PRESUPUESTO", {
    x: derecha,
    y,
    tamano: 15,
    fuente: hoja.negrita,
    derecha: true,
  });
  y -= 16;

  escribir(hoja, presupuesto.numero, {
    x: derecha,
    y,
    tamano: 13,
    fuente: hoja.mono,
    derecha: true,
  });
  y -= 13;

  const cabecera: (string | null)[] = [
    `Fecha ${fechaSolaCorta.format(presupuesto.createdAt)}`,
    presupuesto.sucursal ? `Emitido en ${presupuesto.sucursal}` : null,
    presupuesto.validoHasta
      ? `Vale hasta el ${fechaSolaCorta.format(presupuesto.validoHasta)}`
      : null,
  ];
  for (const texto of cabecera) {
    if (!texto) continue;
    escribir(hoja, texto, {
      x: derecha,
      y,
      tamano: 7.5,
      color: TINTA_SUAVE,
      derecha: true,
    });
    y -= 10;
  }

  // Cliente: los datos que el sistema viejo imprime y la casa espera ver.
  let cursor = Math.min(finEmisor, y) - mm(8);
  const altoCaja = mm(24);

  recuadro(hoja, {
    x: MARGEN,
    y: cursor - altoCaja,
    ancho: A4.ancho - MARGEN * 2,
    alto: altoCaja,
    grosor: 0.5,
    color: LINEA,
  });

  escribir(hoja, "CLIENTE", {
    x: MARGEN + 8,
    y: cursor - 12,
    tamano: 6,
    fuente: hoja.negrita,
    color: TINTA_SUAVE,
  });

  const CONDICIONES: Record<string, string> = {
    responsable_inscripto: "Responsable inscripto",
    monotributista: "Monotributista",
    exento: "Exento",
    consumidor_final: "Consumidor final",
    no_categorizado: "No categorizado",
  };

  const columna = (A4.ancho - MARGEN * 2) / 3;
  const datos: [string, string][] = [
    [
      "Cliente",
      presupuesto.empresa
        ? `${presupuesto.cliente} · ${presupuesto.empresa}`
        : presupuesto.cliente,
    ],
    ["Cód. cliente", presupuesto.clienteCodigo || "—"],
    ["Vendedor", presupuesto.vendedor || presupuesto.asesor || "—"],
    ["Domicilio", presupuesto.clienteDireccion || "—"],
    ["CUIT", presupuesto.clienteCuit || "—"],
    [
      "IVA",
      presupuesto.clienteCondicionIva
        ? (CONDICIONES[presupuesto.clienteCondicionIva] ??
          presupuesto.clienteCondicionIva)
        : "Consumidor final",
    ],
  ];

  datos.forEach(([etiqueta, valor], i) => {
    const x = MARGEN + 8 + (i % 3) * columna;
    const yFila = cursor - 26 - Math.floor(i / 3) * 20;
    escribir(hoja, etiqueta, { x, y: yFila, tamano: 6, color: TINTA_SUAVE });
    escribir(hoja, valor, { x, y: yFila - 9, tamano: 8.5, fuente: hoja.negrita });
  });

  cursor -= altoCaja + mm(6);

  // Detalle
  const colCantidad = MARGEN + mm(16);
  const colUnidad = MARGEN + mm(34);
  const colDescripcion = MARGEN + mm(38);
  const colPrecio = derecha - mm(28);
  const anchoDescripcion = colPrecio - colDescripcion - mm(30);

  function encabezadoDeTabla(c: number): number {
    escribir(hoja, "CANT.", {
      x: colCantidad,
      y: c,
      tamano: 6,
      fuente: hoja.negrita,
      color: TINTA_SUAVE,
      derecha: true,
    });
    escribir(hoja, "DESCRIPCIÓN", {
      x: colDescripcion,
      y: c,
      tamano: 6,
      fuente: hoja.negrita,
      color: TINTA_SUAVE,
    });
    escribir(hoja, "PRECIO", {
      x: colPrecio,
      y: c,
      tamano: 6,
      fuente: hoja.negrita,
      color: TINTA_SUAVE,
      derecha: true,
    });
    escribir(hoja, "TOTAL", {
      x: derecha,
      y: c,
      tamano: 6,
      fuente: hoja.negrita,
      color: TINTA_SUAVE,
      derecha: true,
    });
    c -= 6;
    linea(hoja, c, { grosor: 1, color: TINTA });
    return c - 14;
  }

  cursor = encabezadoDeTabla(cursor);

  for (const item of presupuesto.items) {
    const antes = cursor;
    cursor = asegurarEspacio(hoja, cursor, mm(14));
    if (cursor !== antes) cursor = encabezadoDeTabla(cursor);

    escribir(hoja, String(Number(item.cantidad)), {
      x: colCantidad,
      y: cursor,
      tamano: 9,
      fuente: hoja.mono,
      derecha: true,
    });
    escribir(hoja, formatearUnidad(item.unidad), {
      x: colUnidad,
      y: cursor,
      tamano: 7,
      color: TINTA_SUAVE,
      derecha: true,
    });

    const alto = escribirParrafo(hoja, item.descripcion, {
      x: colDescripcion,
      y: cursor,
      ancho: anchoDescripcion,
      tamano: 9,
    });

    escribir(hoja, moneda.format(Number(item.precioUnitario)), {
      x: colPrecio,
      y: cursor,
      tamano: 9,
      fuente: hoja.mono,
      derecha: true,
    });
    escribir(hoja, moneda.format(Number(item.subtotal)), {
      x: derecha,
      y: cursor,
      tamano: 9,
      fuente: hoja.mono,
      derecha: true,
    });

    cursor -= Math.max(alto, 12) + 4;
    linea(hoja, cursor + 8);
  }

  // Totales. Para un inscripto o un monotributista el papel discrimina, como
  // el sistema viejo; la alícuota es la de cada producto.
  const discrimina =
    presupuesto.clienteCondicionIva === "responsable_inscripto" ||
    presupuesto.clienteCondicionIva === "monotributista";

  const total = Number(presupuesto.total);
  const subtotal = Number(presupuesto.subtotal);
  const descuento = subtotal - total;

  cursor = asegurarEspacio(hoja, cursor, mm(40)) - mm(2);

  const filasDeTotales: [string, string, boolean][] = [];

  if (descuento > 0.009) {
    filasDeTotales.push(["Subtotal", moneda.format(subtotal), false]);
    filasDeTotales.push(["Descuento", `-${moneda.format(descuento)}`, false]);
  }

  if (discrimina) {
    let neto = 0;
    let iva = 0;
    for (const item of presupuesto.items) {
      const parte = desagregar(
        Number(item.subtotal),
        Number(item.alicuotaIva ?? 21),
      );
      neto += parte.neto;
      iva += parte.iva;
    }
    // El descuento se prorratea sobre el neto, que es como lo hace la factura.
    if (descuento > 0.009 && subtotal > 0) {
      const factor = total / subtotal;
      neto *= factor;
      iva = total - neto;
    }
    filasDeTotales.push(["Neto gravado", moneda.format(neto), false]);
    filasDeTotales.push(["IVA", moneda.format(iva), false]);
  }

  filasDeTotales.push(["TOTAL", moneda.format(total), true]);

  for (const [etiqueta, valor, fuerte] of filasDeTotales) {
    escribir(hoja, etiqueta, {
      x: colPrecio,
      y: cursor,
      tamano: fuerte ? 10 : 8.5,
      fuente: fuerte ? hoja.negrita : hoja.normal,
      color: fuerte ? TINTA : TINTA_SUAVE,
      derecha: true,
    });
    escribir(hoja, valor, {
      x: derecha,
      y: cursor,
      tamano: fuerte ? 11 : 9,
      fuente: fuerte ? hoja.negrita : hoja.mono,
      derecha: true,
    });
    cursor -= fuerte ? 16 : 12;
  }

  if (!discrimina) {
    escribir(hoja, "Precios finales con IVA incluido", {
      x: derecha,
      y: cursor,
      tamano: 7,
      color: TINTA_SUAVE,
      derecha: true,
    });
    cursor -= 12;
  }

  // Las leyendas del papel viejo, que son las reglas comerciales de la casa.
  cursor -= mm(4);
  const leyendas = [
    "Los precios sólo se fijan cuando se abone la totalidad del presupuesto. Los precios podrían variar sin previo aviso.",
    discrimina
      ? "Los responsables inscriptos y monotributistas verán incrementados estos precios en el importe de la percepción de IIBB Pcia. Bs. As. que les corresponda."
      : null,
  ];
  for (const leyenda of leyendas) {
    if (!leyenda) continue;
    cursor = asegurarEspacio(hoja, cursor, mm(10));
    cursor -=
      escribirParrafo(hoja, leyenda, {
        x: MARGEN,
        y: cursor,
        ancho: A4.ancho - MARGEN * 2,
        tamano: 7,
        color: TINTA_SUAVE,
      }) + 4;
  }

  if (presupuesto.notas) {
    cursor -= mm(2);
    cursor = asegurarEspacio(hoja, cursor, mm(12));
    cursor -= escribirParrafo(hoja, presupuesto.notas, {
      x: MARGEN,
      y: cursor,
      ancho: A4.ancho - MARGEN * 2,
      tamano: 8,
      color: TINTA_SUAVE,
    });
  }

  // Pie: las dos sucursales y los datos para transferir, como el papel actual.
  const yPie = MARGEN + PIE_ALTO - mm(4);
  linea(hoja, yPie + mm(2), { grosor: 0.5 });

  const anchoPie = (A4.ancho - MARGEN * 2) / (banco ? 3 : 2);

  SUCURSALES.forEach((sucursal, i) => {
    const x = MARGEN + i * anchoPie;
    escribir(hoja, sucursal.nombre, {
      x,
      y: yPie - 8,
      tamano: 7,
      fuente: hoja.negrita,
    });
    escribir(hoja, sucursal.direccion, {
      x,
      y: yPie - 17,
      tamano: 6.5,
      color: TINTA_SUAVE,
    });
    escribir(hoja, `Tel: ${sucursal.telefono}`, {
      x,
      y: yPie - 25,
      tamano: 6.5,
      color: TINTA_SUAVE,
    });
  });

  if (banco) {
    const x = MARGEN + 2 * anchoPie;
    escribir(hoja, "Para depósito o transferencia", {
      x,
      y: yPie - 8,
      tamano: 7,
      fuente: hoja.negrita,
    });
    const lineasBanco = [
      banco.banco,
      banco.cbu ? `CBU ${banco.cbu}` : null,
      banco.alias ? `Alias ${banco.alias}` : null,
    ].filter((v): v is string => Boolean(v));
    lineasBanco.forEach((texto, i) => {
      escribir(hoja, texto, {
        x,
        y: yPie - 17 - i * 8,
        tamano: 6.5,
        color: TINTA_SUAVE,
      });
    });
  }

  escribirCentrado(
    hoja,
    "Documento no válido como factura.",
    { centroX: A4.ancho / 2, y: MARGEN, tamano: 6.5, color: TINTA_SUAVE },
  );

  return serializar(hoja);
}
