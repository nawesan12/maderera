/**
 * Golden de compras, proveedores y retenciones (tanda 8): toda la plata del
 * módulo corrida en el TypeScript real, para que el Go (internal/compras) dé
 * lo mismo, bit a bit.
 *
 * - El costo promedio y el prorrateo del flete (lib/compras/costo.ts), y la
 *   cuenta entera de confirmar una recepción (lib/compras/recepcion.ts):
 *   recepciones encadenadas con lo que se guarda en la base (toFixed(4)) y la
 *   deuda con IVA.
 * - Las retenciones (lib/retenciones/calculo.ts) sueltas y en meses enteros
 *   de pagos, con el acumulado como lo suma Postgres, y los controles del
 *   pago (lib/retenciones/pago.ts): imputaciones, partes y cheques.
 * - La lista de precios del proveedor (lib/precios/lista-proveedor.ts).
 * - El libro IVA compras, los CSV (el del libro y el de retenciones), el
 *   saldo corriente del proveedor, las facturas con saldo, el período, el
 *   vencimiento y formatearMonto.
 * - Lo que contestaban los esquemas de zod de cada acción: el primer error o
 *   los datos ya transformados.
 *
 *   TZ=UTC npx tsx scripts/golden/compras.ts
 *
 * Con TZ=UTC porque así corre Next en producción (el contenedor no fija la
 * zona): «el mes» y «la fecha» del TS son los de UTC, y Go hace lo mismo.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { mezclarCosto, prorratearGastos } from "../../lib/compras/costo";
import { calcularRetencion, type RegimenDeRetencion } from "../../lib/retenciones/calculo";
import { leerListaDeProveedor } from "../../lib/precios/lista-proveedor";
import { agregarIva } from "../../lib/fiscal/impuestos";
import { normalizarNumeroDeCheque, revisarNumeroDeCheque } from "../../lib/cheques/numero";
import { armarCsv, fechaCsv, numeroCsv, textoCsv } from "../../lib/csv-excel";
import { leerPeriodoMensual } from "../../lib/periodos";
import { formatearMonto } from "../../lib/formato";
import { daCreditoFiscal, nombreComprobanteCompra, numeroDeCompra } from "../../lib/fiscal/comprobantes-compra";
import { cantidadDeStock } from "../../lib/unidades";

if (new Date().getTimezoneOffset() !== 0) throw new Error("Correlo con TZ=UTC");

let semilla = 20261029;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
  return semilla / 2 ** 31;
};
const entero = (n: number) => Math.floor(azar() * n);
const elegir = <T>(xs: readonly T[]): T => xs[entero(xs.length)];
const num = (x: number) => (Number.isNaN(x) ? "NaN" : x === Infinity ? "Inf" : x === -Infinity ? "-Inf" : x);
/** Lo que vuelve de la base: el número guardado con toFixed y leído con Number. */
const guardado = (x: number, d: number) => Number(x.toFixed(d));
/** Centavos exactos de un texto con dos decimales (lo que suma Postgres). */
const centavos = (t: string) => {
  const neg = t.startsWith("-");
  const [e, d = ""] = (neg ? t.slice(1) : t).split(".");
  const c = Number(e) * 100 + Number((d + "00").slice(0, 2));
  return neg ? -c : c;
};
const deCentavos = (c: number) => {
  const neg = c < 0;
  const a = Math.abs(c);
  return Number(`${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`);
};
const plata = () => {
  const r = azar();
  if (r < 0.05) return 0;
  if (r < 0.4) return Math.round(azar() * 100000) / 100;
  if (r < 0.8) return Math.round(azar() * 10000000) / 100;
  return Math.round(azar() * 1e9) / 100;
};

// --- el costo ---

const costos: unknown[] = [];
const raros = [NaN, -1, 0, Infinity];
for (let i = 0; i < 3000; i++) {
  const actual = {
    cantidadBase: i % 13 === 0 ? -entero(10) : i % 7 === 0 ? 0 : Math.round(azar() * 1e6) / 1e4 * (i % 3 === 0 ? 100 : 1),
    costoPromedio: guardado(azar() * 50000, 4),
  };
  const cantidad = i % 17 === 0 ? elegir(raros) : Math.round(azar() * 1e7) / 1e4;
  const costoUnitario = i % 19 === 0 ? elegir(raros) : guardado(azar() * (i % 2 ? 1000 : 100000), 4);
  const r = mezclarCosto(actual, { cantidad, costoUnitario });
  costos.push({ actual, cantidad: num(cantidad), costoUnitario: num(costoUnitario), cantidadBase: r.cantidadBase, costoPromedio: r.costoPromedio });
}

const prorrateos: unknown[] = [];
for (let i = 0; i < 3000; i++) {
  const n = entero(7);
  const lineas = Array.from({ length: n }, () => ({
    cantidad: i % 11 === 0 ? 0 : guardado(azar() * (azar() < 0.5 ? 10 : 500), 4),
    costoUnitario: i % 9 === 0 ? 0 : guardado(azar() * 30000, 4),
  }));
  if (i % 23 === 0 && n > 1) lineas[1] = { ...lineas[0] };
  const gastos = i % 29 === 0 ? elegir([NaN, -5, 0]) : guardado(azar() * 200000, 2);
  prorrateos.push({ lineas, gastos: num(gastos), costoConGastos: prorratearGastos(lineas, gastos).map((l) => l.costoConGastos) });
}

// --- confirmar recepciones encadenadas (copia de la cuenta de confirmarRecepcion, git 9a17128) ---

const recepciones: unknown[] = [];
for (let caso = 0; caso < 300; caso++) {
  const estado = new Map<string, { cantidadBase: string; costoPromedio: string }>();
  const variantes = ["a", "b", "c"];
  if (caso % 4 === 0) estado.set("a", { cantidadBase: (-entero(5)).toFixed(4), costoPromedio: (azar() * 1000).toFixed(4) });
  const inicial = Object.fromEntries(estado.entries());
  const pasos: unknown[] = [];
  for (let k = 0; k < 1 + entero(6); k++) {
    const items = Array.from({ length: 1 + entero(4) }, () => ({
      variantId: elegir(variantes),
      cantidad: (azar() < 0.1 ? 0.0001 + entero(3) : azar() * (azar() < 0.5 ? 20 : 400)).toFixed(4),
      costoUnitario: (azar() < 0.05 ? 0 : azar() * 40000).toFixed(4),
      alicuotaIva: elegir(["21.00", "10.50", "0.00", "27.00"]),
    }));
    const gastos = (azar() < 0.3 ? 0 : azar() * 150000).toFixed(2);
    const conGastos = prorratearGastos(
      items.map((i, idx) => ({ id: String(idx), variantId: i.variantId, alicuotaIva: i.alicuotaIva, cantidad: Number(i.cantidad), costoUnitario: Number(i.costoUnitario) })),
      Number(gastos),
    );
    let neto = Number(gastos);
    const lineas: unknown[] = [];
    for (const linea of conGastos) {
      neto += linea.cantidad * linea.costoUnitario;
      const previo = estado.get(linea.variantId);
      const estadoPrevio = { cantidadBase: Number(previo?.cantidadBase ?? 0), costoPromedio: Number(previo?.costoPromedio ?? 0) };
      const nuevo = mezclarCosto(estadoPrevio, { cantidad: linea.cantidad, costoUnitario: linea.costoConGastos });
      estado.set(linea.variantId, { cantidadBase: nuevo.cantidadBase.toFixed(4), costoPromedio: nuevo.costoPromedio.toFixed(4) });
      lineas.push({
        costoConGastos: linea.costoConGastos.toFixed(4),
        cantidadAnterior: estadoPrevio.cantidadBase.toFixed(4),
        costoAnterior: estadoPrevio.costoPromedio.toFixed(4),
        costoResultante: nuevo.costoPromedio.toFixed(4),
        cantidadNueva: nuevo.cantidadBase.toFixed(4),
        unidades: cantidadDeStock(linea.cantidad),
      });
    }
    const conIva = conGastos.reduce((t, l) => t + agregarIva(l.cantidad * l.costoConGastos, Number(l.alicuotaIva)), 0);
    pasos.push({ items, gastos, lineas, deuda: conIva.toFixed(2), neto: neto.toFixed(2), netoNumero: neto });
  }
  recepciones.push({ inicial, pasos });
}

// --- retenciones ---

const regimenAlAzar = (): RegimenDeRetencion => ({
  codigo: "X",
  nombre: "X",
  impuesto: elegir(["ganancias", "iva", "suss", "iibb"] as const),
  alicuota: guardado(elegir([0, 0.5, 1.5, 2, 3, 6, 28, azar() * 10]), 3),
  alicuotaNoInscripto: guardado(elegir([0, 3, 6, 28, azar() * 30]), 3),
  minimoNoImponible: guardado(elegir([0, 0, 67170, 224000, azar() * 300000]), 2),
  minimoRetencion: guardado(elegir([0, 0, 21000, 400, azar() * 5000]), 2),
});
const retenciones: unknown[] = [];
for (let i = 0; i < 5000; i++) {
  const regimen = regimenAlAzar();
  const base = i % 31 === 0 ? 0 : plata();
  const acumuladoMes = i % 5 === 0 ? 0 : i % 37 === 0 ? -plata() : plata();
  const retenidoMes = i % 3 === 0 ? 0 : guardado(azar() * 50000, 2);
  const inscripto = azar() < 0.7;
  const r = calcularRetencion({ base, acumuladoMes, retenidoMes, regimen, inscripto });
  retenciones.push({ base, acumuladoMes, retenidoMes, regimen, inscripto, ...r });
}

// Un mes entero de pagos: la base y lo retenido se acumulan como los suma
// Postgres (exacto, sobre lo guardado con toFixed(2)), y cada pago resta.
const meses: unknown[] = [];
for (let caso = 0; caso < 400; caso++) {
  const regimenes = Array.from({ length: 1 + entero(3) }, (_, k) => ({ ...regimenAlAzar(), codigo: `R${k}` }));
  const inscripto = azar() < 0.75;
  const acum = new Map<string, { base: number; retenido: number }>();
  const pagos: unknown[] = [];
  for (let p = 0; p < 1 + entero(8); p++) {
    const total = guardado(plata() + 1, 2);
    const pedidas = regimenes.filter(() => azar() < 0.8).map((g) => ({ codigo: g.codigo, base: guardado(azar() < 0.5 ? total : total / 1.21, 2) }));
    let retenido = 0;
    const certificados: unknown[] = [];
    for (const pedida of pedidas) {
      const regimen = regimenes.find((g) => g.codigo === pedida.codigo)!;
      const a = acum.get(pedida.codigo) ?? { base: 0, retenido: 0 };
      const resultado = calcularRetencion({
        base: pedida.base,
        acumuladoMes: deCentavos(a.base),
        retenidoMes: deCentavos(a.retenido),
        regimen,
        inscripto,
      });
      if (resultado.retencion <= 0) continue;
      acum.set(pedida.codigo, {
        base: a.base + centavos(pedida.base.toFixed(2)),
        retenido: a.retenido + centavos(resultado.retencion.toFixed(2)),
      });
      retenido = Math.round((retenido + resultado.retencion) * 100) / 100;
      certificados.push({ codigo: pedida.codigo, importe: resultado.retencion, alicuota: resultado.alicuota.toFixed(3) });
    }
    const neto = Math.round((total - retenido) * 100) / 100;
    pagos.push({
      total,
      pedidas,
      certificados,
      neto,
      retenido,
      detalle: retenido > 0 ? `más $${retenido.toFixed(2)} de retenciones · $${neto.toFixed(2)}` : "",
      totalGuardado: total.toFixed(2),
      movimiento: (-total).toFixed(2),
    });
  }
  meses.push({ regimenes, inscripto, pagos });
}

// Los controles del pago, en el orden del TS (copia de registrarPagoAProveedor, git 9a17128).
const aCentavos = (v: number) => Math.round(v * 100) / 100;
const controles: unknown[] = [];
for (let i = 0; i < 3000; i++) {
  const total = guardado(plata() + 1, 2);
  const retenido = azar() < 0.4 ? 0 : guardado(azar() * total * (azar() < 0.05 ? 2 : 0.1), 2);
  const neto = aCentavos(total - retenido);
  const facturas = Array.from({ length: entero(4) }, (_, k) => {
    const ftotal = guardado(plata() + 1, 2);
    const imputado = azar() < 0.5 ? 0 : guardado(ftotal * azar(), 2);
    const saldo = aCentavos(ftotal - imputado);
    const importe = guardado(azar() < 0.2 ? saldo + azar() * 5 : azar() < 0.1 ? saldo + 0.01 : saldo * azar(), 2);
    return { numero: 100 + k, total: ftotal, imputado, importe: azar() < 0.05 ? 0 : importe };
  });
  const sumaFact = facturas.reduce((s, f) => s + f.importe, 0);
  const partes = azar() < 0.4 ? [] : Array.from({ length: 1 + entero(3) }, () => guardado(neto * azar(), 2));
  if (partes.length > 0 && azar() < 0.6) partes[partes.length - 1] = aCentavos(neto - aCentavos(partes.slice(0, -1).reduce((s, p) => s + p, 0)));
  let error: string | null = null;
  const ejecutar = () => {
    if (neto < 0) return "Las retenciones superan el importe del pago.";
    for (const f of facturas) {
      if (!(f.importe > 0)) continue;
      const saldo = aCentavos(Number(f.total) - Number(f.imputado));
      if (f.importe - saldo > 0.01) {
        return `A la factura ${f.numero} le quedan $${saldo.toFixed(2)} y se le están imputando $${f.importe.toFixed(2)}.`;
      }
    }
    const sumaImputada = aCentavos(facturas.reduce((s, x) => s + Math.max(x.importe, 0), 0));
    if (sumaImputada - total > 0.01) return "Las facturas imputadas suman más que el pago.";
    const vivas = partes.filter((p) => p > 0);
    if (vivas.length > 0) {
      const sumaPartes = aCentavos(vivas.reduce((s, p) => s + p, 0));
      if (Math.abs(sumaPartes - neto) > 0.01) {
        return `Las partes del pago suman $${sumaPartes.toFixed(2)} y el neto a pagar es $${neto.toFixed(2)}.`;
      }
    }
    return null;
  };
  error = ejecutar();
  controles.push({ total, retenido, neto, facturas, partes, error, sumaFact });
}

const cheques = ["", "1", "123", "1234", "0012-3456", "12 3456", "00123456", "abc", "1".repeat(20), "1".repeat(21), "Nº 98.765.432", " 0001 ", "１２３４５"].map((t) => ({
  t,
  normal: normalizarNumeroDeCheque(t),
  problema: revisarNumeroDeCheque(t),
}));

// --- la lista de precios del proveedor ---

const encabezados = ["Código", "CODIGO", "codigo ", "Cód.", "Precio", "PRECIO FINAL", "precio", "Descripción", "Detalle", "Rubro", "  Precio  "];
const precios = ["4200", "4.200", "4.200,50", "4200.5", "$ 1.234,56", "", "abc", "-5", "0", "0,01", "1,234.56", "12.345.678", " 99 ", "1e3", "10,5%"];
const listas: unknown[] = [];
for (let i = 0; i < 1500; i++) {
  const cols = Array.from({ length: 1 + entero(4) }, () => elegir(encabezados));
  const filas = Array.from({ length: entero(8) }, () =>
    cols.map((c) => {
      const n = c.toLowerCase();
      if (n.includes("prec")) return elegir(precios);
      if (n.includes("cod") || n.includes("cód")) return azar() < 0.1 ? "" : elegir(["A-1", "A-2", " B-3 ", "C4", "A-1"]);
      return elegir(["Bisagra", "  Tornillo  ", "", "Placa 18mm"]);
    }),
  );
  if (azar() < 0.1) filas.push(["solo-codigo"]);
  const grilla = azar() < 0.03 ? [cols] : [cols, ...filas];
  const perfil = {
    columnaCodigo: elegir(["Codigo", "código", "COD", "Cód."]),
    columnaPrecio: elegir(["Precio", "precio final", "Importe"]),
    columnaDescripcion: elegir([null, "Descripcion", "Detalle", "Nada"]),
    precioEsNeto: azar() < 0.5,
    margenPorcentaje: elegir([0, 30, 35.5, 100, 12.34]),
  };
  listas.push({ grilla, perfil, ...leerListaDeProveedor(grilla, perfil) });
}

// --- el libro IVA compras y los CSV (copia de las rutas de exportar, git 9a17128) ---

const tipos = ["factura_a", "factura_b", "factura_c", "factura_m", "nota_credito_a", "nota_credito_b", "nota_credito_c", "nota_debito_a", "nota_debito_b", "nota_debito_c", "ticket", "otro"] as const;
const libros: unknown[] = [];
for (let caso = 0; caso < 200; caso++) {
  const filasBase = Array.from({ length: entero(25) }, (_, k) => ({
    fechaEmision: new Date(Date.UTC(2026, entero(12), 1 + entero(28), entero(24), entero(60))).toISOString(),
    tipo: elegir(tipos),
    puntoVenta: entero(20),
    numero: entero(100000),
    proveedor: elegir(["Maderas del Sur", 'Herrajes "El Tornillo"', "Ñandú SRL", "Café; y más"]),
    cuit: elegir([null, "30-12345678-9", "20123456789"]),
    neto: plata().toFixed(2),
    iva21: plata().toFixed(2),
    iva105: (azar() < 0.7 ? 0 : plata()).toFixed(2),
    iva27: (azar() < 0.9 ? 0 : plata()).toFixed(2),
    exento: (azar() < 0.8 ? 0 : plata()).toFixed(2),
    percepciones: (azar() < 0.7 ? 0 : plata()).toFixed(2),
    total: plata().toFixed(2),
    cae: elegir([null, "74123456789012", ""]),
    k,
  }));
  const conSigno = filasBase.map((f) => {
    const signo = f.tipo.startsWith("nota_credito") ? -1 : 1;
    return {
      ...f,
      fechaEmision: new Date(f.fechaEmision),
      neto: signo * Number(f.neto),
      iva21: signo * Number(f.iva21),
      iva105: signo * Number(f.iva105),
      iva27: signo * Number(f.iva27),
      exento: signo * Number(f.exento),
      percepciones: signo * Number(f.percepciones),
      total: signo * Number(f.total),
    };
  });
  const totales = conSigno.reduce(
    (a, f) => ({
      neto: a.neto + f.neto,
      iva21: a.iva21 + f.iva21,
      iva105: a.iva105 + f.iva105,
      iva27: a.iva27 + f.iva27,
      exento: a.exento + f.exento,
      percepciones: a.percepciones + f.percepciones,
      total: a.total + f.total,
    }),
    { neto: 0, iva21: 0, iva105: 0, iva27: 0, exento: 0, percepciones: 0, total: 0 },
  );
  const filas = conSigno.map((f) => [
    fechaCsv(f.fechaEmision),
    textoCsv(nombreComprobanteCompra(f.tipo)),
    textoCsv(numeroDeCompra(f.puntoVenta, f.numero)),
    textoCsv(f.proveedor),
    textoCsv(f.cuit),
    numeroCsv(f.neto),
    numeroCsv(f.iva21),
    numeroCsv(f.iva105),
    numeroCsv(f.iva27),
    numeroCsv(f.exento),
    numeroCsv(f.percepciones),
    numeroCsv(f.total),
    textoCsv(daCreditoFiscal(f.tipo) ? "Sí" : "No"),
    textoCsv(f.cae),
  ]);
  const computable = conSigno.filter((f) => daCreditoFiscal(f.tipo)).reduce((s, f) => s + f.iva21 + f.iva105 + f.iva27, 0);
  const csv = armarCsv(
    ["Fecha", "Comprobante", "Número", "Proveedor", "CUIT", "Neto", "IVA 21%", "IVA 10,5%", "IVA 27%", "Exento", "Percepciones", "Total", "Da crédito fiscal", "CAE"],
    filas,
    [
      textoCsv("Totales"), "", "", "", "",
      numeroCsv(totales.neto), numeroCsv(totales.iva21), numeroCsv(totales.iva105), numeroCsv(totales.iva27),
      numeroCsv(totales.exento), numeroCsv(totales.percepciones), numeroCsv(totales.total),
      textoCsv(`Computable: ${numeroCsv(computable)}`), "",
    ],
  );
  libros.push({ filas: filasBase, totales, computable, csv, conSigno: conSigno.map((f) => [f.neto, f.iva21, f.iva105, f.iva27, f.exento, f.percepciones, f.total]) });
}

const csvRetenciones: unknown[] = [];
for (let caso = 0; caso < 150; caso++) {
  const filas = Array.from({ length: entero(20) }, () => ({
    fecha: new Date(Date.UTC(2026, entero(12), 1 + entero(28), entero(24))).toISOString(),
    numero: `IIB-2026-${String(entero(1000)).padStart(6, "0")}`,
    impuesto: elegir(["iibb", "ganancias", "iva", "suss"]),
    codigoRegimen: elegir(["IIBB-MI", "78", "499"]),
    proveedor: elegir(["Maderas del Sur", 'El "Tornillo"', "Ñandú"]),
    cuit: elegir([null, "30-12345678-9"]),
    base: plata().toFixed(2),
    alicuota: (azar() * 10).toFixed(3),
    importe: plata().toFixed(2),
  }));
  const total = filas.reduce((s, f) => s + Number(f.importe), 0);
  const csv = armarCsv(
    ["Fecha", "Certificado", "Impuesto", "Régimen", "Proveedor", "CUIT", "Base", "Alícuota", "Retenido"],
    filas.map((f) => [
      fechaCsv(new Date(f.fecha)), textoCsv(f.numero), textoCsv(f.impuesto), textoCsv(f.codigoRegimen),
      textoCsv(f.proveedor), textoCsv(f.cuit), numeroCsv(Number(f.base)), numeroCsv(Number(f.alicuota), 3), numeroCsv(Number(f.importe)),
    ]),
    [textoCsv("Total"), "", "", "", "", "", "", "", numeroCsv(total)],
  );
  csvRetenciones.push({ filas, csv });
}

// --- el saldo del proveedor, las facturas con saldo, el período, el vencimiento y el monto ---

const libretas: unknown[] = [];
for (let caso = 0; caso < 500; caso++) {
  const montos = Array.from({ length: entero(40) }, () => ((azar() < 0.5 ? -1 : 1) * plata()).toFixed(2));
  // Vienen del más nuevo al más viejo, como los trae la consulta.
  let acumulado = 0;
  const saldos = [...montos].reverse().map((m) => (acumulado += Number(m))).reverse();
  libretas.push({ montos, saldos, saldo: acumulado });
}

const facturasConSaldo: unknown[] = [];
for (let i = 0; i < 2000; i++) {
  const total = plata().toFixed(2);
  const imputado = (azar() < 0.3 ? 0 : azar() < 0.3 ? Number(total) : Number(total) * azar()).toFixed(2);
  const puntoVenta = entero(100000);
  const numero = entero(1e9);
  const saldo = Math.round((Number(total) - Number(imputado)) * 100) / 100;
  facturasConSaldo.push({ total, imputado, puntoVenta, numero, saldo, vale: saldo > 0.009, texto: `${String(puntoVenta).padStart(4, "0")}-${String(numero).padStart(8, "0")}` });
}

const ahora = new Date(Date.UTC(2026, 9, 29, 15, 0, 0));
const periodos = ["", "2026-03", "2026-13", "2026-0", "2025-12", "abc", "2026", "-03", "2026-02", "2024-02", "1999-7", "2026-03-15", null].map((v) => {
  const p = leerPeriodoMensual(v, ahora);
  return { v, anio: p.anio, mes: p.mes, desde: p.desde.toISOString(), hasta: p.hasta.toISOString(), clave: p.clave };
});

const vencimientos: unknown[] = [];
for (const fecha of ["2026-10-29", "2026-01-31", "2026-02-28", "2024-02-29", "2026-12-31", "2026-10-29T15:30:00.000Z", "2026-03-01T00:00:00Z"]) {
  for (const dias of [0, 1, 30, 31, 60, 365]) {
    const emision = new Date(fecha);
    const vencimiento = new Date(emision);
    vencimiento.setDate(vencimiento.getDate() + dias);
    vencimientos.push({ fecha, dias, emision: emision.toISOString(), vencimiento: vencimiento.toISOString() });
  }
}

const montosAFormatear = [0, -0, 1, 0.5, 1.5, 2.5, -0.5, -1.5, 84500, 84500.5, 1234567.89, -1234.5, 999.4999, 0.1 + 0.2, NaN, 1e15, 12.345, -84500];
for (let i = 0; i < 500; i++) montosAFormatear.push((azar() < 0.2 ? -1 : 1) * plata(), Math.round(azar() * 1e6) / 2);
const montos = montosAFormatear.map((v) => ({ v: num(v), t: formatearMonto(v) }));

// --- los esquemas de zod (copiados de las acciones, git 9a17128) ---

const textoOpcional = z.string().trim().max(200).optional().transform((v) => (v ? v : null));
const fichaSchema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(2, "Poné el nombre del proveedor.").max(160),
  razonSocial: textoOpcional,
  cuit: textoOpcional,
  condicionIva: z.enum(["responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"]),
  contacto: textoOpcional,
  telefono: textoOpcional,
  email: textoOpcional,
  direccion: textoOpcional,
  rubro: textoOpcional,
  cbu: textoOpcional,
  aliasCbu: textoOpcional,
  diasPago: z.coerce.number().int().min(0).max(365),
  notas: z.string().trim().max(2000).optional().transform((v) => (v ? v : null)),
});
const movimientoSchema = z.object({
  supplierId: z.string().uuid(),
  tipo: z.enum(["factura", "pago", "nota_credito", "nota_debito", "ajuste"]),
  monto: z.coerce.number().positive("El monto tiene que ser mayor a cero."),
  detalle: z.string().trim().max(300).optional().transform((v) => (v ? v : null)),
  referencia: textoOpcional,
});
const condicionSchema = z.object({
  id: z.string().uuid().optional(),
  supplierId: z.string().uuid(),
  modalidad: z.enum(["transferencia", "cheque", "echeq", "efectivo", "otro"]),
  plazoDias: z.coerce.number().int().min(0).max(365).default(0),
  bonificacionPct: z.coerce.number().min(0).max(90).default(0),
  detalle: z.string().trim().max(300).optional(),
});
const lineaOrden = z.object({
  variantId: z.string().uuid(),
  descripcion: z.string().min(1),
  cantidad: z.coerce.number().positive(),
  costoUnitario: z.coerce.number().min(0),
  alicuotaIva: z.coerce.number().min(0).max(30),
});
const ordenSchema = z.object({
  supplierId: z.string().uuid("Elegí el proveedor."),
  branchId: z.string().uuid("Elegí la sucursal."),
  fechaPrometida: z.string().optional(),
  notas: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  lineas: z.array(lineaOrden).min(1, "Cargá al menos un renglón."),
});
const lineaRecepcion = z.object({
  variantId: z.string().uuid(),
  cantidad: z.coerce.number().positive(),
  costoUnitario: z.coerce.number().min(0),
  alicuotaIva: z.coerce.number().min(0).max(30),
});
const recepcionSchema = z.object({
  supplierId: z.string().uuid("Elegí el proveedor."),
  branchId: z.string().uuid("Elegí la sucursal."),
  numeroRemito: z.string().trim().max(40).optional().transform((v) => (v ? v : null)),
  fecha: z.string().optional(),
  gastos: z.coerce.number().min(0).default(0),
  notas: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
  lineas: z.array(lineaRecepcion).min(1, "Cargá al menos un renglón."),
});
const facturaSchema = z.object({
  supplierId: z.string().uuid("Elegí el proveedor."),
  tipo: z.enum(tipos),
  puntoVenta: z.coerce.number().int().min(0).max(99999),
  numero: z.coerce.number().int().min(0),
  fechaEmision: z.string(),
  cae: z.string().trim().max(20).optional().transform((v) => (v ? v : null)),
  neto: z.coerce.number().min(0),
  iva21: z.coerce.number().min(0),
  iva105: z.coerce.number().min(0),
  iva27: z.coerce.number().min(0),
  exento: z.coerce.number().min(0),
  percepciones: z.coerce.number().min(0),
  observaciones: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
});
const gastoSchema = z.object({
  fecha: z.string(),
  categoria: z.enum(["flete", "combustible", "servicios", "alquiler", "sueldos", "mantenimiento", "impuestos", "librería", "publicidad", "otros"]),
  descripcion: z.string().trim().min(2, "Poné en qué se gastó.").max(200),
  importe: z.coerce.number().positive("El importe tiene que ser mayor a cero."),
  medio: z.enum(["efectivo", "transferencia", "debito", "credito", "cheque"]),
  circuito: z.enum(["blanco", "negro"]).default("blanco"),
  branchId: z.string().optional().transform((v) => (v ? v : null)),
  supplierId: z.string().optional().transform((v) => (v ? v : null)),
  notas: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
});
const pagoSchema = z.object({
  supplierId: z.string().uuid("Elegí el proveedor."),
  total: z.coerce.number().positive("El pago tiene que ser mayor a cero."),
  medio: z.enum(["transferencia", "efectivo", "cheque", "echeq"]),
  circuito: z.enum(["blanco", "negro"]).default("blanco"),
  referencia: z.string().trim().max(80).optional().transform((v) => (v ? v : null)),
  notas: z.string().trim().max(500).optional().transform((v) => (v ? v : null)),
  retenciones: z.array(z.object({ regimenId: z.string().uuid(), base: z.coerce.number().min(0) })),
  imputaciones: z.array(z.object({ purchaseInvoiceId: z.string().uuid(), importe: z.coerce.number().min(0) })).max(30).optional(),
  partes: z
    .array(
      z.object({
        medio: z.enum(["transferencia", "efectivo", "cheque", "echeq"]),
        importe: z.coerce.number().positive(),
        referencia: z.string().trim().max(80).nullable().optional(),
        cheque: z
          .object({
            tipo: z.enum(["fisico", "echeq"]),
            numero: z.string().trim().min(1, "Poné el número del cheque.").max(40),
            banco: z.string().trim().max(60).nullable().optional(),
            fechaPago: z.coerce.date(),
          })
          .nullable()
          .optional(),
        chequeId: z.string().uuid().nullable().optional(),
      }),
    )
    .max(6)
    .optional(),
});
const perfilSchema = z.object({
  supplierId: z.string().uuid(),
  columnaCodigo: z.string().trim().min(1, "Elegí la columna del código."),
  columnaPrecio: z.string().trim().min(1, "Elegí la columna del precio."),
  columnaDescripcion: z.string().trim().optional(),
  precioEsNeto: z.boolean(),
  margenPorcentaje: z.coerce.number().min(0).max(500),
});
const filasAplicarSchema = z.array(
  z.object({ codigo: z.string(), variantId: z.string().uuid(), costo: z.number(), precioSugerido: z.number().positive() }),
);
const regimenSchema = z.object({
  id: z.string().uuid(),
  alicuota: z.coerce.number().min(0).max(100),
  alicuotaNoInscripto: z.coerce.number().min(0).max(100),
  activo: z.boolean(),
});

const U = "8f2b5c1e-1d2a-4c3b-9a8e-111111111111";
const U2 = "8f2b5c1e-1d2a-4c3b-9a8e-222222222222";
const textosMalos = [undefined, "", " ", "a", "ab", "  ab  ", "x".repeat(41), "x".repeat(201), "x".repeat(301), "x".repeat(1001), "x".repeat(2001), "😀".repeat(100), "no-uuid", U];
const numerosMalos = [NaN, -1, 0, 0.5, 1, 1.5, 30, 30.5, 90, 90.1, 100, 100.5, 365, 366, 500, 501, 99999, 100000, undefined];

/** El primer problema de zod (mensaje y campo), o los datos ya leídos. */
function correr(esquema: z.ZodTypeAny, entrada: unknown) {
  const r = esquema.safeParse(entrada);
  if (r.success) return { entrada: limpiar(entrada), datos: limpiar(r.data) };
  const p = r.error.issues[0];
  return { entrada: limpiar(entrada), error: p?.message ?? "", campo: (p?.path ?? []).join(".") };
}
/** NaN y las fechas no pasan por JSON: NaN va como null y la fecha como ISO. */
function limpiar(v: unknown): unknown {
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Invalid Date" : v.toISOString();
  if (Array.isArray(v)) return v.map(limpiar);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpiar(x)]));
  return v;
}
/** Una entrada válida con un campo cambiado por cada valor de la lista. */
function mutaciones(base: Record<string, unknown>, campos: Record<string, readonly unknown[]>) {
  const out: Record<string, unknown>[] = [base];
  for (const [campo, valores] of Object.entries(campos)) {
    for (const v of valores) {
      const e = { ...base };
      if (v === undefined) delete e[campo];
      else e[campo] = v;
      out.push(e);
    }
  }
  // Y de a dos, al azar, para ver qué error sale primero.
  const nombres = Object.keys(campos);
  for (let i = 0; i < 150; i++) {
    const e = { ...base };
    for (let k = 0; k < 2 + entero(2); k++) {
      const c = elegir(nombres);
      const v = elegir(campos[c]);
      if (v === undefined) delete e[c];
      else e[c] = v;
    }
    out.push(e);
  }
  return out;
}

const T = textosMalos;
const N = numerosMalos;
const esquemas: Record<string, unknown[]> = {};
esquemas.ficha = mutaciones(
  { nombre: "Maderas del Sur", condicionIva: "responsable_inscripto", diasPago: 30 },
  { id: [undefined, "x", U], nombre: T, razonSocial: T, cuit: T, condicionIva: ["", "otro", "exento", undefined], email: T, notas: T, diasPago: N },
).map((e) => correr(fichaSchema, e));
esquemas.movimiento = mutaciones(
  { supplierId: U, tipo: "factura", monto: 100 },
  { supplierId: ["", "x", undefined], tipo: ["", "pago", "nota_credito", "otro", undefined], monto: N, detalle: T, referencia: T },
).map((e) => correr(movimientoSchema, e));
// La condición llega como FormData: la acción la arma así (copiado de guardarCondicion).
esquemas.condicion = mutaciones(
  { supplierId: U, modalidad: "transferencia", plazoDias: "30", bonificacionPct: "5" },
  {
    id: [undefined, "", "x", U],
    supplierId: ["", "x", undefined],
    modalidad: ["", "cheque", "otro", "nada", undefined],
    plazoDias: ["", "0", "30", "30.5", "366", "-1", "abc", undefined],
    bonificacionPct: ["", "5", "5,5", "90", "90,01", "-1", "abc", undefined],
    detalle: ["", "  algo  ", "x".repeat(301), undefined],
  },
).map((f) => {
  const s = (k: string) => (f[k] === undefined ? null : (f[k] as string));
  const r = correr(condicionSchema, {
    id: s("id") || undefined,
    supplierId: s("supplierId"),
    modalidad: s("modalidad") ?? "transferencia",
    plazoDias: s("plazoDias") || 0,
    bonificacionPct: s("bonificacionPct")?.replace(",", ".") || 0,
    detalle: s("detalle") || undefined,
  });
  return { ...r, entrada: f };
});
const linea = { variantId: U, descripcion: "Placa", cantidad: 2, costoUnitario: 100, alicuotaIva: 21 };
const lineasMalas = [
  [], [linea], [linea, { ...linea, cantidad: 0 }], [{ ...linea, variantId: "x" }], [{ ...linea, descripcion: "" }],
  [{ ...linea, cantidad: NaN }], [{ ...linea, costoUnitario: -1 }], [{ ...linea, alicuotaIva: 31 }], [{ ...linea, alicuotaIva: -1 }],
  [linea, { ...linea, costoUnitario: NaN, alicuotaIva: 40 }], undefined,
];
esquemas.orden = mutaciones(
  { supplierId: U, branchId: U2, lineas: [linea] },
  { supplierId: ["", "x", undefined], branchId: ["", undefined], fechaPrometida: [undefined, "", "2026-11-01"], notas: T, lineas: lineasMalas },
).map((e) => correr(ordenSchema, e));
const lineaR = { variantId: U, cantidad: 2, costoUnitario: 100, alicuotaIva: 21 };
esquemas.recepcion = mutaciones(
  { supplierId: U, branchId: U2, lineas: [lineaR] },
  {
    supplierId: ["", undefined], branchId: ["x", undefined], numeroRemito: T, fecha: [undefined, "", "2026-10-01"], gastos: N, notas: T,
    lineas: lineasMalas.map((ls) => ls?.map(({ descripcion: _d, ...l }) => l)),
  },
).map((e) => correr(recepcionSchema, e));
esquemas.factura = mutaciones(
  { supplierId: U, tipo: "factura_a", puntoVenta: 3, numero: 1274, fechaEmision: "2026-10-01", neto: 100, iva21: 21, iva105: 0, iva27: 0, exento: 0, percepciones: 0 },
  {
    supplierId: ["", undefined], tipo: ["", "factura_x", "nota_credito_b", undefined], puntoVenta: N, numero: N, fechaEmision: [undefined, ""],
    cae: T, neto: N, iva21: N, iva105: N, iva27: N, exento: N, percepciones: N, observaciones: T,
  },
).map((e) => correr(facturaSchema, e));
esquemas.gasto = mutaciones(
  { fecha: "2026-10-01", categoria: "flete", descripcion: "Flete a obra", importe: 1500, medio: "efectivo" },
  {
    fecha: [undefined, ""], categoria: ["", "librería", "libreria", undefined], descripcion: T, importe: N, medio: ["", "credito", "mp", undefined],
    circuito: [undefined, "negro", "gris"], branchId: [undefined, "", "x", U], supplierId: [undefined, "", U], notas: T,
  },
).map((e) => correr(gastoSchema, e));
const parte = { medio: "transferencia", importe: 100 };
const chequeNuevo = { tipo: "fisico", numero: "12345678", banco: "Nación", fechaPago: new Date("2026-11-15T12:00:00Z") };
esquemas.pago = mutaciones(
  { supplierId: U, total: 1000, medio: "transferencia", retenciones: [] },
  {
    supplierId: ["", undefined], total: N, medio: ["", "echeq", "mp", undefined], circuito: [undefined, "negro", "x"], referencia: T, notas: T,
    retenciones: [undefined, [], [{ regimenId: U, base: 100 }], [{ regimenId: "x", base: 100 }], [{ regimenId: U, base: -1 }], [{ regimenId: U, base: NaN }]],
    imputaciones: [undefined, [], [{ purchaseInvoiceId: U, importe: 10 }], [{ purchaseInvoiceId: "x", importe: 10 }], [{ purchaseInvoiceId: U, importe: -1 }],
      Array.from({ length: 31 }, () => ({ purchaseInvoiceId: U, importe: 1 }))],
    partes: [
      undefined, [], [parte], [{ ...parte, importe: 0 }], [{ ...parte, medio: "mp" }], [{ ...parte, referencia: null }], [{ ...parte, referencia: "x".repeat(81) }],
      [{ ...parte, medio: "cheque", cheque: chequeNuevo }], [{ ...parte, cheque: { ...chequeNuevo, numero: "  " } }], [{ ...parte, cheque: { ...chequeNuevo, tipo: "otro" } }],
      [{ ...parte, cheque: { ...chequeNuevo, banco: null } }], [{ ...parte, cheque: { ...chequeNuevo, fechaPago: new Date("x") } }],
      [{ ...parte, cheque: { ...chequeNuevo, fechaPago: "2026-11-15T12:00:00.000Z" } }], [{ ...parte, cheque: null, chequeId: U }], [{ ...parte, chequeId: "x" }],
      Array.from({ length: 7 }, () => parte),
    ],
  },
).map((e) => correr(pagoSchema, e));
// El perfil también llega como FormData (copiado de leerPerfilDelFormulario).
esquemas.perfil = mutaciones(
  { supplierId: U, columnaCodigo: "Codigo", columnaPrecio: "Precio", precioEsNeto: "on", margenPorcentaje: "30" },
  {
    supplierId: ["", "x", undefined], columnaCodigo: ["", "  ", " Cód ", undefined], columnaPrecio: ["", undefined, "Precio final"],
    columnaDescripcion: ["", " Detalle ", undefined], precioEsNeto: [undefined, "", "off"], margenPorcentaje: ["", "0", "35.5", "35,5", "500", "501", "-1", "abc", undefined],
  },
).map((f) => {
  const s = (k: string) => (f[k] === undefined ? null : (f[k] as string));
  const r = correr(perfilSchema, {
    supplierId: s("supplierId"),
    columnaCodigo: s("columnaCodigo"),
    columnaPrecio: s("columnaPrecio"),
    columnaDescripcion: s("columnaDescripcion") || undefined,
    precioEsNeto: s("precioEsNeto") === "on",
    margenPorcentaje: s("margenPorcentaje") || 0,
  });
  return { ...r, entrada: f };
});
const filaA = { codigo: "A-1", variantId: U, costo: 100, precioSugerido: 130 };
esquemas.aplicar = [
  [], [filaA], [filaA, { ...filaA, codigo: "A-2" }], [{ ...filaA, variantId: "x" }], [{ ...filaA, precioSugerido: 0 }], [{ ...filaA, costo: "100" }],
  [{ ...filaA, codigo: 5 }], [{ ...filaA, precioSugerido: -1 }], {}, "x", [{ codigo: "A" }],
].map((e) => {
  const r = filasAplicarSchema.safeParse(e);
  return { entrada: e, ok: r.success && r.data.length > 0 };
});
esquemas.regimen = mutaciones(
  { id: U, alicuota: "1.5", alicuotaNoInscripto: "3", activo: "on" },
  { id: ["", "x", undefined], alicuota: ["", "0", "100", "100.5", "-1", "abc", "1,5", undefined], alicuotaNoInscripto: ["", "50", "101", undefined], activo: [undefined, "", "on"] },
).map((f) => {
  const s = (k: string) => (f[k] === undefined ? null : (f[k] as string));
  const r = regimenSchema.safeParse({ id: s("id"), alicuota: s("alicuota"), alicuotaNoInscripto: s("alicuotaNoInscripto"), activo: s("activo") === "on" });
  return {
    entrada: f,
    ok: r.success,
    datos: r.success
      ? {
          alicuota: r.data.alicuota.toFixed(3),
          alicuotaNoInscripto: r.data.alicuotaNoInscripto.toFixed(3),
          activo: r.data.activo,
          texto: `${r.data.alicuota}`,
        }
      : null,
  };
});

const dir = new URL("../../backend/testdata/golden/compras/", import.meta.url);
mkdirSync(dir, { recursive: true });
const escribir = (nombre: string, v: unknown) => writeFileSync(new URL(nombre, dir), JSON.stringify(v) + "\n");
escribir("costo.json", { costos, prorrateos, recepciones });
escribir("retenciones.json", { retenciones, meses, controles, cheques });
escribir("lista.json", { listas });
escribir("fiscal.json", { libros, csvRetenciones, libretas, facturasConSaldo, periodos, vencimientos, montos });
escribir("esquemas.json", esquemas);
const cuantos = Object.values(esquemas).reduce((s, v) => s + v.length, 0);
console.log(
  `${costos.length} costos, ${prorrateos.length} prorrateos, ${recepciones.length} recepciones encadenadas, ` +
    `${retenciones.length} retenciones, ${meses.length} meses de pagos, ${controles.length} controles de pago, ` +
    `${listas.length} listas, ${libros.length} libros, ${libretas.length} libretas, ${cuantos} formularios`,
);
