/**
 * Golden de la migración de ISIS (tanda 13): lo que el TS lee y transforma,
 * para que el Go (internal/migracion) dé lo mismo, exacto.
 *
 * - Las definiciones de las siete entidades y el tamaño del lote.
 * - `interpretarFecha`, `automapear`, `faltantes` y `normalizarFilas` sobre
 *   miles de casos al azar (con semilla): encabezados con tildes, mayúsculas y
 *   palabras de más; importes con formato argentino, paréntesis y basura;
 *   fechas día primero, con año de dos dígitos, imposibles; CUIT que
 *   verifican y que no; correos; opciones escritas como las escribe un
 *   sistema de escritorio; filas cortas y columnas corridas.
 * - La vista previa y lo que contesta el análisis del archivo
 *   (app/admin/migracion/actions.ts, copia textual de 56ef2a1 más abajo).
 * - Archivos de muestra de una exportación de ISIS (no hay reales en el
 *   repo: son sintéticos, con la forma de una grilla exportada a Excel):
 *   CSV en Windows-1252 y en UTF-8 con BOM, con `;`, `,` y tabulador,
 *   campos entre comillas con saltos de línea, y .xlsx con textos
 *   compartidos, números y fechas con formato. Van en
 *   backend/testdata/golden/migracion/archivos/.
 * - Los controles del informe de integridad (lib/migracion/ejecutar.ts,
 *   copia de la parte que no lee la base) con números de la base al azar.
 *
 *   TZ=UTC npx tsx scripts/golden/migracion.ts
 */
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync, gzipSync } from "node:zlib";

// lib/planilla.ts importa "server-only", que fuera de Next tira un error.
const requerir = createRequire(import.meta.url);
const rutaServerOnly = requerir.resolve("server-only");
requerir.cache[rutaServerOnly] = {
  id: rutaServerOnly,
  filename: rutaServerOnly,
  loaded: true,
  exports: {},
} as never;

const DESTINO = new URL("../../backend/testdata/golden/migracion/", import.meta.url);
const ARCHIVOS = new URL("archivos/", DESTINO);

type Entidades = typeof import("./originales/migracion-entidades");
type FilaNormalizada = import("./originales/migracion-entidades").FilaNormalizada;
type ClaveEntidad = import("./originales/migracion-entidades").ClaveEntidad;
type Mapeo = import("./originales/migracion-entidades").Mapeo;

/* -------------------------------------------------------------------------- */
/* Azar con semilla                                                            */
/* -------------------------------------------------------------------------- */

function mulberry32(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const azar = mulberry32(20261029);
const entero = (n: number) => Math.floor(azar() * n);
const elegir = <T>(xs: readonly T[]): T => xs[entero(xs.length)];
const moneda = (p: number) => azar() < p;

/* -------------------------------------------------------------------------- */
/* Copias textuales de app/admin/migracion/actions.ts (56ef2a1)                */
/* -------------------------------------------------------------------------- */

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FILAS = 100_000;

function describir(entidad: ClaveEntidad, datos: Record<string, string>) {
  switch (entidad) {
    case "clientes":
      return {
        identificador: datos.codigo || datos.cuit || "—",
        resumen: [datos.nombre, datos.condicionIva.replace(/_/g, " ")]
          .filter(Boolean)
          .join(" · "),
      };
    case "productos":
      return {
        identificador: datos.sku,
        resumen: [datos.nombre, datos.medida, datos.categoria]
          .filter(Boolean)
          .join(" · "),
      };
    case "stock":
      return {
        identificador: datos.sku,
        resumen: `${datos.cantidad} en ${datos.sucursal}`,
      };
    default:
      return {
        identificador: datos.codigo || datos.cuit || datos.email || "—",
        resumen: [datos.nombre, datos.saldo].filter(Boolean).join(" · "),
      };
  }
}

function previsualizar(m: Entidades, entidad: ClaveEntidad, mapeo: Mapeo, filas: string[][]) {
  const definicion = m.definicionDe(entidad);
  const sinMapear = m.faltantes(definicion, mapeo);

  if (sinMapear.length > 0) {
    return {
      error: `Falta indicar qué columna es ${sinMapear.join(", ")}.`,
    };
  }

  const normalizadas = m.normalizarFilas(definicion, mapeo, filas);

  const conError = normalizadas.filter((f) => f.errores.length > 0);
  const conAviso = normalizadas.filter(
    (f) => f.errores.length === 0 && f.avisos.length > 0,
  );

  const orden = [
    ...conError,
    ...conAviso,
    ...normalizadas.filter((f) => f.errores.length === 0 && f.avisos.length === 0),
  ];

  return {
    validas: normalizadas.length - conError.length,
    conAviso: conAviso.length,
    conError: conError.length,
    muestra: orden.slice(0, 60).map((fila) => ({
      linea: fila.linea,
      ...describir(entidad, fila.datos),
      errores: fila.errores,
      avisos: fila.avisos,
    })),
    rechazos: conError.map((fila) => ({
      linea: fila.linea,
      identificador: describir(entidad, fila.datos).identificador,
      motivo: fila.errores.join(" "),
    })),
  };
}

/** analizarArchivo sin el FormData: el nombre y los bytes. */
function analizar(
  m: Entidades,
  leerPlanilla: (b: Uint8Array) => { filas: string[][]; codificacion: string; error?: string },
  entidad: ClaveEntidad,
  nombre: string,
  bytes: Uint8Array,
) {
  if (bytes.length === 0) {
    return { error: "Elegí un archivo." };
  }

  if (bytes.length > MAX_BYTES) {
    return {
      error: "El archivo pasa los 8 MB. Exportalo en partes —por rubro, por letra, o por año si son ventas— y subilas de a una.",
    };
  }

  const { filas, codificacion, error } = leerPlanilla(bytes);
  if (error) return { error };

  if (filas.length < 2) {
    return {
      error: "El archivo está vacío. Tiene que tener la fila de títulos y al menos una fila de datos.",
    };
  }

  const [columnas, ...cuerpo] = filas;

  if (cuerpo.length > MAX_FILAS) {
    return { error: demasiadas(cuerpo.length) };
  }

  return {
    archivo: nombre,
    columnas,
    filas: cuerpo,
    codificacion,
    mapeo: m.automapear(m.definicionDe(entidad), columnas),
  };
}

const demasiadas = (n: number) =>
  `Son ${n.toLocaleString("es-AR")} filas y el tope por archivo es ${MAX_FILAS.toLocaleString("es-AR")}. Exportalo en partes.`;

/* -------------------------------------------------------------------------- */
/* Copia de informeDeIntegridad (lib/migracion/ejecutar.ts, 56ef2a1)           */
/* sin las consultas: lo que contesta la base llega en `base`.                */
/* -------------------------------------------------------------------------- */

interface EnLaBase {
  /** La suma que devuelve Postgres, como texto (numeric). */
  total: string;
  cuantos: number;
  fichas: number;
  /** La suma del stock (mapWith(Number)). */
  totalStock: number;
}

function controles(entidad: ClaveEntidad, filas: FilaNormalizada[], base: EnLaBase) {
  const validas = filas.filter((f) => f.errores.length === 0);

  if (entidad === "saldos") {
    const esperado = validas.reduce((suma, f) => suma + Number(f.datos.saldo), 0);
    const { total, cuantos } = base;
    const conSaldo = validas.filter((f) => Number(f.datos.saldo) !== 0).length;
    return [
      {
        titulo: "Suma de los saldos",
        detalle:
          "El archivo entero contra todo lo migrado hasta ahora. Si no da igual, hay filas que no entraron y la diferencia es deuda de alguien: está en el listado de abajo. Migrando en varias partes, el número del sistema va a ser mayor.",
        segunElArchivo: esperado.toFixed(2),
        enElSistema: Number(total).toFixed(2),
        ok: Number(total) + 0.01 >= esperado,
      },
      {
        titulo: "Clientes con saldo inicial",
        detalle:
          "Sin contar los que venían en cero, que no generan movimiento porque un movimiento en cero solo ensucia el resumen de cuenta.",
        segunElArchivo: String(conSaldo),
        enElSistema: String(cuantos),
        ok: cuantos >= conSaldo,
      },
    ];
  }

  if (entidad === "clientes") {
    const codigos = new Set(validas.map((f) => f.datos.codigo).filter((c) => c !== ""));
    const { cuantos } = base;
    const sinCuit = validas.filter((f) => !f.datos.cuit).length;
    return [
      {
        titulo: "Fichas con código del sistema anterior",
        detalle:
          "Si el archivo trae códigos repetidos, este número va a ser menor: dos filas con el mismo código son la misma ficha.",
        segunElArchivo: String(codigos.size),
        enElSistema: String(cuantos),
        ok: cuantos >= codigos.size,
      },
      {
        titulo: "Fichas sin CUIT",
        detalle:
          "No es un error —media cartera son consumidores finales—, pero a esos no se les puede emitir factura A.",
        segunElArchivo: String(sinCuit),
        enElSistema: "—",
        ok: true,
      },
    ];
  }

  if (entidad === "proveedores") {
    const conSaldo = validas.filter((f) => Number(f.datos.saldo || 0) !== 0);
    const esperado = conSaldo.reduce((suma, f) => suma + Number(f.datos.saldo), 0);
    const { fichas, total } = base;
    return [
      {
        titulo: "Proveedores con código del sistema anterior",
        detalle: "Los que se pueden volver a actualizar subiendo el archivo de nuevo.",
        segunElArchivo: String(validas.filter((f) => f.datos.codigo).length),
        enElSistema: String(fichas),
        ok: fichas >= validas.filter((f) => f.datos.codigo).length,
      },
      {
        titulo: "Suma de los saldos",
        detalle:
          "Tiene que dar igual. Una diferencia es un proveedor cuyo saldo no se cargó, y eso no lo muestra ningún contador de filas.",
        segunElArchivo: esperado.toFixed(2),
        enElSistema: Number(total).toFixed(2),
        ok: Math.abs(esperado - Number(total)) < 0.01,
      },
    ];
  }

  if (entidad === "ventas_historicas") {
    const esperado = validas.reduce((suma, f) => suma + Number(f.datos.total), 0);
    const sinFicha = validas.filter((f) => !f.datos.codigoCliente).length;
    const { cuantos: cuantas, total } = base;
    return [
      {
        titulo: "Ventas en el archivo histórico",
        detalle: "Puede ser mayor si ya se subieron otros años.",
        segunElArchivo: String(validas.length),
        enElSistema: String(cuantas),
        ok: cuantas >= validas.length,
      },
      {
        titulo: "Suma de los totales",
        detalle: "El del sistema incluye las veces anteriores; el del archivo, solo esta.",
        segunElArchivo: esperado.toFixed(2),
        enElSistema: Number(total).toFixed(2),
        ok: Number(total) >= esperado - 0.01,
      },
      {
        titulo: "Ventas sin código de cliente",
        detalle: "Quedan en el histórico pero no aparecen en la ficha de nadie. Se reconcilian a mano.",
        segunElArchivo: String(sinFicha),
        enElSistema: "—",
        ok: sinFicha === 0,
      },
    ];
  }

  if (entidad === "comprobantes_historicos") {
    const esperado = validas.reduce((suma, f) => suma + Number(f.datos.total), 0);
    const sinCae = validas.filter((f) => !f.datos.cae).length;
    const { cuantos, total } = base;
    return [
      {
        titulo: "Comprobantes en el archivo histórico",
        detalle: "Puede ser mayor si ya se subieron otros períodos.",
        segunElArchivo: String(validas.length),
        enElSistema: String(cuantos),
        ok: cuantos >= validas.length,
      },
      {
        titulo: "Suma de los totales",
        detalle: "Es la cifra que el estudio contable va a querer cruzar.",
        segunElArchivo: esperado.toFixed(2),
        enElSistema: Number(total).toFixed(2),
        ok: Number(total) >= esperado - 0.01,
      },
      {
        titulo: "Comprobantes sin CAE",
        detalle:
          "Se guardan igual, pero un comprobante autorizado que llegó sin CAE es una columna que faltó mapear.",
        segunElArchivo: String(sinCae),
        enElSistema: "—",
        ok: sinCae === 0,
      },
    ];
  }

  if (entidad === "productos") {
    const skus = new Set(validas.map((f) => f.datos.sku));
    const { cuantos } = base;
    const sinPrecio = validas.filter((f) => Number(f.datos.precioGeneral || 0) <= 0).length;
    return [
      {
        titulo: "Códigos distintos en el archivo",
        detalle: "Contra el total de medidas cargadas en el catálogo.",
        segunElArchivo: String(skus.size),
        enElSistema: String(cuantos),
        ok: cuantos >= skus.size,
      },
      {
        titulo: "Medidas sin precio de lista",
        detalle: "No se pueden vender por la tienda hasta que tengan precio.",
        segunElArchivo: String(sinPrecio),
        enElSistema: "—",
        ok: sinPrecio === 0,
      },
    ];
  }

  const unidades = validas.reduce((suma, f) => suma + Number(f.datos.cantidad), 0);
  const total = base.totalStock;
  return [
    {
      titulo: "Unidades en existencia",
      detalle:
        "El total del sistema puede ser mayor: incluye lo que ya estaba cargado en medidas que el archivo no menciona.",
      segunElArchivo: String(unidades),
      enElSistema: String(total),
      ok: total >= unidades,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Lo que se escribe en las celdas                                             */
/* -------------------------------------------------------------------------- */

const VOCAL_CON_TILDE: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", n: "ñ" };

/** Una forma de escribir un encabezado: mayúsculas, tildes, separadores. */
function variarEncabezado(base: string): string {
  let t = base;
  if (moneda(0.3)) t = t.toUpperCase();
  else if (moneda(0.4)) t = t[0].toUpperCase() + t.slice(1);
  if (moneda(0.3)) t = t.replace(/[aeioun]/, (c) => VOCAL_CON_TILDE[c] ?? c);
  if (moneda(0.2)) t = t.replace(/(.{3})/, "$1_");
  if (moneda(0.15)) t = elegir(["Nro. ", "Cod ", "Total ", "", "  "]) + t;
  if (moneda(0.15)) t = t + elegir([" ($)", " (ARS)", ".", " 1", "  "]);
  return t;
}

const COLUMNAS_DE_MAS = ["Fecha alta", "Zona", "", "Localidad", "Provincia", "Saldo USD", "Observ.", "ID interno", "Código postal", "Lista"];

const TEXTOS = [
  "", "  ", "Pérez, Juan", "  TIRANTE PINO  ", "Madera\nsemi dura", '2" x 4" x 3.60m', "Ñandú SRL", " x ",
  "O'Higgins 1234", "a;b", "Maderas", "Placas", "Deck", "Tirante", "Tabla", "Casa Central", "Sucursal Norte",
  "Aserradero", "casa central", "CASA  CENTRAL", "Depósito", "José Pérez", "MARÍA LÓPEZ", "Factura A", "FA", "NC B",
  "Juan", "Fulano de Tal", "﻿BOM", "12345678901234", "Vendedor 1", "  Pablo  ",
];

const NUMEROS = [
  "1.234,56", "1234.56", "$ 12.345", "(1.500,00)", "-200", "0", "0,00", "abc", "12,5", "1.234", "1,234", "0,125",
  "  7 ", "1e3", "--5", "12-5", "$", "1.234.567,89", "(0)", "3,6", "2,5", "-2,5", "1000000", "-0,4", "10,5", "21",
  "105", "99999999999999999999999", "1.5.6", "(12,5", ",5", "5,", "US$ 1.200,00", "- 5", "0,005", "$-100",
];

function numeroAlAzar(): string {
  const n = Math.round((azar() * 2 - 0.3) * 10 ** entero(7)) / 100;
  const formato = entero(4);
  const absoluto = Math.abs(n);
  if (formato === 0) return String(n);
  const [ent, dec] = absoluto.toFixed(2).split(".");
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const texto = `${miles},${dec}`;
  if (formato === 1) return n < 0 ? `(${texto})` : texto;
  if (formato === 2) return `${n < 0 ? "-" : ""}$ ${texto}`;
  return `${n < 0 ? "-" : ""}${miles}`;
}

function cuitAlAzar(dv: (diez: string) => number | null): string {
  const prefijo = elegir(["20", "23", "27", "30", "33", "24", "11", "99"]);
  const cuerpo = String(entero(100_000_000)).padStart(8, "0");
  const diez = prefijo + cuerpo;
  const v = dv(diez);
  const digito = moneda(0.75) && v !== null ? String(v) : String(entero(10));
  const once = diez + digito;
  return elegir([once, `${prefijo}-${cuerpo}-${digito}`, `${prefijo}.${cuerpo}.${digito}`, ` ${once} `]);
}

const CUITS = ["", "20123456789", "abc", "30-71234567-0", "11111111111", "20.123.456", "DNI 30123456", "20-12345678", "0"];

const CORREOS = [
  "Juan@Example.com", "juan @x.com", "x@y", "a@b.c", "MARÍA@CORREO.COM.AR", "İLKER@X.COM", "a@b@c.com",
  " a@b.co", "ventas@maderera.com.ar", "sin correo", "-", "a.b@c.d.e", "a@b.c ", "@b.com", "a@.com",
];

const FECHAS = [
  "03/09/2026", "3/9/26", "3-9-2026", "2026-09-03", "31/02/2026", "29/02/2024", "29/02/2023", "2026-09-03T10:00:00",
  "13/13/2020", "texto", "1/1/0050", "0050-01-01", "0000-01-01", "1/1/00", "1/1/69", "1/1/70", "1/1/099", "1/1/100",
  "01/01/2026 10:30", "2026-9-3", "2026/09/03", "3.9.2026", "32/01/2026", "00/01/2026", "15/00/2026", "1/1/12345",
  " 03/09/2026 ", "2026-02-29", "2024-02-29T00:00:00.000Z", "3/9/2026 hs", "9999-12-31", "1/1/1", "١/٢/٢٠٢٠",
  "2026-09-03Thh", "03-09-26", "3/09-2026", "0001-01-01", "1/1/0100",
];

function fechaAlAzar(): string {
  const d = 1 + entero(33) - (moneda(0.05) ? 1 : 0);
  const m = 1 + entero(13) - (moneda(0.05) ? 1 : 0);
  const a = elegir([entero(100), 1900 + entero(200), 2000 + entero(30), entero(10000)]);
  const sep = elegir(["/", "-", "/", "."]);
  const pad = (n: number, w: number) => (moneda(0.5) ? String(n).padStart(w, "0") : String(n));
  if (moneda(0.25)) return `${pad(a, 4)}-${pad(m, 2)}-${pad(d, 2)}${moneda(0.2) ? "T03:00:00.000Z" : ""}`;
  return `${pad(d, 2)}${sep}${pad(m, 2)}${sep}${a}${moneda(0.1) ? " 12:00" : ""}`;
}

function opcionAlAzar(opciones: { valor: string; etiqueta: string; alias: string[] }[]): string {
  const o = elegir(opciones);
  switch (entero(6)) {
    case 0:
      return elegir(o.alias);
    case 1:
      return o.etiqueta;
    case 2:
      return o.valor;
    case 3:
      return variarEncabezado(elegir(o.alias));
    case 4:
      return elegir(["Resp. Inscripto", "Monotrib.", "Metros cuadrados", "M2", "xx", "IVA Responsable Inscripto", "Consumidor Final", "Metro", "Mts. lineales", "Kilos", "Gremio", "Empresa constructora", "R.I.", "C.F."]);
    default:
      return elegir(["", "?", "otro", "0", "1", "5", "metros cuadrados lineales"]);
  }
}

function celda(campo: { tipo: string; opciones?: { valor: string; etiqueta: string; alias: string[] }[] }, dv: (d: string) => number | null): string {
  if (moneda(0.08)) return elegir(["", " ", "basura", "N/A"]);
  switch (campo.tipo) {
    case "numero":
    case "entero":
      return moneda(0.5) ? elegir(NUMEROS) : numeroAlAzar();
    case "cuit":
      return moneda(0.7) ? cuitAlAzar(dv) : elegir(CUITS);
    case "email":
      return moneda(0.5) ? elegir(CORREOS) : `${elegir(["juan", "Ventas", "x.y", "ana"])}${elegir(["@", "@", " at "])}${elegir(["mail.com", "MAIL.COM.AR", "x"])}`;
    case "fecha":
      return moneda(0.4) ? elegir(FECHAS) : fechaAlAzar();
    case "opcion":
      return opcionAlAzar(campo.opciones ?? []);
    default:
      return moneda(0.5) ? elegir(TEXTOS) : `${elegir(["MIG", "A", "X", ""])}-${entero(500)}`;
  }
}

/* -------------------------------------------------------------------------- */
/* El .xlsx (un ZIP a mano, como en scripts/golden/planilla.ts)               */
/* -------------------------------------------------------------------------- */

function zip(entradas: { nombre: string; datos: string; metodo: number }[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entradas) {
    const datos = Buffer.from(e.datos, "utf8");
    const comprimido = e.metodo === 0 ? datos : deflateRawSync(datos);
    const nombre = Buffer.from(e.nombre, "utf8");
    const crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(e.metodo, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    partes.push(local, nombre, comprimido);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(e.metodo, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comprimido.length, 20);
    c.writeUInt32LE(datos.length, 24);
    c.writeUInt16LE(nombre.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nombre);
    offset += 30 + nombre.length + comprimido.length;
  }
  const directorio = Buffer.concat(central);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entradas.length, 8);
  fin.writeUInt16LE(entradas.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, directorio, fin]);
}

const DECLARACION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const xml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Una celda: un texto va a la tabla compartida, un número queda como número
 * y `{ fecha: serie }` lleva el estilo de fecha (dd/mm/yyyy).
 */
type Celda = string | number | { fecha: number } | null;

function xlsx(hoja: string, filas: Celda[][], metodo = 8): Buffer {
  const compartidos: string[] = [];
  const indice = new Map<string, number>();
  const letra = (i: number) => String.fromCharCode(65 + i);
  const filasXml = filas
    .map((fila, r) => {
      const celdas = fila
        .map((c, i) => {
          const ref = `${letra(i)}${r + 1}`;
          if (c === null || c === "") return "";
          if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
          if (typeof c === "object") return `<c r="${ref}" s="1"><v>${c.fecha}</v></c>`;
          if (!indice.has(c)) {
            indice.set(c, compartidos.length);
            compartidos.push(c);
          }
          return `<c r="${ref}" t="s"><v>${indice.get(c)}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${celdas}</row>`;
    })
    .join("");
  return zip(
    [
      {
        nombre: "[Content_Types].xml",
        datos: `${DECLARACION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
      },
      { nombre: "xl/workbook.xml", datos: `${DECLARACION}<workbook ${NS}><sheets><sheet name="${hoja}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { nombre: "xl/worksheets/sheet1.xml", datos: `${DECLARACION}<worksheet ${NS}><sheetData>${filasXml}</sheetData></worksheet>` },
      {
        nombre: "xl/sharedStrings.xml",
        datos: `${DECLARACION}<sst ${NS} count="${compartidos.length}" uniqueCount="${compartidos.length}">${compartidos.map((t) => `<si><t>${xml(t)}</t></si>`).join("")}</sst>`,
      },
      {
        nombre: "xl/styles.xml",
        datos: `${DECLARACION}<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>`,
      },
    ].map((e) => ({ ...e, metodo })),
  );
}

/** Windows-1252 (lo que no entra, como "?"). */
function cp1252(texto: string): Buffer {
  const decodificador = new TextDecoder("windows-1252");
  const tabla = new Map<string, number>();
  for (let b = 0; b < 256; b++) tabla.set(decodificador.decode(new Uint8Array([b])), b);
  return Buffer.from([...texto].map((c) => tabla.get(c) ?? 0x3f));
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const utf8 = (t: string, bom = false) => Buffer.concat([bom ? BOM : Buffer.alloc(0), Buffer.from(t, "utf8")]);

/** Excel: el número de serie de una fecha (el 1/1/1900 es 1, con el 29/2/1900 que no existió). */
const serie = (a: number, m: number, d: number) => Date.UTC(a, m - 1, d) / 86400000 + 25569;

/* -------------------------------------------------------------------------- */
/* Las exportaciones de muestra                                                */
/* -------------------------------------------------------------------------- */

function muestras(): { archivo: string; entidad: ClaveEntidad; datos: Buffer }[] {
  const crlf = (filas: string[]) => filas.join("\r\n") + "\r\n";
  return [
    {
      archivo: "clientes-isis.csv",
      entidad: "clientes",
      // Lo que sale de la grilla de Clientes exportada y guardada como CSV
      // por un Excel en castellano: punto y coma, Windows-1252, CRLF.
      datos: cp1252(
        crlf([
          "Código;Razón Social;Nombre Fantasía;C.U.I.T.;Condición IVA;Domicilio;Localidad;Teléfono;E-mail;Límite Crédito;Vendedor;Observaciones",
          '00012;Pérez Juan Carlos;;20-12345678-6;Consumidor Final;"Alem 3400\r\nPiso 2";Mar del Plata;223 155-1234;JUAN@MAIL.COM;"1.500.000,00";Pablo;',
          "00013;Construcciones Ñandú SRL;Ñandú;30-71234567-1;Resp. Inscripto;Colón 1200;Batán;;compras@nandu.com.ar;(1.000,00);Pablo;Paga a 30 días",
          "00014;;Sin nombre;20-11111111-1;Monotributo;;;;;0;;",
          "00015;Gómez, Ana;;27-2345678-9;CF;San Martín 99;;;ana@;;;",
          "00016;Carpintería El Roble;;30-70000000-0;Exento;;;;;$ 50.000;María;gremio",
          ";López María;;;;;;;;;;sin código ni cuit",
          "00012;Pérez Juan Carlos;;20-12345678-6;Consumidor Final;Alem 3400;Mar del Plata;;;;;repetido",
          "00017;Muñoz Hnos.;;23-30123456-9;Responsable Inscripto;Independencia 2500;;;;2.500,50;;",
        ]),
      ),
    },
    {
      archivo: "clientes-utf8.csv",
      entidad: "clientes",
      datos: utf8(
        [
          "Nro Cliente,Apellido y Nombre,CUIT,Cond. IVA,Tipo Cliente,Mail,Tel,Direccion,Limite",
          '101,"Fernández, Pedro",20-28345678-1,RI,Gremio,pedro@x.com,,"Rivadavia 1, 2do B",100000',
          '102,"Arq. Sosa, Laura",27-31234567-0,Monotributista,Arquitecto,LAURA@SOSA.COM.AR,,,"1.234,5"',
          "103,Cliente de mostrador,,Consumidor final,,,,,",
          '104,"Con ""comillas"" adentro",,cf,particular,no-es-correo,,,',
        ].join("\n") + "\n",
        true,
      ),
    },
    {
      archivo: "clientes-isis.xlsx",
      entidad: "clientes",
      datos: xlsx("Clientes", [
        ["Código", "Razón Social", "CUIT", "Condición IVA", "Límite Crédito", "Observaciones"],
        [12, "Pérez Juan Carlos", "20123456786", "Consumidor Final", 1500000, null],
        [13, "Construcciones Ñandú SRL", 30712345671, "Resp. Inscripto", -1000, "a < b & c"],
        ["00018", "Tres Arroyos SA", "30-50000000-7", "Exento", 0.5, null],
        [null, null, null, null, null, null],
      ]),
    },
    {
      archivo: "articulos-isis.csv",
      entidad: "productos",
      datos: utf8(
        crlf([
          "Cód. Artículo;Descripción;Rubro;Medida;Unidad Medida;Marca;Precio Lista;Precio Profesional;% IVA;Largo;Ancho;Espesor",
          'MIG-PIN-001;Tirante pino;Maderas;2" x 4" x 3.60m;UN;;12.345,67;11.000,00;21;3600;101;50',
          'MIG-PIN-002;Tirante pino;Maderas;2" x 4" x 4.20m;Unidad;;14.400,00;;21;4200;101;50',
          "MIG-MDF-018;Placa MDF;Placas;18mm 1.83 x 2.60;Placa;Faplac;45.000;40.500;10,5;2600;1830;18",
          "MIG-DECK-01;Deck de pino;Deck;;M2;;$ 9.800,00;;21;;;",
          "MIG-ZOC-01;Zócalo;Molduras;7cm;Metro lineal;;1.200,5;0;21;;70;",
          "MIG-SIN-01;;Maderas;;UN;;100;;21;;;",
          "MIG-RAR-01;Pegamento;Ferretería;500g;Kilos;Fortex;abc;;21;;;",
          ";Sin código;Maderas;;UN;;100;;;;;",
          "MIG-IVA-01;Raro;Varios;;Juego;;100;;105;;;",
        ]),
      ),
    },
    {
      archivo: "articulos-isis.xlsx",
      entidad: "productos",
      datos: xlsx("Artículos", [
        ["SKU", "Producto", "Categoría", "Medida", "Unidad", "Precio", "Precio Profesional"],
        ["MIG-X-1", "Machimbre", "Maderas", '1/2" x 4"', "Metros cuadrados", 8500.5, 7600],
        ["MIG-X-2", "Machimbre", "Maderas", '3/4" x 4"', "m2", "9.100,00", null],
        ["MIG-X-3", "Clavo", "Ferretería", null, "kg", 0.125, 0.1],
      ]),
    },
    {
      archivo: "existencias-isis.csv",
      entidad: "stock",
      datos: utf8(
        crlf([
          "Artículo\tDepósito\tExistencia\tStock Mínimo",
          "MIG-PIN-001\tCasa Central\t120\t10",
          "MIG-PIN-002\tcasa central\t3,6\t",
          "MIG-MDF-018\tAserradero\t-4\t2",
          "MIG-DECK-01\t\t50\t",
          "MIG-ZOC-01\tDepósito Norte\t1.500\t100",
          "\tCasa Central\t5\t",
        ]),
      ),
    },
    {
      archivo: "saldos-isis.csv",
      entidad: "saldos",
      datos: cp1252(
        crlf([
          "Cód. Cliente;Razón Social;C.U.I.T.;Saldo Actual;Observaciones",
          "00012;Pérez Juan Carlos;20-12345678-6;$ 12.345,67;",
          "00013;Construcciones Ñandú SRL;;(1.500,00);saldo a favor",
          "00014;Sin ficha;;0,00;",
          ";Solo nombre;;500;",
          "00016;Carpintería El Roble;;abc;",
          ";;30-71234567-1;-200;por cuit",
        ]),
      ),
    },
    {
      archivo: "proveedores-isis.csv",
      entidad: "proveedores",
      datos: cp1252(
        crlf([
          "Código;Proveedor;CUIT;Situación IVA;Correo;Teléfono;Domicilio;Saldo;Observaciones",
          "P001;Aserradero del Sur SA;30-60000000-6;Responsable Inscripto;ventas@sur.com;;Ruta 2 km 40;1.234.567,89;",
          "P002;Herrajes Ñuble;20-30000000-1;Monotributo;;;;;",
          "P003;Pinturas Ya;;Exento;mal correo;;;(500,00);nota de crédito",
          "P004;;;;;;;;sin nombre",
        ]),
      ),
    },
    {
      archivo: "ventas-isis.csv",
      entidad: "ventas_historicas",
      datos: utf8(
        crlf([
          "Nro. Comprobante;Fecha;Cód. Cliente;Cliente;Total;Detalle;Sucursal;Vendedor",
          'FA-0001-00001234;03/09/2026;00012;Pérez Juan Carlos;12.345,67;"Tirante 2x4 x 10\nClavos";Casa Central;Pablo',
          "FA-0001-00001235;3/9/26;;Mostrador;1.000;;Casa Central;",
          "FA-0001-00001236;2026-09-04;00013;Ñandú;(500,00);devolución;;",
          "FA-0001-00001237;31/02/2026;00012;Pérez;100;;;",
          "FA-0001-00001238;ayer;00012;Pérez;100;;;",
          ";04/09/2026;00012;Pérez;100;;;",
          "FA-0001-00001239;05/09/2026 10:30;99999;Cliente dado de baja;abc;;;",
        ]),
      ),
    },
    {
      archivo: "ventas-isis.xlsx",
      entidad: "ventas_historicas",
      datos: xlsx("Ventas", [
        ["Comprobante", "Fecha", "Código Cliente", "Total", "Detalle"],
        ["FA-0002-00000001", { fecha: serie(2026, 9, 3) }, "00012", 12345.67, "con fecha de Excel"],
        ["FA-0002-00000002", { fecha: serie(2024, 2, 29) }, "", 99.9, null],
        ["FA-0002-00000003", "03/09/2026", 13, "1.000,00", null],
        ["FA-0002-00000004", { fecha: serie(1900, 1, 15) }, "", 1, "antes del 1/3/1900"],
      ]),
    },
    {
      archivo: "comprobantes-isis.csv",
      entidad: "comprobantes_historicos",
      datos: utf8(
        crlf([
          "Pto. Vta.;Tipo Comprobante;Número;Fecha Emisión;Cód. Cliente;Razón Social;CUIT;Neto Gravado;IVA;Total;CAE;Vto. CAE",
          "0001;Factura A;00001234;03/09/2026;00013;Construcciones Ñandú SRL;30-71234567-1;10.000,00;2.100,00;12.100,00;76123456789012;13/09/2026",
          "1;Factura B;1235;03/09/2026;00012;Pérez;;;;1.000,00;76123456789013;",
          "1;NC A;12;04/09/2026;;;;(100,00);(21,00);(121,00);;",
          "x;Factura A;1;03/09/2026;;;;;;1;;",
          "2;;1;03/09/2026;;;;;;1;;",
          "3;FA;1;1/1/26;;;;;;1;;fecha mala",
        ]),
      ),
    },
    { archivo: "solo-encabezado.csv", entidad: "clientes", datos: utf8("Código;Nombre\r\n") },
    { archivo: "vacio.csv", entidad: "clientes", datos: Buffer.alloc(0) },
    { archivo: "viejo.xls", entidad: "clientes", datos: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]) },
    { archivo: "roto.xlsx", entidad: "productos", datos: Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(40)]) },
    { archivo: "sin-requeridos.csv", entidad: "productos", datos: utf8("Foo;Bar\r\n1;2\r\n") },
  ];
}

/* -------------------------------------------------------------------------- */

async function main() {
  const m: Entidades = await import("./originales/migracion-entidades");
  const { leerPlanilla } = await import("./originales/planilla");
  const { digitoVerificador } = await import("../../lib/cuit");

  rmSync(DESTINO, { recursive: true, force: true });
  mkdirSync(ARCHIVOS, { recursive: true });
  const escribir = (nombre: string, v: unknown, comprimir = false) => {
    const json = JSON.stringify(v);
    writeFileSync(new URL(nombre, DESTINO), comprimir ? gzipSync(json) : json + "\n");
  };

  escribir("definiciones.json", { lote: m.LOTE, entidades: m.ENTIDADES });

  // Fechas.
  const fechas = [...FECHAS, ...Array.from({ length: 4000 }, fechaAlAzar)].map((texto) => ({
    texto,
    iso: m.interpretarFecha(texto),
  }));
  escribir("fechas.json", fechas);

  // Mapeo automático.
  const columnasAlAzar = (clave: ClaveEntidad): string[] => {
    const def = m.definicionDe(clave);
    const columnas: string[] = [];
    for (const campo of def.campos) {
      if (moneda(0.2)) continue;
      columnas.push(moneda(0.2) ? campo.etiqueta : variarEncabezado(elegir(campo.alias)));
    }
    for (let i = entero(4); i > 0; i--) columnas.push(elegir(COLUMNAS_DE_MAS));
    // Mezclar.
    for (let i = columnas.length - 1; i > 0; i--) {
      const j = entero(i + 1);
      [columnas[i], columnas[j]] = [columnas[j], columnas[i]];
    }
    return columnas;
  };
  const claves = m.ENTIDADES.map((e) => e.clave);
  const automapeo = Array.from({ length: 3000 }, () => {
    const entidad = elegir(claves);
    const columnas = columnasAlAzar(entidad);
    const mapeo = m.automapear(m.definicionDe(entidad), columnas);
    return { entidad, columnas, mapeo, faltantes: m.faltantes(m.definicionDe(entidad), mapeo) };
  });
  escribir("automapeo.json.gz", automapeo, true);

  // Filas: normalizar y la vista previa.
  const filas = Array.from({ length: 2000 }, () => {
    const entidad = elegir(claves);
    const def = m.definicionDe(entidad);
    const columnas = columnasAlAzar(entidad);
    const mapeo = m.automapear(def, columnas);
    // A veces el mapeo se corrige a mano, bien o mal.
    if (moneda(0.3)) {
      const campo = elegir(def.campos);
      mapeo[campo.clave] = elegir([-1, entero(columnas.length + 3), 0]);
    }
    const porColumna = columnas.map(() => elegir(def.campos));
    const cuantas = elegir([0, 1, 3, 8, 20, 40]);
    const cuerpo = Array.from({ length: cuantas }, () => {
      const fila = porColumna.map((campo) => celda(campo, digitoVerificador));
      // Filas cortas, como las deja un CSV con los ; del final de menos.
      if (moneda(0.1)) fila.length = entero(fila.length + 1);
      return fila;
    });
    // Que cada campo mapeado reciba su tipo de dato la mayoría de las veces.
    for (const campo of def.campos) {
      const i = mapeo[campo.clave];
      if (i >= 0 && i < columnas.length) for (const fila of cuerpo) if (i < fila.length && moneda(0.8)) fila[i] = celda(campo, digitoVerificador);
    }
    return {
      entidad,
      mapeo,
      filas: cuerpo,
      normalizadas: m.normalizarFilas(def, mapeo, cuerpo),
      previa: previsualizar(m, entidad, mapeo, cuerpo),
    };
  });
  escribir("filas.json.gz", filas, true);

  // Archivos de muestra: lo que contesta el análisis y la vista previa con el
  // mapeo propuesto.
  const archivos = muestras().map(({ archivo, entidad, datos }) => {
    writeFileSync(new URL(archivo, ARCHIVOS), datos);
    const analisis = analizar(m, leerPlanilla, entidad, archivo, datos);
    const previa = analisis.error ? null : previsualizar(m, entidad, analisis.mapeo!, analisis.filas!);
    const normalizadas = analisis.error ? null : m.normalizarFilas(m.definicionDe(entidad), analisis.mapeo!, analisis.filas!);
    return { archivo, entidad, analisis, previa, normalizadas };
  });
  escribir("archivos.json", archivos);

  escribir("topes.json", [100_001, 123_456, 1_000_000, 2_000_000_000].map((n) => ({ filas: n, error: demasiadas(n) })));

  // Controles del informe.
  const informe = Array.from({ length: 800 }, () => {
    const entidad = elegir(claves);
    const caso = elegir(filas.filter((f) => f.entidad === entidad)) ?? filas[0];
    const base: EnLaBase = {
      total: elegir(["0", "12345.67", "-1500.00", "0.01", String(Math.round(azar() * 1e9) / 100), "999999999999.99"]),
      cuantos: entero(200),
      fichas: entero(200),
      totalStock: elegir([0, 120, 3.6, entero(100000) / 1000, -4]),
    };
    return { entidad: caso.entidad, normalizadas: caso.normalizadas, base, controles: controles(caso.entidad, caso.normalizadas, base) };
  });
  escribir("controles.json.gz", informe, true);

  console.log(
    `migración: ${fechas.length} fechas, ${automapeo.length} mapeos, ${filas.length} archivos al azar (${filas.reduce((s, f) => s + f.filas.length, 0)} filas), ${archivos.length} muestras, ${informe.length} informes`,
  );
}

main();
