/**
 * Golden de la tanda 6 (carrito, checkout y Mercado Pago): lo puro del TS,
 * corrido sobre casos fijos y miles al azar con semilla, para que
 * internal/checkout e internal/pagos den lo mismo, exacto.
 *
 * - `volumen.json`: descuentoPorVolumen y precioConDescuento (copia de lib/precios/volumen.ts en originales/tanda6).
 * - `carrito.json`: el armado de obtenerCarrito sin las consultas (copia en originales/tanda6/carrito.ts).
 * - `agregar.json`, `presupuesto.json`, `compra.json`, `bancarios.json`: los esquemas de zod
 *   (primer error y campo, o los datos leídos).
 * - `cuentas.json`: subtotal, envío, medio permitido, descuento y total de confirmarCompra.
 * - `firma.json`: la firma del webhook (copia de lib/pagos/firma.ts en originales/tanda6) y el `data.id` que se firma.
 * - `preferencia.json`: el cuerpo de POST /checkout/preferences.
 * - `remoto.json`: la respuesta de GET /v1/payments/{id} traducida; los avisos de MP y de la demo.
 * - `decision.json`: lo que decide acreditarPago con el estado y el aviso.
 *
 *   TZ=America/Argentina/Buenos_Aires npx tsx scripts/golden/checkout.ts
 *
 * Con la zona argentina a propósito: «para cuándo» del presupuesto se lee a
 * las 12 de Buenos Aires (el TS lo leía en la zona del servidor, UTC).
 */
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import type { ZodSafeParseResult } from "zod";
import { descuentoPorVolumen, precioConDescuento, type EscalaDeVolumen } from "./originales/tanda6/volumen";
import { firmaValida, leerCabeceraFirma, manifiestoFirma } from "./originales/tanda6/firma";
import {
  agregarSchema,
  armarCarrito,
  cuentasDeLaCompra,
  datosBancariosSchema,
  datosDeCompraSchema,
  notasDelPresupuesto,
  presupuestoSchema,
  type FilaDeCorte,
  type FilaDelCarrito,
} from "./originales/tanda6/carrito";
import {
  consultarDemo,
  cuerpoDePreferencia,
  dataIdDelAviso,
  decidir,
  interpretarAvisoDemo,
  interpretarAvisoMP,
  pagoDeMercadoPago,
} from "./originales/tanda6/pagos";

if (new Date(Date.UTC(2026, 0, 1)).getTimezoneOffset() !== 180) {
  throw new Error("Correlo con TZ=America/Argentina/Buenos_Aires");
}

const SALIDA = "backend/testdata/golden/checkout";
mkdirSync(SALIDA, { recursive: true });
const guardar = (n: string, v: unknown) => writeFileSync(`${SALIDA}/${n}`, JSON.stringify(v));

let semilla = 20261029;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
  return semilla / 2 ** 31;
};
const entero = (n: number) => Math.floor(azar() * n);
const elegir = <T>(xs: readonly T[]): T => xs[entero(xs.length)];
const uuid = () => {
  const h = () => entero(16).toString(16);
  const n = (k: number) => Array.from({ length: k }, h).join("");
  return `${n(8)}-${n(4)}-4${n(3)}-${elegir(["8", "9", "a", "b"])}${n(3)}-${n(12)}`;
};
const plata = () => elegir([0, 1, 0.5, 0.01, 0.005, 1.005, 2.675, 99.995, 1234.565, 50000, 89999.99]) + (azar() < 0.5 ? Math.round(azar() * 1e7) / 100 : 0);
const largo = (n: number) => "x".repeat(n);

function resultado<T>(r: ZodSafeParseResult<T>) {
  if (r.success) return { datos: r.data };
  const i = r.error.issues[0];
  return { error: i?.message ?? "", campo: (i?.path ?? []).join(".") };
}
// Lo que viaja por la red: sin undefined, los Date como texto.
const red = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/* ------------------------------- volumen ------------------------------- */

const variantes = [uuid(), uuid(), uuid()];
const categorias = [uuid(), uuid()];
function escalasAlAzar(): EscalaDeVolumen[] {
  return Array.from({ length: entero(6) }, () => ({
    id: uuid(),
    variantId: azar() < 0.4 ? elegir(variantes) : null,
    categoryId: azar() < 0.4 ? elegir(categorias) : null,
    desdeCantidad: elegir([0, 1, 5, 10, 10, 50, 100, 2.5]),
    porcentaje: elegir([0, 5, 10, 15, 12.5, 90, 95, 100, -5]),
  }));
}
const volumen = [];
for (let i = 0; i < 4000; i++) {
  const escalas = escalasAlAzar();
  const contexto = {
    variantId: azar() < 0.8 ? elegir(variantes) : null,
    categoryId: azar() < 0.8 ? elegir(categorias) : null,
    cantidad: elegir([0, 1, 4.5, 5, 9, 10, 11, 49, 50, 60, 100, 1000]),
  };
  const precio = plata();
  const pct = descuentoPorVolumen(escalas, contexto);
  volumen.push({ escalas, contexto, precio, porcentaje: pct, conDescuento: precioConDescuento(precio, pct), directo: precioConDescuento(precio, elegir([0, 3, 10, 33.3, 90, 99])), pctDirecto: 0 });
  // El directo usa otro porcentaje: se recalcula para guardarlo.
  const pd = elegir([0, 3, 10, 33.3, 90, 99, -1]);
  volumen[volumen.length - 1].pctDirecto = pd;
  volumen[volumen.length - 1].directo = precioConDescuento(precio, pd);
}
guardar("volumen.json", volumen);

/* ------------------------------- carrito ------------------------------- */

const formas = ["entera", "entera_o_media", "metro_cuadrado", null] as const;
function filaAlAzar(): FilaDelCarrito {
  const conVariante = azar() < 0.9;
  return {
    id: uuid(),
    variantId: conVariante ? elegir(variantes) : null,
    descripcion: elegir(["Fenólico 18 mm", "Tirante 2x4", "MDF 15"]),
    unidad: elegir(["unidad", "placa", "metro_lineal"]),
    cantidad: elegir(["1.00", "2.00", "0.50", "10.00", "3.75", "100.00", "55.00"]),
    precioUnitario: azar() < 0.2 ? null : String(plata().toFixed(2)),
    origen: elegir(["catalogo", "calculadora", "repetido"]),
    notas: azar() < 0.8 ? null : "Cortar",
    presentacion: elegir([null, null, "media_largo", "media_ancho", "otra"]),
    unit: conVariante ? elegir(["placa", "placa", "unidad", null]) : null,
    formaDeVenta: conVariante ? elegir(formas) : null,
    precioMediaPct: elegir([null, 50, 55, 60.5]),
    slug: conVariante ? "fenolico" : null,
    categoryId: azar() < 0.7 ? elegir(categorias) : null,
    precioActual: azar() < 0.15 ? null : String(plata().toFixed(2)),
  };
}
function corteAlAzar(): FilaDeCorte {
  return {
    id: uuid(),
    variantId: azar() < 0.9 ? elegir(variantes) : null,
    materialDescripcion: "Melamina blanca 18",
    placaLargoMm: 2750,
    placaAnchoMm: elegir([1830, 915]),
    mitad: elegir([null, "largo", "ancho"]),
    cantoDescripcion: elegir([null, "PVC blanco"]),
    piezas: elegir([
      "[]",
      '[{"cantidad":2},{"cantidad":"3"}]',
      '[{"cantidad":1.5},{"cantidad":null},{}]',
      "no es json",
      '{"cantidad":4}',
      '[{"cantidad":"x"},{"cantidad":7}]',
      "[null]",
    ]),
    placas: entero(4),
    pasadas: entero(30),
    total: String(plata().toFixed(2)),
  };
}
const carritos = [];
for (let i = 0; i < 2500; i++) {
  const filas = Array.from({ length: entero(7) }, filaAlAzar);
  const cortes = Array.from({ length: entero(3) }, corteAlAzar);
  const escalas = escalasAlAzar();
  const lista = azar() < 0.3 ? "Profesionales" : null;
  carritos.push({ filas, cortes, escalas, lista, carrito: armarCarrito("c", filas, cortes, escalas, lista) });
}
guardar("carrito.json", carritos);

/* ------------------------------ esquemas ------------------------------ */

const ids = () => elegir([undefined, uuid(), uuid().toUpperCase(), "no-es-uuid", "00000000-0000-0000-0000-000000000000", ""]);

const agregar = [];
for (let i = 0; i < 3000; i++) {
  const o: Record<string, unknown> = {
    variantId: azar() < 0.3 ? undefined : ids(),
    descripcion: azar() < 0.85 ? elegir(["Fenólico 18 mm", "  Tirante  ", "🪵 Madera"]) : elegir([null, "", "  ", largo(240), largo(241), 3]),
    unidad: azar() < 0.5 ? undefined : elegir(["placa", " m ", largo(40), largo(41), null]),
    cantidad: elegir([1, 2, 0.5, "3", " 4 ", 0, -1, 100000, 100001, "abc", null, "", true, [], "1e3", Number.NaN]),
    presentacion: azar() < 0.5 ? undefined : elegir([null, "media_largo", "media_ancho", "entera", ""]),
    origen: azar() < 0.5 ? undefined : elegir(["calculadora", " repetido ", largo(41)]),
    notas: azar() < 0.7 ? undefined : elegir(["Cortar a 1 m", largo(300), largo(301), "   "]),
  };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  const entrada = red(o);
  agregar.push({ entrada, ...red(resultado(agregarSchema.safeParse(entrada))) });
}
guardar("agregar.json", agregar);

const fechas = ["2026-11-05", "2026-02-30", "2026-13-01", "2026-1-5", "2024-02-29", "2026-04-31", "abc", " 2026-11-05 ", "2026-11", "2026", "+002026-11-05", "2026-00-10", "2026-11-00", "2026-11-32", "0000-01-01", "9999-12-31", "2026-11-05T10:00"];
const presupuesto = [];
for (let i = 0; i < 3000; i++) {
  const o: Record<string, unknown> = {
    nombre: azar() < 0.85 ? elegir(["Juan Pérez", "  Ana  "]) : elegir([null, "", "a", largo(120), largo(121)]),
    email: azar() < 0.85 ? elegir(["a@b.co", " x@y.com "]) : elegir([null, "malo", "", "a@b"]),
    telefono: azar() < 0.85 ? elegir(["223 555-1234", "  2235551234 "]) : elegir([null, "123", "12345", largo(40), largo(41)]),
    sucursalId: azar() < 0.5 ? undefined : ids() || undefined,
    necesitaPara: azar() < 0.5 ? undefined : elegir(fechas),
    motivos: azar() < 0.2 ? [] : elegir([["volumen"], ["obra", "flete"], ["otra"], [largo(41)], ["volumen", "flete", "fabricacion", "obra", "a", "b", "c"], [3]]),
    notas: azar() < 0.6 ? undefined : elegir(["Para el lunes", largo(800), largo(801)]),
  };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  const entrada = red(o);
  const r = presupuestoSchema.safeParse(entrada);
  presupuesto.push({
    entrada,
    ...red(resultado(r)),
    notasGuardadas: r.success ? notasDelPresupuesto(r.data.motivos, r.data.notas) : null,
  });
}
guardar("presupuesto.json", presupuesto);

const compra = [];
for (let i = 0; i < 4000; i++) {
  const o: Record<string, unknown> = {
    nombre: azar() < 0.9 ? "Juan Pérez" : elegir([null, "", "a", largo(121)]),
    email: azar() < 0.9 ? "juan@correo.com" : elegir([null, "malo", "a@b"]),
    telefono: azar() < 0.9 ? "2235551234" : elegir([null, "123", largo(41)]),
    entrega: elegir(["retiro", "envio", "envio", null, "otra"]),
    sucursalId: azar() < 0.4 ? undefined : ids() || undefined,
    zonaId: azar() < 0.4 ? undefined : ids() || undefined,
    direccion: azar() < 0.4 ? undefined : elegir(["Av. Colón 1234", "  ", largo(240), largo(241)]),
    medioPago: elegir(["mercado_pago", "transferencia", "debito", "efectivo", "cuenta_corriente", "credito", null]),
    notas: azar() < 0.7 ? undefined : elegir(["Timbre B", largo(600), largo(601)]),
  };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  const entrada = red(o);
  compra.push({ entrada, ...red(resultado(datosDeCompraSchema.safeParse(entrada))) });
}
guardar("compra.json", compra);

const bancarios = [];
for (let i = 0; i < 1500; i++) {
  const o: Record<string, unknown> = {
    banco: azar() < 0.9 ? "Banco Nación" : elegir([largo(121), null]),
    titular: azar() < 0.9 ? "MJBJ SA" : largo(161),
    cuit: azar() < 0.9 ? "30-58944525-9" : largo(21),
    cbu: elegir(["", "0110012345678901234567", "011001234567890123456", "01100123456789012345678", "abc", " 0110012345678901234567 "]),
    alias: azar() < 0.9 ? "MADERA.JBJ" : largo(61),
    instrucciones: azar() < 0.6 ? undefined : elegir(["Mandá el comprobante", largo(400), largo(401)]),
  };
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  const entrada = red(o);
  bancarios.push({ entrada, ...red(resultado(datosBancariosSchema.safeParse(entrada))) });
}
guardar("bancarios.json", bancarios);

/* ------------------------------- cuentas ------------------------------- */

const medios = ["mercado_pago", "transferencia", "debito", "efectivo", "cuenta_corriente"];
const cuentas = [];
for (let i = 0; i < 4000; i++) {
  const e = {
    subtotalItems: Array.from({ length: entero(6) }, () => plata() * elegir([1, 2, 0.5, 3.75])),
    subtotalCortes: Array.from({ length: entero(3) }, plata),
    zona:
      azar() < 0.5
        ? null
        : {
            id: uuid(),
            nombre: elegir(["Mar del Plata", "Batán"]),
            costo: elegir([0, 5000, 5000.5, 12000]),
            envioGratisDesde: elegir([0, 100000, 300000]),
            demoraEstimada: null,
            aCotizar: azar() < 0.2,
          },
    medioPago: elegir(medios),
    listaDiferenciada: azar() < 0.3,
    escalas: Array.from({ length: entero(4) }, () => ({
      medio: elegir(medios),
      desdeMonto: elegir([0, 100000, 500000]),
      porcentaje: elegir([0, 5, 10, 15, 95]),
      etiqueta: "x",
    })),
  };
  cuentas.push({ entrada: e, ...cuentasDeLaCompra(e) });
}
guardar("cuentas.json", cuentas);

/* -------------------------------- firma -------------------------------- */

const SECRETO = elegir(["s3cr3t0", "otro-secreto-de-prueba"]);
const AHORA = Date.UTC(2026, 9, 29, 15, 0, 0);
const firma = [];
for (let i = 0; i < 3000; i++) {
  const dataQuery = azar() < 0.7 ? elegir(["123456789", "ABCdef123", "pago-1", ""]) : null;
  const cuerpo = azar() < 0.2 ? {} : { data: { id: elegir([123456789, "987", "ABC", null, true]) } };
  const url = new URL(`https://mjbj.com.ar/api/pagos/webhook${dataQuery !== null ? `?data.id=${dataQuery}&type=payment` : "?type=payment"}`);
  const dataId = dataIdDelAviso(url, cuerpo);
  const requestId = azar() < 0.8 ? uuid() : null;
  const ts = elegir([
    String(Math.floor(AHORA / 1000)),
    String(AHORA),
    String(Math.floor(AHORA / 1000) - 299),
    String(Math.floor(AHORA / 1000) - 301),
    String(Math.floor(AHORA / 1000) + 301),
    "abc",
    "",
    "1e9",
  ]);
  const manifiesto = manifiestoFirma({ dataId, requestId, ts });
  const buena = createHmac("sha256", SECRETO).update(manifiesto).digest("hex");
  const v1 = elegir([buena, buena.toUpperCase(), ` ${buena} `, buena.slice(1), "00".repeat(32), "zz"]);
  const cabecera = elegir([
    `ts=${ts},v1=${v1}`,
    `v1=${v1},ts=${ts}`,
    ` ts = ${ts} , v1 = ${v1} `,
    `ts=${ts}`,
    `ts=${ts},v1=${v1},v2=otra`,
    `basura`,
    "",
    null,
  ]);
  const leida = leerCabeceraFirma(cabecera);
  const secreto = elegir([SECRETO, SECRETO, null, "", "otra"]);
  firma.push({
    query: url.search,
    cuerpo,
    cabecera,
    requestId,
    secreto,
    dataId,
    leida,
    manifiesto: leida ? manifiestoFirma({ dataId, requestId, ts: leida.ts }) : null,
    valida: leida ? firmaValida({ dataId, requestId, ts: leida.ts, v1: leida.v1 }, secreto, AHORA) : false,
  });
}
guardar("firma.json", firma);

/* ----------------------------- preferencia ----------------------------- */

const titulos = ["Fenólico 18 mm", "á".repeat(260), "🪵".repeat(130), "x".repeat(249) + "🪵", "Pedido P-0001"];
const preferencia = [];
for (let i = 0; i < 2000; i++) {
  const solicitud = {
    referencia: uuid(),
    descripcion: "Pedido P-0001",
    monto: plata(),
    items: Array.from({ length: 1 + entero(4) }, () => ({
      titulo: elegir(titulos),
      cantidad: elegir([1, 2, 0.5, 0.4, 2.5, 3.75, 0, 1000]),
      precioUnitario: elegir([plata(), 1.005, 2.675, 0.125, 1e-7, 123456.789]),
    })),
    pagador: elegir([undefined, { nombre: "Ana", email: "ana@x.com" }, { nombre: null, email: "a@b.co" }, { nombre: "Ana", email: null }, {}]),
    urlRetorno: "https://mjbj.com.ar/pedido/P-0001?t=abc",
    urlWebhook: "https://mjbj.com.ar/api/pagos/webhook",
  };
  preferencia.push({ solicitud: red(solicitud), cuerpo: red(cuerpoDePreferencia(solicitud)) });
}
guardar("preferencia.json", preferencia);

/* -------------------------------- remoto ------------------------------- */

const estadosMP = ["approved", "refunded", "charged_back", "cancelled", "rejected", "pending", "in_process", "in_mediation", "authorized", "otro", ""];
const remoto = [];
for (let i = 0; i < 2000; i++) {
  const pago: Record<string, unknown> = {
    id: elegir([123456789, "987654", 0, "", 1.5]),
    status: elegir(estadosMP),
    status_detail: elegir([undefined, "accredited", "cc_rejected_other_reason", "pending_contingency"]),
    transaction_amount: elegir([undefined, 1000, 1000.5, 0, 99999.99]),
    payment_method_id: elegir([undefined, "visa", "account_money"]),
    payment_type_id: elegir([undefined, "credit_card", "ticket"]),
    external_reference: elegir([undefined, uuid()]),
  };
  for (const k of Object.keys(pago)) if (pago[k] === undefined) delete pago[k];
  remoto.push({ pago, remoto: red(pagoDeMercadoPago(pago as never)) });
}
const avisos = [];
for (let i = 0; i < 2000; i++) {
  const cuerpo = elegir([
    {},
    null,
    { type: "payment", action: "payment.created", id: 12345, data: { id: "987" } },
    { type: "payment", data: { id: 987 } },
    { type: "merchant_order", data: { id: "1" } },
    { action: "payment.updated", data: { id: "55" } },
    { id: "abc", type: "payment" },
    { type: "", data: { id: null } },
    { id: 0, data: { id: 0 } },
    { data: { id: "demo-" + uuid() + "-aprobado" }, id: "demo-evento-x" },
  ]);
  const query = elegir(["", "?type=payment&data.id=777", "?topic=payment&id=888", "?type=merchant_order&data.id=1", "?data.id=999"]);
  const url = new URL(`https://mjbj.com.ar/api/pagos/webhook${query}`);
  avisos.push({ cuerpo, query, mp: interpretarAvisoMP(cuerpo, url), demo: interpretarAvisoDemo(cuerpo) });
}
const demos = [];
for (const id of [
  `demo-${uuid()}-aprobado`,
  `demo-${uuid()}-rechazado`,
  `demo-${uuid()}-pendiente`,
  `demo-${uuid()}-otro`,
  "demo-sin",
  "demo--aprobado",
  `x-${uuid()}-aprobado`,
  "demo-a-b-c-reintegrado",
  "demo-",
]) {
  demos.push({ id, remoto: red(consultarDemo(id)) });
}
guardar("remoto.json", { pagos: remoto, avisos, demos });

/* ------------------------------- decision ------------------------------ */

const estados = ["iniciado", "pendiente", "en_revision", "aprobado", "rechazado", "reintegrado", "cancelado"];
const decision = [];
for (let i = 0; i < 3000; i++) {
  const nuestro = plata();
  const r = {
    estado: elegir(["pendiente", "aprobado", "rechazado", "reintegrado", "cancelado"]),
    monto: elegir([null, nuestro, nuestro + 0.5, nuestro + 0.51, nuestro - 0.5, nuestro - 0.500001, 1, nuestro * 2]),
  };
  const actual = elegir(estados);
  decision.push({ actual, nuestro, remoto: r, ...decidir(actual, nuestro, r as never) });
}
guardar("decision.json", decision);

console.log("golden de checkout listos en", SALIDA);

/* -------------------------------- plazos ------------------------------- */
// lib/plazos.ts, el real, con la zona argentina: Go cuenta el horario de
// atención en Buenos Aires (el TS lo contaba en la del servidor, UTC).
import { vencimientoDelDia, vencimientoExpress } from "../../lib/plazos";
const plazos = [];
for (let i = 0; i < 3000; i++) {
  const desde = new Date(Date.UTC(2026, 0, 1) + Math.floor(azar() * 400 * 86_400_000));
  if (azar() < 0.3) desde.setMinutes(0, 0, 0);
  plazos.push({ desde: desde.toISOString(), express: vencimientoExpress(desde).toISOString(), delDia: vencimientoDelDia(desde).toISOString() });
}
guardar("plazos.json", plazos);
