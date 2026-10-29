/**
 * Golden de la caja del panel, el cierre del mes y los reportes (tanda 5,
 * parte D): lo puro corrido en el TypeScript real, para que el Go
 * (internal/reportes, internal/caja) dé lo mismo, exacto.
 *
 * - La reposición (lib/reposicion.ts, hoy en originales/) y el armado del
 *   reporte (copia de lib/dal/admin/reposicion.ts, commit 295d7f2): el orden,
 *   lo vendido por categoría y el CSV (app/admin/reportes/reposicion/exportar).
 * - Los asientos (lib/contable/asientos.ts, hoy en originales/) y su CSV
 *   (app/admin/cierre/exportar, en UTC como Next), con nombreComprobante.
 * - El CSV del reporte de ventas (app/admin/reportes/exportar).
 * - Los períodos (lib/periodos.ts), la serie mes a mes de ventasPorMes, los
 *   meses del gráfico del resumen y la variación (lib/dal/admin/resumen.ts).
 * - La etiqueta de los turnos (app/admin/caja/page.tsx) y los esquemas de
 *   zod de las acciones de la caja (app/admin/caja/actions.ts).
 *
 *   npx tsx scripts/golden/reportes.ts
 *
 * El script fija la zona él mismo: hora argentina para lo que en Go va en
 * hora argentina («este mes», la serie, la etiqueta del turno), y UTC para el
 * cierre del mes (que Go deja en UTC a propósito: ver internal/reportes).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { diasDeCobertura, sugerenciaDeCompra, ventaDiaria } from "./originales/reposicion";
import {
  asientoDeCobro,
  asientoDeCompra,
  asientoDeGasto,
  asientoDePagoAProveedor,
  asientoDeVenta,
  balancea,
  type Asiento,
} from "./originales/asientos";
import { armarCsv, fechaCsv, numeroCsv, textoCsv } from "../../lib/csv-excel";
import { leerPeriodo, leerPeriodoMensual, resolverPeriodo, type ClavePeriodo, type Periodo } from "../../lib/periodos";
import { nombreComprobante, numeroFormateado, type TipoComprobante } from "../../lib/fiscal/comprobantes";
import { plural } from "../../lib/formato";
import { etiquetaDeRubro } from "../../lib/rubros-cliente";
import { CORTES, leerCorte, type CorteDelReporte } from "../../lib/reportes-cortes";

const ART = "America/Argentina/Buenos_Aires";
process.env.TZ = ART;
if (new Date("2026-01-01T12:00:00Z").getTimezoneOffset() !== 180) throw new Error("No tomó la zona");

let semilla = 20261029;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
  return semilla / 2 ** 31;
};
const entero = (n: number) => Math.floor(azar() * n);
const elegir = <T>(xs: readonly T[]): T => xs[entero(xs.length)];
const plata = () => {
  const r = azar();
  if (r < 0.05) return 0;
  if (r < 0.4) return Math.round(azar() * 100000) / 100;
  if (r < 0.8) return Math.round(azar() * 10000000) / 100;
  return Math.round(azar() * 1e9) / 100;
};
const cantidad = () => (azar() < 0.2 ? entero(5) : Math.round(azar() * (azar() < 0.5 ? 50 : 5000) * 1000) / 1000);
const instante = () => new Date(Date.UTC(2024, 0, 1) + Math.floor(azar() * 4 * 365 * 86400000));
const texto = () =>
  elegir(["Fenólico", "MDF 18", 'Tabla 1" x 6"', "Pino; cepillado", "Con\nsalto", "Melamínica blanca", "", "Ñandubay 🌳", "Placa \"premium\""]);

// --- la reposición ---

const reposicionPura: unknown[] = [];
const casosVitest = [
  [30, 60, 30, 30],
  [30, 0, 30, 30],
  [500, 60, 30, 30],
  [0, 15, 30, 7],
  [-10, 30, 30, 30],
];
for (let i = 0; i < 4000; i++) {
  const [disponible, vendido, dias, objetivo] =
    i < casosVitest.length
      ? casosVitest[i]
      : [
          azar() < 0.1 ? -cantidad() : cantidad(),
          azar() < 0.15 ? 0 : cantidad(),
          elegir([30, 60, 90, 0, -1, 7, 45]),
          elegir([7, 30, 45, 90, 180, 0, 13]),
        ];
  const datos = { disponible, vendido, diasDelPeriodo: dias };
  reposicionPura.push({
    disponible,
    vendido,
    dias,
    objetivo,
    ventaDiaria: ventaDiaria(vendido, dias),
    cobertura: diasDeCobertura(datos),
    sugerido: sugerenciaDeCompra(datos, objetivo),
  });
}

/** Copia textual del armado de reporteDeReposicion (lib/dal/admin/reposicion.ts, commit 295d7f2). */
function armarReposicion(
  stock: {
    variantId: string;
    productId: string;
    producto: string;
    medida: string;
    sku: string | null;
    unidad: string;
    categoria: string;
    categoriaSlug: string;
    rubro: string | null;
    disponibleCentral: number;
    disponibleAserradero: number;
  }[],
  vendidoPorVariante: Map<string, number>,
  opciones: { diasDelPeriodo: number; coberturaObjetivo: number; sucursal?: string },
) {
  const filas = stock
    .map((s) => {
      const disponible =
        opciones.sucursal === "casa-central"
          ? s.disponibleCentral
          : opciones.sucursal === "aserradero"
            ? s.disponibleAserradero
            : s.disponibleCentral + s.disponibleAserradero;
      const vendido = vendidoPorVariante.get(s.variantId) ?? 0;
      const datos = {
        disponible,
        vendido,
        diasDelPeriodo: opciones.diasDelPeriodo,
      };

      return {
        variantId: s.variantId,
        productId: s.productId,
        producto: s.producto,
        medida: s.medida,
        sku: s.sku,
        unidad: s.unidad,
        categoria: s.categoria,
        categoriaSlug: s.categoriaSlug,
        rubro: s.rubro,
        disponibleCentral: s.disponibleCentral,
        disponibleAserradero: s.disponibleAserradero,
        disponible,
        vendido,
        cobertura: diasDeCobertura(datos),
        sugerido: sugerenciaDeCompra(datos, opciones.coberturaObjetivo),
      };
    })
    .sort((a, b) => {
      if ((a.sugerido > 0) !== (b.sugerido > 0)) return a.sugerido > 0 ? -1 : 1;
      if (a.sugerido > 0 && b.sugerido > 0) {
        return (a.cobertura ?? 0) - (b.cobertura ?? 0);
      }
      return b.vendido - a.vendido;
    });

  const porCategoria = new Map<string, number>();
  for (const f of filas) {
    porCategoria.set(f.categoria, (porCategoria.get(f.categoria) ?? 0) + f.vendido);
  }

  return {
    filas,
    porCategoria: [...porCategoria.entries()]
      .map(([nombre, vendido]) => ({ nombre, vendido }))
      .filter((c) => c.vendido > 0)
      .sort((a, b) => b.vendido - a.vendido),
    diasDelPeriodo: opciones.diasDelPeriodo,
    coberturaObjetivo: opciones.coberturaObjetivo,
  };
}

/** Copia textual del CSV de app/admin/reportes/reposicion/exportar/route.ts (commit 295d7f2). */
function csvReposicion(reporte: ReturnType<typeof armarReposicion>) {
  const encabezado = [
    "Producto",
    "Medida",
    "Código",
    "Categoría",
    "Rubro",
    "Central",
    "Aserradero",
    "Vendido",
    "Cobertura (días)",
    "Comprar",
  ].join(";");

  const filas = reporte.filas.map((f) =>
    [
      f.producto,
      f.medida,
      f.sku ?? "",
      f.categoria,
      f.rubro ?? "",
      f.disponibleCentral,
      f.disponibleAserradero,
      f.vendido,
      f.cobertura ?? "",
      f.sugerido,
    ]
      .map((v) => {
        const texto = String(v);
        return /[;"\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
      })
      .join(";"),
  );

  return "\ufeff" + [encabezado, ...filas].join("\r\n");
}

const reposiciones: unknown[] = [];
for (let caso = 0; caso < 250; caso++) {
  const categorias = ["Placas", "Tirantes", "Herrajes", "Molduras"].slice(0, 1 + entero(4));
  const stock = Array.from({ length: entero(25) }, (_, i) => ({
    variantId: `v${i}`,
    productId: `p${entero(8)}`,
    producto: texto() || "Producto",
    medida: elegir(["18 mm", "2x4", '1/2"', "3,05 m"]),
    sku: azar() < 0.3 ? null : `SKU-${entero(1000)}`,
    unidad: elegir(["placa", "unidad", "metro"]),
    categoria: elegir(categorias),
    categoriaSlug: "x",
    rubro: azar() < 0.3 ? null : texto(),
    disponibleCentral: azar() < 0.1 ? -cantidad() : cantidad(),
    disponibleAserradero: azar() < 0.1 ? -cantidad() : cantidad(),
  }));
  const vendido = new Map<string, number>();
  for (const s of stock) if (azar() < 0.7) vendido.set(s.variantId, azar() < 0.1 ? 0 : cantidad());
  const opciones = {
    diasDelPeriodo: elegir([30, 60, 90]),
    coberturaObjetivo: elegir([7, 15, 30, 45, 180]),
    sucursal: elegir([undefined, "todos", "casa-central", "aserradero"]),
  };
  const reporte = armarReposicion(stock, vendido, opciones);
  reposiciones.push({
    stock,
    vendido: Object.fromEntries(vendido),
    opciones: { ...opciones, sucursal: opciones.sucursal ?? "" },
    reporte,
    csv: csvReposicion(reporte),
  });
}

// --- los asientos ---

const TIPOS: TipoComprobante[] = [
  "factura_a",
  "factura_b",
  "factura_c",
  "nota_credito_a",
  "nota_credito_b",
  "nota_credito_c",
  "nota_debito_a",
  "nota_debito_b",
  "nota_debito_c",
];
const MEDIOS = ["efectivo", "transferencia", "cheque", "debito", "credito", "mercado_pago"];
const CATEGORIAS = ["flete", "combustible", "servicios", "alquiler", "sueldos", "mantenimiento", "impuestos", "librería", "publicidad", "otro", "varios"];

const asientos: unknown[] = [];
const todos: Asiento[] = [];
for (let i = 0; i < 2500; i++) {
  const fecha = instante();
  const tipo = elegir(TIPOS);
  const comprobante = `${nombreComprobante(tipo)} ${numeroFormateado(entero(20), entero(100000))}`;
  let entrada: Record<string, unknown>;
  let a: Asiento;
  switch (i % 5) {
    case 0: {
      const neto = plata();
      const iva = azar() < 0.2 ? 0 : plata() / 5;
      const tributos = azar() < 0.6 ? 0 : plata() / 50;
      const total = azar() < 0.9 ? neto + iva + tributos : plata();
      entrada = { tipo: "venta", fecha, comprobante, cliente: texto(), neto, iva, tributos, total, esNotaDeCredito: tipo.startsWith("nota_credito") };
      a = asientoDeVenta(entrada as never);
      break;
    }
    case 1:
      entrada = { tipo: "cobro", fecha, comprobante, cliente: texto(), importe: plata(), medio: elegir(MEDIOS) };
      a = asientoDeCobro(entrada as never);
      break;
    case 2: {
      const neto = plata();
      const iva = azar() < 0.2 ? 0 : plata() / 5;
      const percepciones = azar() < 0.6 ? 0 : plata() / 50;
      entrada = {
        tipo: "compra",
        fecha,
        comprobante,
        proveedor: texto(),
        neto,
        iva,
        percepciones,
        total: azar() < 0.9 ? neto + iva + percepciones : plata(),
        daCreditoFiscal: azar() < 0.6,
        esNotaDeCredito: azar() < 0.2,
      };
      a = asientoDeCompra(entrada as never);
      break;
    }
    case 3: {
      const total = plata();
      entrada = {
        tipo: "pago",
        fecha,
        proveedor: texto(),
        referencia: elegir([null, "", "TR 123", "Cheque 4"]),
        total,
        retenido: azar() < 0.5 ? 0 : Math.round(total * azar() * 0.1 * 100) / 100,
        medio: elegir(MEDIOS),
      };
      a = asientoDePagoAProveedor(entrada as never);
      break;
    }
    default:
      entrada = { tipo: "gasto", fecha, descripcion: texto(), categoria: elegir(CATEGORIAS), importe: plata(), medio: elegir(MEDIOS) };
      a = asientoDeGasto(entrada as never);
  }
  todos.push(a);
  asientos.push({ entrada, asiento: a, balancea: balancea(a), nombre: nombreComprobante(tipo), tipoComprobante: tipo });
}

/** Copia textual del CSV de app/admin/cierre/exportar/route.ts (commit 295d7f2). */
function csvAsientos(asientos: Asiento[]) {
  const filas: string[][] = [];
  let totalDebe = 0;
  let totalHaber = 0;

  asientos.forEach((asiento, i) => {
    const numero = String(i + 1).padStart(5, "0");

    for (const r of asiento.renglones) {
      totalDebe += r.debe;
      totalHaber += r.haber;

      filas.push([
        textoCsv(numero),
        fechaCsv(asiento.fecha),
        textoCsv(asiento.concepto),
        textoCsv(r.cuenta),
        textoCsv(r.nombre),
        r.debe === 0 ? "" : numeroCsv(r.debe),
        r.haber === 0 ? "" : numeroCsv(r.haber),
        textoCsv(balancea(asiento) ? "" : "NO CIERRA"),
      ]);
    }
  });

  return armarCsv(
    ["Asiento", "Fecha", "Concepto", "Cuenta", "Nombre de cuenta", "Debe", "Haber", "Observación"],
    filas,
    [
      textoCsv("Totales"),
      "",
      "",
      "",
      "",
      numeroCsv(totalDebe),
      numeroCsv(totalHaber),
      textoCsv(Math.abs(totalDebe - totalHaber) < 0.01 ? "" : "EL PERÍODO NO CIERRA"),
    ],
  );
}

// El cierre del mes corre en UTC, como Next en producción.
process.env.TZ = "UTC";
const csvsDeAsientos: unknown[] = [];
for (let caso = 0; caso < 200; caso++) {
  const desde = entero(todos.length);
  const lista = todos.slice(desde, desde + entero(40));
  // Un asiento roto a mano, para ver el «NO CIERRA».
  if (caso % 10 === 0 && lista.length > 0) {
    lista[0] = { ...lista[0], renglones: [...lista[0].renglones, { cuenta: "9.9.99", nombre: "9.9.99", debe: 1.5, haber: 0 }] };
  }
  csvsDeAsientos.push({ asientos: lista.map((a) => ({ ...a, balancea: balancea(a) })), csv: csvAsientos(lista) });
}
const mensualesUTC: unknown[] = [];
const valoresDePeriodo = ["", "2026-03", "2026-13", "2026-0", "abc", "2025-12", "1999-02", "2026-02-15", "2028-2", " 2026-04", "2026-1x"];
for (let i = 0; i < 600; i++) {
  const ahora = instante();
  const valor = i < valoresDePeriodo.length ? valoresDePeriodo[i] : elegir(valoresDePeriodo);
  const p = leerPeriodoMensual(valor, ahora);
  mensualesUTC.push({ valor, ahora, ...p });
}
process.env.TZ = ART;

// --- el reporte de ventas ---

/** Copia textual del CSV de app/admin/reportes/exportar/route.ts (commit 295d7f2). */
function csvReporte(
  corte: CorteDelReporte,
  filas: {
    etiqueta: string;
    detalle: string | null;
    cantidad: number;
    total: number;
    netoVenta: number;
    costo: number | null;
    lineasSinCosto: number;
  }[],
) {
  const etiquetaCorte = CORTES.find((c) => c.clave === corte)?.etiqueta ?? "Por producto";
  const numero = (valor: number) => valor.toFixed(2).replace(".", ",");
  const texto = (valor: string | null) => `"${(valor ?? "").replace(/"/g, '""')}"`;

  const sinPrefijo = etiquetaCorte.replace("Por ", "");
  const encabezado = sinPrefijo.charAt(0).toUpperCase() + sinPrefijo.slice(1);

  const entero = (valor: number) => String(Math.round(valor));
  const cantidad = corte === "producto" ? numero : entero;

  const lineas = [
    [
      texto(encabezado),
      texto("Detalle"),
      texto(corte === "producto" ? "Unidades" : "Operaciones"),
      texto("Total"),
      texto("Neto sin IVA"),
      texto("Costo"),
      texto("Margen"),
      texto("Renglones sin costo"),
    ].join(";"),
    ...filas.map((f) =>
      [
        texto(f.etiqueta),
        texto(f.detalle),
        cantidad(f.cantidad),
        numero(f.total),
        numero(f.netoVenta),
        f.costo === null ? "" : numero(f.costo),
        f.costo === null ? "" : numero(f.netoVenta - f.costo),
        entero(f.lineasSinCosto),
      ].join(";"),
    ),
  ];

  const total = filas.reduce((suma, f) => suma + f.total, 0);
  const costeado = filas.filter((f) => f.costo !== null);
  const netoTotal = costeado.reduce((s, f) => s + f.netoVenta, 0);
  const costoTotal = costeado.reduce((s, f) => s + (f.costo ?? 0), 0);
  const sinCosto = filas.reduce((s, f) => s + f.lineasSinCosto, 0);

  lineas.push(
    [
      texto("Total"),
      texto(""),
      texto(""),
      numero(total),
      numero(netoTotal),
      costeado.length === 0 ? "" : numero(costoTotal),
      costeado.length === 0 ? "" : numero(netoTotal - costoTotal),
      entero(sinCosto),
    ].join(";"),
  );

  return `\ufeff${lineas.join("\r\n")}\r\n`;
}

const reportes: unknown[] = [];
for (let caso = 0; caso < 600; caso++) {
  const corte = caso < 7 ? CORTES[caso].clave : elegir([...CORTES.map((c) => c.clave), "otro" as CorteDelReporte]);
  const filas = Array.from({ length: entero(30) }, (_, i) => {
    const total = plata();
    const netoVenta = total / elegir([1.21, 1.105, 1]);
    return {
      clave: `c${i}`,
      etiqueta: texto() || "x",
      detalle: azar() < 0.4 ? null : texto(),
      cantidad: corte === "producto" ? cantidad() : 1 + entero(80),
      total,
      netoVenta,
      costo: azar() < 0.3 ? null : netoVenta * azar() * 1.2,
      lineasSinCosto: entero(4),
    };
  });
  reportes.push({ corte, leido: leerCorte(corte), filas, csv: csvReporte(leerCorte(corte), filas) });
}

const cortes = ["producto", "rubro", "x", "", "canal", "Por producto"].map((v) => ({ valor: v, corte: leerCorte(v) }));
const plurales = [0, 1, 2, 1.5, 10, 100].map((n) => ({ n, texto: plural(n, "producto") }));
const rubros = ["", "particular", "woodframer", "disenador", "instalador", "todos", "inventado"].map((v) => ({
  valor: v,
  etiqueta: etiquetaDeRubro(v || null),
}));

// --- los períodos y las series (hora argentina) ---

const PERIODOS_CLAVES = ["mes", "mes-pasado", "trimestre", "anio", "todo", "raro"];
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const periodos: unknown[] = [];
for (let i = 0; i < 2000; i++) {
  const ahora =
    i % 7 === 0
      ? new Date(Date.UTC(2026, entero(12), 1, 2 + entero(2), entero(60))) // la noche del 1.º en la Argentina
      : instante();
  const clave = leerPeriodo(elegir(PERIODOS_CLAVES)) as ClavePeriodo;
  const p = resolverPeriodo(clave, ahora);
  periodos.push({
    ahora,
    clave,
    etiqueta: p.etiqueta,
    desde: iso(p.desde),
    hasta: iso(p.hasta),
    anteriorDesde: iso(p.anterior?.desde),
    anteriorHasta: iso(p.anterior?.hasta),
  });
}
const mensualesART: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const ahora = instante();
  const valor = elegir(valoresDePeriodo);
  const p = leerPeriodoMensual(valor, ahora);
  mensualesART.push({ valor, ahora, ...p });
}

/** Copia textual de la serie de ventasPorMes (lib/dal/admin/reportes.ts, commit 295d7f2), con `ahora` en vez de new Date(). */
function serieDeMeses(periodo: Periodo, porMes: Map<string, number>, ahora: Date, meses = 6) {
  const hasta = periodo.hasta ?? ahora;
  const desde = periodo.desde ?? new Date(hasta.getFullYear(), hasta.getMonth() - (meses - 1), 1);

  const serie: { clave: string; etiqueta: string; total: number }[] = [];
  const cursor = new Date(desde.getFullYear(), desde.getMonth(), 1);

  while (cursor <= hasta && serie.length < 24) {
    const clave = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;

    serie.push({
      clave,
      etiqueta: cursor.toLocaleDateString("es-AR", { month: "short" }),
      total: porMes.get(clave) ?? 0,
    });

    cursor.setMonth(cursor.getMonth() + 1);
  }

  return serie;
}
const series: unknown[] = [];
for (let i = 0; i < 1000; i++) {
  const ahora = i % 5 === 0 ? new Date(Date.UTC(2026, entero(12), 1, 2, 30)) : instante();
  const clave = elegir(PERIODOS_CLAVES.slice(0, 5)) as ClavePeriodo;
  const periodo = resolverPeriodo(clave, ahora);
  const porMes = new Map<string, number>();
  for (let k = 0; k < 30; k++) {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - entero(30), 1);
    porMes.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, plata());
  }
  const meses = elegir([6, 6, 6, 1, 12]);
  series.push({
    ahora,
    clave,
    meses,
    desde: iso(periodo.desde),
    hasta: iso(periodo.hasta),
    porMes: Object.fromEntries(porMes),
    serie: serieDeMeses(periodo, porMes, ahora, meses),
  });
}

/** Copia de inicioDeMes y de los meses de ventasPorSucursal (lib/dal/admin/resumen.ts, commit 295d7f2), con `ahora`. */
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function inicioDeMes(ahora: Date, atras = 0) {
  const fecha = new Date(ahora);
  fecha.setMonth(fecha.getMonth() - atras, 1);
  fecha.setHours(0, 0, 0, 0);
  return fecha;
}
const mesesDelResumen: unknown[] = [];
for (let i = 0; i < 500; i++) {
  const ahora = i % 4 === 0 ? new Date(Date.UTC(2026, entero(12), 1, 1, 30)) : instante();
  const meses = [];
  for (let k = 5; k >= 0; k--) {
    const fecha = inicioDeMes(ahora, k);
    meses.push({
      clave: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`,
      mes: MESES[fecha.getMonth()],
      desde: fecha.toISOString(),
    });
  }
  mesesDelResumen.push({ ahora, meses });
}
const variaciones: unknown[] = [];
for (let i = 0; i < 2000; i++) {
  const actual = azar() < 0.1 ? 0 : plata();
  const previo = azar() < 0.15 ? 0 : plata();
  variaciones.push({
    actual,
    previo,
    variacion: previo > 0 ? Math.round(((actual - previo) / previo) * 1000) / 10 : null,
  });
}

// --- la caja ---

/** Copia textual de la etiqueta del turno (app/admin/caja/page.tsx, commit 295d7f2). */
const etiquetaDeTurno = (t: { abiertaAt: Date; estado: string }) =>
  new Date(t.abiertaAt).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
  }) +
  " " +
  new Date(t.abiertaAt).toLocaleTimeString("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  }) +
  (t.estado === "abierta" ? " (abierto)" : "");
const turnos: unknown[] = [];
for (let i = 0; i < 1000; i++) {
  const t = { abiertaAt: instante(), estado: elegir(["abierta", "cerrada"]) };
  turnos.push({ ...t, etiqueta: etiquetaDeTurno(t) });
}

/** Copia textual de altaSchema (app/admin/caja/actions.ts, commit 295d7f2). */
const altaSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(2, "El código es muy corto.")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Usá solo letras, números y guiones."),
  nombre: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : null)),
  branchId: z.string().uuid("Elegí la sucursal."),
});
const fondoSchema = z.object({
  branchId: z.string().uuid(),
  monto: z.coerce.number().min(0).max(10_000_000),
});
const UUID = "3f1c2a9e-5b7d-4e2f-9a1b-0c3d4e5f6a7b";
const codigos = ["CAJA1", "c1", "x", "  caja-2  ", "CAJA 3", "caja_4", "ÑANDÚ", "A".repeat(20), "A".repeat(21), "", "--", 7, null, undefined];
const nombres = [undefined, "", "  ", "Caja del fondo", "x".repeat(80), "x".repeat(81), null, 3];
const branches = [UUID, "", "no-es", "3f1c2a9e-5b7d-1e2f-9a1b-0c3d4e5f6a7b", "3f1c2a9e-5b7d-4e2f-ca1b-0c3d4e5f6a7b", null, undefined, 12];
const altas: unknown[] = [];
for (let i = 0; i < 1500; i++) {
  const cuerpo: Record<string, unknown> = {};
  const c = elegir(codigos);
  const n = elegir(nombres);
  const b = elegir(branches);
  if (c !== undefined) cuerpo.codigo = c;
  if (n !== undefined) cuerpo.nombre = n;
  if (b !== undefined) cuerpo.branchId = b;
  const r = altaSchema.safeParse(cuerpo);
  altas.push(
    r.success
      ? { cuerpo, ok: true, datos: r.data }
      : { cuerpo, ok: false, campo: r.error.issues[0].path.join("."), mensaje: r.error.issues[0].message },
  );
}
const montos = [0, 1, 1500.5, -1, 10_000_000, 10_000_001, "2500", "", " 3 ", "abc", null, true, "1e3", "-0", 1e-7];
const fondos: unknown[] = [];
for (let i = 0; i < 400; i++) {
  const branchId = elegir([UUID, "", "x"]);
  const monto = elegir(montos);
  const r = fondoSchema.safeParse({ branchId, monto });
  fondos.push({ branchId, monto, ok: r.success, valor: r.success ? r.data.monto : null });
}

const comprobantes = TIPOS.map((t) => ({ tipo: t, nombre: nombreComprobante(t), numero: numeroFormateado(3, 127) }));

const dir = new URL("../../backend/testdata/golden/reportes/", import.meta.url);
mkdirSync(dir, { recursive: true });
const escribir = (nombre: string, v: unknown) => writeFileSync(new URL(nombre, dir), JSON.stringify(v) + "\n");
escribir("reposicion-pura.json", reposicionPura);
escribir("reposiciones.json", reposiciones);
escribir("asientos.json", asientos);
escribir("csv-asientos.json", csvsDeAsientos);
escribir("mensuales-utc.json", mensualesUTC);
escribir("mensuales-art.json", mensualesART);
escribir("reportes.json", reportes);
escribir("varios.json", { cortes, plurales, rubros, comprobantes });
escribir("periodos.json", periodos);
escribir("series.json", series);
escribir("meses-resumen.json", mesesDelResumen);
escribir("variaciones.json", variaciones);
escribir("turnos.json", turnos);
escribir("altas.json", altas);
escribir("fondos.json", fondos);
console.log("listo");
