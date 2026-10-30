/**
 * Golden de la facturación electrónica (tanda 7): todo lo puro de lib/fiscal
 * corrido en el TypeScript real, para que el Go (internal/fiscal y
 * internal/facturacion) dé lo mismo, bit a bit.
 *
 * - El IVA (desagregar, agregarIva, calcularTotales) y las cuentas de emitir
 *   (la percepción, el total), de las notas (renglones, prorrateo, tope) y de
 *   la nota de débito.
 * - La letra, los códigos, el documento del receptor, el número formateado,
 *   la fecha de ARCA y la clave del candado de la numeración.
 * - El XML: el cuerpo de FECAESolicitar byte a byte, el sobre, el TRA, el
 *   sobre de loginCms; y la lectura de las respuestas (FECAESolicitar,
 *   FEDummy, loginCms) con fast-xml-parser.
 * - El libro IVA ventas (signo y totales) y su CSV, ahora con lib/csv-excel.
 * - Los esquemas de zod de las acciones: el primer error o los datos.
 *
 *   TZ=America/Argentina/Buenos_Aires npx tsx scripts/golden/fiscal.ts
 *
 * Con la zona argentina a propósito: fechaArca() usa la del proceso, y en Go
 * va siempre en hora argentina (en producción Next corre en UTC y desde las
 * 21 h mandaba a ARCA la fecha de mañana). Con TZ=UTC el golden falla.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import { agregarIva, desagregar, redondear } from "../../lib/fiscal/impuestos";
import {
  CODIGO_COMPROBANTE,
  desdeFechaArca,
  documentoReceptor,
  fechaArca,
  letraQueCorresponde,
  nombreComprobante,
  notaDeCredito,
  notaDeDebito,
  numeroFormateado,
  tipoFactura,
  type CondicionIva,
  type TipoComprobante,
} from "../../lib/fiscal/comprobantes";
import { lineasDeLaNota, prorratearTributos, revisarAcreditacion } from "./originales/fiscal-notas";
import {
  armarTra,
  auth,
  calcularTotales,
  calculoDeNota,
  claveDeLock,
  cuerpoAutorizar,
  cuerpoDe,
  cuerpoUltimo,
  importesDeEmision,
  interpretarAutorizacion,
  interpretarDummy,
  leerTicket,
  sobre,
  sobreLoginCms,
  totalDebitado,
  type ComprobanteAAutorizar,
} from "./originales/fiscal-arca";
import { armarCsv, fechaCsv, numeroCsv, textoCsv } from "../../lib/csv-excel";

if (new Date(2026, 0, 1).getTimezoneOffset() !== 180) throw new Error("Correlo con TZ=America/Argentina/Buenos_Aires");

let semilla = 20261029;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
  return semilla / 2 ** 31;
};
const entero = (n: number) => Math.floor(azar() * n);
const elegir = <T>(xs: readonly T[]): T => xs[entero(xs.length)];
const num = (x: number) => (Number.isNaN(x) ? "NaN" : x === Infinity ? "Inf" : x === -Infinity ? "-Inf" : x);
const plata = () => {
  const r = azar();
  if (r < 0.03) return 0;
  if (r < 0.35) return Math.round(azar() * 100000) / 100;
  if (r < 0.8) return Math.round(azar() * 10000000) / 100;
  return Math.round(azar() * 1e9) / 100;
};
const cantidad = () => {
  const r = azar();
  if (r < 0.5) return 1 + entero(20);
  if (r < 0.8) return Math.round(azar() * 10000) / 100;
  return Math.round(azar() * 1e6) / 1000;
};
const ALICUOTAS = [0, 10.5, 21, 27];
const alicuota = () => (azar() < 0.85 ? elegir(ALICUOTAS) : elegir([5, 2.5, NaN, -21, 105, 0.5]));
const TIPOS: TipoComprobante[] = [
  "factura_a", "factura_b", "factura_c",
  "nota_credito_a", "nota_credito_b", "nota_credito_c",
  "nota_debito_a", "nota_debito_b", "nota_debito_c",
];
const CONDICIONES: CondicionIva[] = ["responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"];
const palabras = ["Fenólico", "18mm", "Machimbre", "pino", "& Cía", "<ojo>", 'comillas "dobles"', "Melamina", "ñandú", "Envío — zona sur"];
const texto = (n = 3) => Array.from({ length: 1 + entero(n) }, () => elegir(palabras)).join(" ");
const instante = () => new Date(Date.UTC(2025 + entero(3), entero(12), 1 + entero(28), entero(24), entero(60), entero(60), entero(1000)));

const salida = "backend/testdata/golden/fiscal";
mkdirSync(salida, { recursive: true });
const guardar = (nombre: string, datos: unknown) =>
  writeFileSync(`${salida}/${nombre}.json`, JSON.stringify(datos, (_k, v) => (typeof v === "number" ? num(v) : v)));

// --- el IVA ---

const desagregados: unknown[] = [];
for (let i = 0; i < 4000; i++) {
  const precio = i % 97 === 0 ? elegir([NaN, -100, 0.005, 0.015, 1e15]) : plata();
  const a = alicuota();
  desagregados.push({ precio, alicuota: a, r: desagregar(precio, a), agregado: agregarIva(precio, a), redondeo: redondear(precio * 1.005) });
}
guardar("desagregar", desagregados);

const lineasAlAzar = () =>
  Array.from({ length: 1 + entero(8) }, () => {
    const l: { descripcion: string; unidad?: string; cantidad: number; precioFinalUnitario: number; alicuota?: number } = {
      descripcion: texto(),
      cantidad: azar() < 0.03 ? elegir([0, -1]) : cantidad(),
      precioFinalUnitario: plata(),
    };
    if (azar() < 0.7) l.unidad = elegir(["unidad", "m²", "ml", ""]);
    if (azar() < 0.8) l.alicuota = alicuota();
    return l;
  });

const totales: unknown[] = [];
for (let i = 0; i < 1000; i++) {
  const lineas = lineasAlAzar();
  const t = calcularTotales(lineas);
  totales.push({ lineas, r: { ...t, ivaPorAlicuota: [...t.ivaPorAlicuota.entries()].map(([a, v]) => ({ alicuota: a, ...v })) } });
}
guardar("totales", totales);

const tributoAlAzar = () => ({
  codigo: elegir(["02", "07", "99"]),
  descripcion: elegir(["Percepción Ingresos Brutos", "Percepción IIBB & otros", "Impuesto <municipal>"]),
  base: plata(),
  alicuota: elegir([1.5, 2, 3, 0.75, 3.31]),
  importe: plata() / 10,
});

const emisiones: unknown[] = [];
for (let i = 0; i < 1000; i++) {
  const lineas = lineasAlAzar();
  const dados = azar() < 0.2 ? Array.from({ length: entero(3) }, tributoAlAzar) : undefined;
  const config = { percibeIibb: azar() < 0.5, alicuotaPercepcionIibb: elegir(["0.00", "1.50", "3.00", "2.75", "0.01"]) };
  const r = importesDeEmision(lineas, dados, config);
  emisiones.push({
    lineas, dados: dados ?? null, config,
    r: { ...r, totales: { ...r.totales, ivaPorAlicuota: [...r.totales.ivaPorAlicuota.entries()].map(([a, v]) => ({ alicuota: a, ...v })) } },
  });
}
guardar("emisiones", emisiones);

// --- las notas ---

const notas: unknown[] = [];
for (let i = 0; i < 1200; i++) {
  const items = Array.from({ length: 1 + entero(6) }, (_x, k) => ({
    id: `i${k}`,
    descripcion: texto(),
    unidad: "unidad",
    cantidad: Number(cantidad().toFixed(2)),
    subtotal: plata(),
    alicuotaIva: elegir(ALICUOTAS),
  }));
  const parciales =
    azar() < 0.3
      ? null
      : items
          .filter(() => azar() < 0.7)
          .map((it) => ({
            itemId: azar() < 0.05 ? "otro" : it.id,
            cantidad: azar() < 0.08 ? elegir([0, -1, NaN, it.cantidad + 1]) : Number((azar() * it.cantidad).toFixed(2)),
          }));
  const neto = plata();
  const original = {
    neto: neto.toFixed(2),
    iva21: (neto * 0.21).toFixed(2),
    iva105: (azar() < 0.2 ? neto * 0.05 : 0).toFixed(2),
    iva27: "0.00",
    exento: (azar() < 0.2 ? plata() : 0).toFixed(2),
    total: (neto * 1.21 + (azar() < 0.3 ? plata() / 10 : 0)).toFixed(2),
    acreditado: (azar() < 0.4 ? neto * azar() : 0).toFixed(2),
  };
  const tributos = Array.from({ length: entero(3) }, tributoAlAzar);
  notas.push({ original, items, parciales, tributos, r: calculoDeNota(original, items, parciales, tributos) });
}
guardar("notas", notas);

const sueltas: unknown[] = [];
for (let i = 0; i < 1500; i++) {
  const total = plata();
  const acreditado = azar() < 0.5 ? total * azar() : 0;
  const monto = azar() < 0.05 ? elegir([0, -1, NaN, Infinity]) : azar() < 0.5 ? total - acreditado : plata();
  const tributos = Array.from({ length: entero(4) }, tributoAlAzar);
  const proporcion = azar() < 0.2 ? 1 : azar();
  sueltas.push({
    total, acreditado, monto, revisar: revisarAcreditacion(total, acreditado, monto),
    tributos, proporcion, prorrateo: prorratearTributos(tributos, proporcion),
  });
}
guardar("notas-sueltas", sueltas);

const debitos: unknown[] = [];
for (let i = 0; i < 500; i++) {
  const lineas = lineasAlAzar();
  debitos.push({ lineas, r: totalDebitado(lineas) });
}
guardar("debitos", debitos);

// --- comprobantes, documento, números, fechas, candado ---

const comprobantes: unknown[] = [];
for (const e of CONDICIONES) for (const r of CONDICIONES) {
  const letra = letraQueCorresponde(e, r);
  const tipo = tipoFactura(letra);
  comprobantes.push({ emisor: e, receptor: r, letra, tipo, nc: notaDeCredito(tipo), nd: notaDeDebito(tipo) });
}
const documentos: unknown[] = [];
for (let i = 0; i < 1500; i++) {
  const cuit = elegir([null, "", "20-12345678-9", "2012345678", "12.345.678", "1234567", "abc", "30-71234567-1 ", "201234567890"]) ??
    null;
  const raro = azar() < 0.5 ? cuit : String(Math.floor(azar() * 10 ** (6 + entero(7))));
  documentos.push({ cuit: raro, r: documentoReceptor(raro) });
}
const numeros: unknown[] = [];
for (let i = 0; i < 1000; i++) {
  const pv = entero(10) < 8 ? 1 + entero(30) : entero(100000);
  const n = entero(10) < 8 ? 1 + entero(100000) : entero(1e9);
  const tipo = elegir(TIPOS);
  numeros.push({ pv, n, tipo, formateado: numeroFormateado(pv, n), nombre: nombreComprobante(tipo), codigo: CODIGO_COMPROBANTE[tipo] });
}
const fechas: unknown[] = [];
for (let i = 0; i < 1500; i++) {
  const t = instante();
  const crudo = elegir(["20261029", "2026102", "20260230", "20261301", "abcdefgh", "", `${2025 + entero(3)}${String(1 + entero(12)).padStart(2, "0")}${String(1 + entero(28)).padStart(2, "0")}`]);
  fechas.push({ t: t.toISOString(), arca: fechaArca(t), crudo, desde: desdeFechaArca(crudo)?.toISOString() ?? null });
}
const claves: unknown[] = [];
for (const tipo of [...TIPOS, "", "factura_m", "ñ", "x".repeat(40), "💥"]) {
  for (let i = 0; i < 40; i++) {
    const pv = i < 30 ? i : entero(1e6) - 5000;
    claves.push({ pv, tipo, clave: claveDeLock(pv, tipo) });
  }
}
guardar("comprobantes", { comprobantes, documentos, numeros, fechas, claves });

// --- el XML del pedido de CAE ---

const pedidos: unknown[] = [];
for (let i = 0; i < 800; i++) {
  const tipo = elegir(TIPOS);
  const t = calcularTotales(lineasAlAzar());
  const iva = [...t.ivaPorAlicuota.entries()].map(([a, v]) => ({ alicuota: a, ...v }));
  if (azar() < 0.05) iva.push({ alicuota: 5, base: 10, importe: 0.5 });
  const tributos = azar() < 0.4 ? Array.from({ length: 1 + entero(2) }, tributoAlAzar) : [];
  const total = redondear(t.total + tributos.reduce((s, x) => s + x.importe, 0));
  const comprobante: ComprobanteAAutorizar = {
    tipo,
    puntoVenta: elegir([1, 3, 15, 17, 20, 99999]),
    numero: 1 + entero(99_999_999),
    fechaEmision: instante(),
    receptorCuit: elegir([null, "20123456789", "30-71234567-1", "12345678", "1234", ""]),
    receptorCondicionIva: elegir(CONDICIONES),
    neto: t.neto,
    exento: t.exento,
    iva,
    tributos,
    total,
    asociado: azar() < 0.6 ? { tipo: elegir(TIPOS), puntoVenta: 1 + entero(30), numero: 1 + entero(9999), fecha: instante() } : null,
  };
  const ticket = { token: "PD94bWwgdmVyc2lvbj0i" + i, sign: "aBc+/=" + i };
  const cuit = elegir(["20111111112", "30712345671"]);
  const encabezado = auth(ticket, cuit);
  pedidos.push({
    comprobante: { ...comprobante, fechaEmision: comprobante.fechaEmision.toISOString(), asociado: comprobante.asociado ? { ...comprobante.asociado, fecha: comprobante.asociado.fecha.toISOString() } : null },
    ticket, cuit,
    sobre: sobre("FECAESolicitar", cuerpoAutorizar(comprobante, { cuit }, encabezado)),
    ultimo: sobre("FECompUltimoAutorizado", cuerpoUltimo(encabezado, comprobante.puntoVenta, tipo)),
  });
}
pedidos.push({ dummy: sobre("FEDummy", "") });
guardar("pedidos", pedidos);

// --- las respuestas ---

const NS = ["", "soap:", "s:"];
const envolver = (p: string, cuerpo: string) =>
  `<?xml version="1.0" encoding="utf-8"?><${p}Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><${p}Body>${cuerpo}</${p}Body></${p}Envelope>`;
const errOObs = (tag: string, hijo: string) => {
  const n = entero(4);
  if (n === 0) return "";
  const items = Array.from({ length: n }, () => {
    const code = elegir([`<Code>${10000 + entero(300)}</Code>`, "", "<Code></Code>", `<Codigo>${entero(700)}</Codigo>`]);
    const msg = elegir([`<Msg>${texto().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</Msg>`, "<Msg></Msg>", "", `<Mensaje>Observado ${entero(9)}</Mensaje>`]);
    return `<${hijo}>${code}${msg}</${hijo}>`;
  });
  return `<${tag}>${items.join(azar() < 0.5 ? "" : "\n  ")}</${tag}>`;
};
const respuestas: unknown[] = [];
for (let i = 0; i < 2000; i++) {
  const p = elegir(NS);
  const resultado = elegir(["A", "A", "A", "R", "P", ""]);
  const cae = elegir([`${70000000000000 + entero(1e9)}`, "", null]);
  const vto = elegir([`2026${String(1 + entero(12)).padStart(2, "0")}${String(1 + entero(28)).padStart(2, "0")}`, "", "2026113", null]);
  const det = azar() < 0.05
    ? ""
    : `<FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>80</DocTipo><CbteDesde>${i}</CbteDesde><Resultado>${resultado}</Resultado>${
        errOObs("Observaciones", "Obs")
      }${cae === null ? "" : `<CAE>${cae}</CAE>`}${vto === null ? "" : `<CAEFchVto>${vto}</CAEFchVto>`}</FECAEDetResponse></FeDetResp>`;
  const errores = azar() < 0.25 ? errOObs("Errors", "Err") : "";
  const eventos = azar() < 0.1 ? errOObs("Events", "Evt") : "";
  const cuerpo = `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult><FeCabResp><Cuit>20111111112</Cuit><Resultado>${resultado}</Resultado></FeCabResp>${det}${errores}${eventos}</FECAESolicitarResult></FECAESolicitarResponse>`;
  const xml = envolver(p, cuerpo);
  const r = interpretarAutorizacion(cuerpoDe(xml));
  respuestas.push({ xml, r: { ...r, caeVencimiento: "caeVencimiento" in r && r.caeVencimiento ? r.caeVencimiento.toISOString() : null } });
}
for (const d of [
  "<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>",
  "<AppServer>OK</AppServer><DbServer>NO</DbServer><AuthServer>OK</AuthServer>",
  "<AppServer> OK </AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>",
  "<AppServer>OK</AppServer><DbServer>OK</DbServer>",
  "",
]) {
  const xml = envolver("soap:", `<FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult>${d}</FEDummyResult></FEDummyResponse>`);
  respuestas.push({ dummy: xml, r: interpretarDummy(cuerpoDe(xml)) });
}
guardar("respuestas", respuestas);

// --- el WSAA ---

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tickets: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const ahora = instante().getTime();
  const token = azar() < 0.1 ? "" : `PD94bWwg${i}+/=`;
  const sign = azar() < 0.1 ? "" : `ZmlybWE${i}=`;
  const expira = elegir(["2026-10-30T09:00:00.000-03:00", "2026-10-29T21:15:07.123Z", "", null]);
  const ta = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<loginTicketResponse version="1.0"><header><source>CN=wsaahomo</source>${
    expira === null ? "" : `<expirationTime>${expira}</expirationTime>`
  }</header><credentials><token>${token}</token><sign>${sign}</sign></credentials></loginTicketResponse>`;
  const forma = entero(6);
  const xml =
    forma === 0
      ? `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>ns1:coe.alreadyAuthenticated</faultcode><faultstring>  El CEE ya posee un TA valido para el acceso al WSN solicitado </faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`
      : forma === 1
        ? `<soapenv:Envelope xmlns:soapenv="x"><soapenv:Body><loginCmsResponse><otra>nada</otra></loginCmsResponse></soapenv:Body></soapenv:Envelope>`
        : `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desa.afip.gov"><loginCmsReturn>${esc(ta)}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;
  const status = forma === 0 ? 500 : elegir([200, 200, 200, 502]);
  let r: unknown;
  try {
    const t = leerTicket(xml, status >= 200 && status < 300, status, ahora);
    r = { token: t.token, sign: t.sign, expira: t.expira.toISOString() };
  } catch (e) {
    r = { error: (e as Error).message };
  }
  tickets.push({ ahora: new Date(ahora).toISOString(), xml, status, r });
}
const tras: unknown[] = [];
for (let i = 0; i < 300; i++) {
  const ahora = instante().getTime();
  const cms = `MIIG${i}+abc/=`;
  tras.push({ ahora: new Date(ahora).toISOString(), servicio: elegir(["wsfe", "ws_sr_padron_a5"]), tra: "", sobre: sobreLoginCms(cms), cms });
  const t = tras[tras.length - 1] as { servicio: string; tra: string };
  t.tra = armarTra(t.servicio, ahora);
}
guardar("wsaa", { tickets, tras });

// --- el libro IVA ventas ---

const libros: unknown[] = [];
for (let i = 0; i < 80; i++) {
  const filas = Array.from({ length: entero(40) }, (_x, k) => {
    const tipo = elegir(TIPOS);
    const neto = plata();
    return {
      id: `f${k}`,
      fechaEmision: instante().toISOString(),
      tipo,
      puntoVenta: 1 + entero(20),
      numero: 1 + entero(99999),
      receptorNombre: texto(),
      receptorCuit: elegir([null, "20123456789", 'raro "cuit"']),
      neto: neto.toFixed(2),
      iva21: (neto * 0.21).toFixed(2),
      iva105: (azar() < 0.2 ? neto * 0.105 : 0).toFixed(2),
      iva27: "0.00",
      exento: (azar() < 0.1 ? plata() : 0).toFixed(2),
      tributos: (azar() < 0.3 ? plata() / 30 : 0).toFixed(2),
      total: (neto * 1.21).toFixed(2),
      cae: elegir([null, `${70000000000000 + entero(1e9)}`]),
    };
  });
  // libroIvaVentas(): las notas de crédito en negativo y los totales con reduce.
  const conSigno = filas.map((f) => {
    const signo = f.tipo.startsWith("nota_credito") ? -1 : 1;
    return {
      ...f,
      neto: signo * Number(f.neto),
      iva21: signo * Number(f.iva21),
      iva105: signo * Number(f.iva105),
      iva27: signo * Number(f.iva27),
      exento: signo * Number(f.exento),
      tributos: signo * Number(f.tributos),
      total: signo * Number(f.total),
    };
  });
  const tot = conSigno.reduce(
    (a, fila) => ({
      neto: a.neto + fila.neto,
      iva21: a.iva21 + fila.iva21,
      iva105: a.iva105 + fila.iva105,
      iva27: a.iva27 + fila.iva27,
      exento: a.exento + fila.exento,
      tributos: a.tributos + fila.tributos,
      total: a.total + fila.total,
    }),
    { neto: 0, iva21: 0, iva105: 0, iva27: 0, exento: 0, tributos: 0, total: 0 },
  );
  // El CSV: las mismas columnas de app/admin/arca/libro-iva/exportar, ahora
  // con lib/csv-excel (CRLF, encabezados entre comillas, fecha dd/mm/aaaa en
  // hora argentina) como el libro IVA compras.
  const csv = armarCsv(
    ["Fecha", "Tipo", "Numero", "Cliente", "CUIT", "Neto", "IVA 21%", "IVA 10,5%", "IVA 27%", "Exento", "Percepciones", "Total", "CAE"],
    conSigno.map((f) => [
      fechaCsv(new Date(f.fechaEmision)),
      textoCsv(nombreComprobante(f.tipo)),
      textoCsv(numeroFormateado(f.puntoVenta, f.numero)),
      textoCsv(f.receptorNombre),
      textoCsv(f.receptorCuit),
      numeroCsv(f.neto),
      numeroCsv(f.iva21),
      numeroCsv(f.iva105),
      numeroCsv(f.iva27),
      numeroCsv(f.exento),
      numeroCsv(f.tributos),
      numeroCsv(f.total),
      textoCsv(f.cae),
    ]),
    ["", "", "", textoCsv("TOTALES"), "", numeroCsv(tot.neto), numeroCsv(tot.iva21), numeroCsv(tot.iva105), numeroCsv(tot.iva27),
      numeroCsv(tot.exento), numeroCsv(tot.tributos), numeroCsv(tot.total), ""],
  );
  libros.push({ filas, conSigno, totales: tot, csv });
}
guardar("libro", libros);

// --- zod: las acciones de app/admin/facturacion/actions.ts ---

const condicion = z.enum(["responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"]);
const cabeceraManual = z.object({
  receptorNombre: z.string().trim().min(2, "Falta el nombre.").max(160),
  receptorCuit: z.string().trim().max(20).optional().refine((v) => !v || /^\d{2}-?\d{8}-?\d$/.test(v), "El CUIT tiene que tener 11 dígitos."),
  receptorCondicionIva: condicion,
  receptorDomicilio: z.string().trim().max(200).optional(),
  observaciones: z.string().trim().max(600).optional(),
  customerId: z.string().uuid().optional(),
  guardarComoCliente: z.coerce.boolean().default(false),
});
const lineaManualSchema = z.object({
  descripcion: z.string().trim().min(1).max(240),
  cantidad: z.coerce.number().positive().max(100000),
  precio: z.coerce.number().positive().max(100_000_000),
  alicuota: z.coerce.number(),
});
const emisor = z.object({
  razonSocial: z.string().trim().min(2, "Falta la razón social.").max(160),
  nombreFantasia: z.string().trim().max(160).optional(),
  cuit: z.string().trim().refine((v) => /^\d{2}-?\d{8}-?\d$/.test(v), "El CUIT tiene que tener 11 dígitos."),
  condicionIva: condicion,
  domicilio: z.string().trim().max(200).optional(),
  localidad: z.string().trim().max(80).optional(),
  codigoPostal: z.string().trim().max(12).optional(),
  telefono: z.string().trim().max(40).optional(),
  email: z.string().trim().max(120).optional(),
  ingresosBrutos: z.string().trim().max(40).optional(),
  regimenIibb: z.enum(["local", "convenio_multilateral", "exento", "no_inscripto"]),
  alicuotaPercepcionIibb: z.string().trim().optional(),
  percibeIibb: z.coerce.boolean().optional(),
  inicioActividades: z.string().trim().optional(),
  leyenda: z.string().trim().max(500).optional(),
});
const puntoVenta = z.object({
  id: z.string().uuid().optional(),
  numero: z.coerce.number().int().min(1).max(99999),
  nombre: z.string().trim().min(2, "Poné un nombre.").max(80),
  branchId: z.string().uuid().optional(),
  activo: z.coerce.boolean().optional(),
  numeroInicial: z.coerce.number().int().min(0).max(99_999_999),
});
const anulacion = z.object({
  id: z.string().uuid(),
  motivo: z.string().trim().min(4, "Escribí el motivo de la anulación.").max(300),
});

/** formData.get(): el texto, o null si el campo no vino. */
const get = (c: Record<string, string>, k: string): string | null => (k in c ? c[k] : null);
const vacioAUndef = (c: Record<string, string>, k: string) => (get(c, k) as string) || undefined;

const UUIDS = ["0b8f1c1e-8f0e-4a39-9d43-2a1f0c3b9e11", "no-es-uuid", "", "0B8F1C1E-8F0E-4A39-9D43-2A1F0C3B9E11"];
const largo = (n: number) => "x".repeat(n);
const valorDe = (opciones: (string | null)[]) => elegir(opciones);
const formulario = (claves: Record<string, (string | null)[]>) => {
  const c: Record<string, string> = {};
  for (const [k, ops] of Object.entries(claves)) {
    const v = valorDe(ops);
    if (v !== null) c[k] = v;
  }
  return c;
};
const primero = (r: { success: boolean; error?: { issues: { message: string; path: PropertyKey[] }[] }; data?: unknown }) =>
  r.success ? { datos: r.data } : { error: r.error!.issues[0]?.message, campo: String(r.error!.issues[0]?.path[0] ?? "") };

const zods: unknown[] = [];
for (let i = 0; i < 1500; i++) {
  const c = formulario({
    receptorNombre: ["Juan Pérez", " A ", "", "  Gómez SRL  ", largo(161), null],
    receptorCuit: ["", "20-12345678-9", "20123456789", "2012345678", " 30-71234567-1 ", largo(21), null],
    receptorCondicionIva: [...CONDICIONES, "otra", "", null],
    receptorDomicilio: ["", "Juan B. Justo 1234", largo(201), null],
    observaciones: ["", "Pedido PED-1000", largo(601), null],
    customerId: [...UUIDS, null],
    guardarComoCliente: ["on", "", null],
  });
  const r = cabeceraManual.safeParse({
    receptorNombre: get(c, "receptorNombre"),
    receptorCuit: vacioAUndef(c, "receptorCuit"),
    receptorCondicionIva: get(c, "receptorCondicionIva"),
    receptorDomicilio: vacioAUndef(c, "receptorDomicilio"),
    observaciones: vacioAUndef(c, "observaciones"),
    customerId: vacioAUndef(c, "customerId"),
    guardarComoCliente: get(c, "guardarComoCliente") === "on",
  });
  zods.push({ esquema: "manual", campos: c, r: primero(r) });
}
for (let i = 0; i < 1500; i++) {
  const linea = {
    descripcion: elegir(["Placa", "  ", " Tirante 2x4 ", largo(241), "x"]),
    cantidad: elegir(["1", "0", "-2", "2,5", "2.5", "abc", "", "100000", "100001", "1e3", " 7 "]),
    precio: elegir(["12100", "0", "-1", "99999999.99", "100000001", "1.234,56", "", "0x10"]),
    alicuota: elegir(["21", "10.5", "", "abc", "5", "0"]) || "21",
  };
  const r = lineaManualSchema.safeParse(linea);
  zods.push({ esquema: "linea", campos: linea, r: primero(r) });
}
for (let i = 0; i < 1500; i++) {
  const c = formulario({
    razonSocial: ["Maderera Juan B. Justo SA", "", " M ", largo(161), null],
    nombreFantasia: ["", "MJBJ", largo(161), null],
    cuit: ["30-71234567-1", "30712345671", "3071234567", "", null],
    condicionIva: [...CONDICIONES, "x", null],
    domicilio: ["", "Juan B. Justo 5600", largo(201), null],
    localidad: ["", "Mar del Plata", largo(81), null],
    codigoPostal: ["", "7600", largo(13), null],
    telefono: ["", "223 555-1234", largo(41), null],
    email: ["", "hola@mjbj.com.ar", largo(121), null],
    ingresosBrutos: ["", "901-123456-7", largo(41), null],
    regimenIibb: ["local", "convenio_multilateral", "exento", "no_inscripto", "otro", "", null],
    alicuotaPercepcionIibb: ["", "3", "2,5", null],
    percibeIibb: ["on", "", null],
    inicioActividades: ["", "1981-03-01", null],
    leyenda: ["", "Precios con IVA", largo(501), null],
  });
  const r = emisor.safeParse({
    razonSocial: get(c, "razonSocial"),
    nombreFantasia: vacioAUndef(c, "nombreFantasia"),
    cuit: get(c, "cuit"),
    condicionIva: get(c, "condicionIva"),
    domicilio: vacioAUndef(c, "domicilio"),
    localidad: vacioAUndef(c, "localidad"),
    codigoPostal: vacioAUndef(c, "codigoPostal"),
    telefono: vacioAUndef(c, "telefono"),
    email: vacioAUndef(c, "email"),
    ingresosBrutos: vacioAUndef(c, "ingresosBrutos"),
    regimenIibb: get(c, "regimenIibb") || "local",
    alicuotaPercepcionIibb: vacioAUndef(c, "alicuotaPercepcionIibb"),
    percibeIibb: get(c, "percibeIibb") === "on",
    inicioActividades: vacioAUndef(c, "inicioActividades"),
    leyenda: vacioAUndef(c, "leyenda"),
  });
  zods.push({ esquema: "emisor", campos: c, r: primero(r) });
}
for (let i = 0; i < 1500; i++) {
  const c = formulario({
    id: [...UUIDS, null],
    numero: ["3", "0", "15", "99999", "100000", "1.5", "abc", "", " 20 ", null],
    nombre: ["Mostrador", " X ", "", largo(81), null],
    branchId: [...UUIDS, null],
    activo: ["on", "off", "", null],
    numeroInicial: ["0", "1200", "-1", "99999999", "100000000", "2.5", "x", "", null],
  });
  const r = puntoVenta.safeParse({
    id: vacioAUndef(c, "id"),
    numero: get(c, "numero"),
    nombre: get(c, "nombre"),
    branchId: vacioAUndef(c, "branchId"),
    activo: get(c, "activo") !== "off",
    numeroInicial: vacioAUndef(c, "numeroInicial") || 0,
  });
  zods.push({ esquema: "punto", campos: c, r: primero(r) });
}
for (let i = 0; i < 500; i++) {
  const c = formulario({ id: [...UUIDS, null], motivo: ["Error de carga", "abc", "  abcd  ", "", largo(301), null] });
  const r = anulacion.safeParse({ id: get(c, "id"), motivo: get(c, "motivo") });
  zods.push({ esquema: "anular", campos: c, r: primero(r) });
}
guardar("zod", zods);

console.log("golden de fiscal escrito en", salida);
