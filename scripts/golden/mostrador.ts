/**
 * Golden del mostrador (tanda 5): las reglas puras de la venta y lo que
 * contestaban los esquemas de zod de cada puerta, para que el Go
 * (internal/ventas, internal/caja, internal/mostrador) dé lo mismo exacto.
 *
 * - lib/mostrador/importes.ts: total, revisar la venta y los pagos, pagos
 *   normalizados, medio principal, importe por medio y el descuento repartido.
 * - lib/precios/medio-pago.ts, lib/ventas/forma-de-venta.ts, la fecha
 *   acotada de una venta sin conexión, el orden de los clientes del buscador
 *   y el nombre de la diferencia del arqueo.
 * - Los esquemas: la venta de la acción (`cobrarVenta`), la de la cola sin
 *   conexión (el cuerpo de POST /api/mostrador/ventas), el movimiento de caja
 *   diferido, el presupuesto del mostrador y el alta rápida de un cliente: el
 *   primer error (mensaje y ruta) o que pasó.
 *
 *   TZ=UTC npx tsx scripts/golden/mostrador.ts
 *
 * Los esquemas de app/mostrador/actions.ts y de app/api/mostrador/** no se
 * exportan: van copiados textualmente del commit fbcf149.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { z } from "zod";
import {
  aplicarDescuento,
  importePorMedio,
  medioPrincipal,
  normalizarPagos,
  revisarPagos,
  revisarVenta,
  totalDeLaVenta,
  type LineaDeVenta,
  type MedioDeMostrador,
  type PagoDeVenta,
} from "../../lib/mostrador/importes";
import { medioDeMostradorSchema, pagoDeMostradorSchema } from "./originales/esquemas-mostrador";
import { descuentoPorMedioDePago, medioPermitido, montoDelDescuentoDePago, type EscalaDePago } from "../../lib/precios/medio-pago";
import { factorDeStock, precioDeMedia, unidadesDeStock, type ProductoQueSeVende } from "../../lib/ventas/forma-de-venta";
import { fechaAcotada } from "../../lib/mostrador/offline/numero-provisorio";
import { ordenarClientes, puntajeDeCliente } from "../../lib/mostrador/ranking-clientes";
import { normalizar } from "../../lib/mostrador/offline/busqueda-local";
import { nombreDeLaDiferencia } from "../../lib/mostrador/arqueo";

if (new Date().getTimezoneOffset() !== 0) throw new Error("Correlo con TZ=UTC");

let semilla = 20261029;
const azar = () => {
  semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
  return semilla / 2 ** 31;
};
const entero = (n: number) => Math.floor(azar() * n);
const uno = <T,>(xs: readonly T[]): T => xs[entero(xs.length)]!;

const medios: MedioDeMostrador[] = ["efectivo", "debito", "credito", "transferencia", "cuenta_corriente", "cheque"];
const U = (n: number) => `8f2b5c1e-1d2a-4c3b-9a8e-${String(n).padStart(12, "0")}`;

/* ------------------------------ importes ------------------------------ */

const precioAlAzar = () =>
  uno([
    () => Math.round(azar() * 1e7) / 100,
    () => Math.round(azar() * 1e5) / 100,
    () => entero(100000),
    () => 0,
    () => Math.round(azar() * 1e9) / 1000,
    () => -Math.round(azar() * 100),
  ])();
const cantidadAlAzar = () =>
  uno([() => 1 + entero(20), () => Math.round(azar() * 1000) / 100, () => 0.5, () => 0, () => -1, () => Math.round(azar() * 1e5) / 1000])();

function lineasAlAzar(): LineaDeVenta[] {
  return Array.from({ length: entero(6) }, (_, i) => ({
    variantId: azar() < 0.8 ? U(i) : null,
    descripcion: `Línea ${i}`,
    unidad: "unidad",
    cantidad: cantidadAlAzar(),
    precioUnitario: precioAlAzar(),
  }));
}

function pagosAlAzar(total: number): PagoDeVenta[] | undefined {
  if (azar() < 0.3) return undefined;
  const n = entero(6);
  const pagos: PagoDeVenta[] = [];
  let resto = total;
  for (let i = 0; i < n; i++) {
    const medio = uno(medios);
    const importe = i === n - 1 && azar() < 0.7 ? resto : uno([() => Math.round(azar() * resto * 100) / 100, () => 0, () => -5, () => Math.round(azar() * 1e6) / 1000])();
    resto = Math.round((resto - importe) * 100) / 100;
    const p: PagoDeVenta = { medio, importe };
    if (medio === "cheque" && azar() < 0.85) {
      p.cheque = {
        tipo: uno(["fisico", "echeq"] as const),
        numero: uno(["", "12", "0012-3456", "00123456", "123456789012345678901", "a1b2c3d4"]),
        banco: uno(["Nación", " ", "", "Galicia"]),
        fechaPago: uno(["2026-11-01", "01/11/2026", "2026-1-1", ""]),
      };
    }
    pagos.push(p);
  }
  return pagos;
}

const ventas: unknown[] = [];
for (let i = 0; i < 4000; i++) {
  const lineas = lineasAlAzar();
  const medio = uno(medios);
  const cliente = azar() < 0.5 ? U(99) : null;
  const subtotal = totalDeLaVenta(lineas);
  const pedido = uno([0, 0, -10, Math.round(azar() * subtotal * 100) / 100, Math.round(subtotal * 13) / 100, subtotal * 2]);
  const { lineas: rebajadas, descuento } = aplicarDescuento(lineas, pedido);
  const total = totalDeLaVenta(rebajadas);
  const pagos = pagosAlAzar(total);
  const normales = normalizarPagos(pagos, medio, total);
  ventas.push({
    lineas,
    medio,
    cliente,
    pedido,
    pagos: pagos ?? null,
    revisar: revisarVenta(lineas, medio, cliente),
    subtotal,
    rebajadas: rebajadas.map((l) => l.precioUnitario),
    descuento,
    total,
    normales,
    revisarPagos: revisarPagos(normales, total, cliente),
    principal: medioPrincipal(normales),
    efectivo: importePorMedio(normales, "efectivo"),
    cuenta: importePorMedio(normales, "cuenta_corriente"),
  });
}

/* ---------------------- descuentos y forma de venta ---------------------- */

const escalas: unknown[] = [];
for (let i = 0; i < 2000; i++) {
  const lista: EscalaDePago[] = Array.from({ length: entero(5) }, (_, j) => ({
    medio: uno(["efectivo", "transferencia", "debito"]),
    desdeMonto: uno([0, 100000, 500000, Math.round(azar() * 1e6)]),
    porcentaje: uno([0, 5, 10, 15, 95, Math.round(azar() * 2000) / 100]),
    etiqueta: `Escala ${j}`,
  }));
  const medio = uno(["efectivo", "transferencia", "debito", "credito"]);
  const total = uno([0, Math.round(azar() * 1e8) / 100, 500000, -1]);
  const elegida = descuentoPorMedioDePago(lista, medio, total);
  escalas.push({
    lista,
    medio,
    total,
    elegida,
    monto: elegida ? montoDelDescuentoDePago(total, elegida.porcentaje) : montoDelDescuentoDePago(total, uno([0, 10, 120])),
  });
}
const permitidos = medios.flatMap((m) => [true, false].map((mayorista) => ({ m, mayorista, r: medioPermitido(m, mayorista) })));

const formas: unknown[] = [];
for (let i = 0; i < 3000; i++) {
  const p: ProductoQueSeVende = {
    unit: uno(["placa", "unidad", "metro_lineal"]),
    formaDeVenta: uno(["entera", "entera_o_media", "metro_cuadrado"] as const),
    precioMediaPct: uno([50, 55, 60, Math.round(azar() * 10000) / 100]),
    largoMm: uno([null, 0, 2750, 2440, 1 + entero(4000)]),
    anchoMm: uno([null, 1830, 1220, 1 + entero(2000)]),
  };
  const presentacion = uno([null, "media_largo", "media_ancho"] as const);
  const cantidad = cantidadAlAzar();
  let factor: number | string;
  try {
    factor = factorDeStock(p, presentacion);
  } catch (e) {
    factor = (e as Error).message;
  }
  const precio = precioAlAzar();
  formas.push({
    p,
    presentacion,
    cantidad,
    factor,
    unidades: typeof factor === "number" ? unidadesDeStock(cantidad, factor) : null,
    precio,
    media: precioDeMedia(precio, p.precioMediaPct),
  });
}

/* ------------------------------ fechas ------------------------------ */

const ahora = new Date("2026-10-29T15:00:00.000Z");
const fechas = Array.from({ length: 300 }, () => {
  const delta = Math.round((azar() - 0.7) * 20 * 86_400_000);
  const reclamada = new Date(ahora.getTime() + delta);
  return { reclamada: reclamada.toISOString(), r: fechaAcotada(reclamada, ahora).toISOString() };
});

/* ------------------------- clientes y arqueo ------------------------- */

const nombres = ["García", "Garcia Hnos", "José Pérez", "Maderas del Sur SRL", "  ana   maría ", "Ñandú", "Gómez", "gomez", "Álvarez", "Zapata"];
const cuits = [null, "20-12345678-6", "20123456786", "30-71234567-1", "12345678", ""];
const ordenes: unknown[] = [];
for (let i = 0; i < 1000; i++) {
  const clientes = Array.from({ length: 1 + entero(8) }, (_, j) => ({
    id: U(j),
    nombre: uno(nombres),
    razonSocial: uno([null, "", ...nombres]),
    cuit: uno(cuits),
  }));
  const consulta = uno(["gar", "García", "perez", "12345678", "2012345678", "1234", "maria", "ñan", "", "sur", "  JOSÉ "]);
  const recientes = clientes.filter(() => azar() < 0.3).map((c) => c.id);
  ordenes.push({
    clientes,
    consulta,
    recientes,
    puntajes: clientes.map((c) => puntajeDeCliente(c, consulta)),
    orden: ordenarClientes(clientes, consulta, recientes).map((c) => clientes.indexOf(c)),
  });
}
const normalizados = [...nombres, "MADERA\tDURA", "  x  ", "Piñón", "àéîõü"].map((t) => ({ t, r: normalizar(t) }));
const diferencias = [-1000, -1.01, -1, -0.5, 0, 0.99, 1, 1.0000001, 250].map((d) => ({ d, r: nombreDeLaDiferencia(d) }));

/* ------------------------------ esquemas ------------------------------ */
// Copias textuales (fbcf149).

const lineaAccion = z.object({
  variantId: z.string().uuid().nullable(),
  descripcion: z.string().min(1),
  unidad: z.string().min(1),
  cantidad: z.number().positive(),
  precioUnitario: z.number().min(0),
  presentacion: z.enum(["media_largo", "media_ancho"]).nullable().optional(),
});
const ventaAccion = z.object({
  clave: z.string().uuid(),
  branchId: z.string().uuid(),
  lineas: z.array(lineaAccion).min(1),
  customerId: z.string().uuid().nullable(),
  contactoNombre: z.string().min(1),
  contactoTelefono: z.string().nullable().optional(),
  medioPago: medioDeMostradorSchema,
  pagos: z.array(pagoDeMostradorSchema).max(4).optional(),
  acopio: z.boolean().optional(),
  comprobante: z.enum(["interno", "fiscal"]).default("interno"),
  cuit: z.string().nullable().optional(),
  descuento: z.number().min(0).optional(),
  descuentoMotivo: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  autorizado: z.boolean().optional(),
  corte: z
    .object({
      variantId: z.string().uuid().nullable(),
      materialDescripcion: z.string().trim().min(2).max(200),
      cantoDescripcion: z.string().trim().max(120).nullable(),
      placaLargoMm: z.coerce.number().int().positive().max(6000).nullable(),
      placaAnchoMm: z.coerce.number().int().positive().max(6000).nullable(),
      mitad: z.enum(["largo", "ancho"]).nullable(),
      placas: z.coerce.number().int().min(1).max(999),
      pasadas: z.coerce.number().int().min(0).max(9999),
      acomodoManual: z.string().max(20_000).nullable(),
      anchoSierraMm: z.number().min(0.5).max(10).nullable().optional(),
      piezas: z
        .array(
          z.object({
            largoMm: z.coerce.number().int().positive().max(10_000),
            anchoMm: z.coerce.number().int().positive().max(10_000),
            cantidad: z.coerce.number().int().positive().max(999),
            respetaVeta: z.coerce.number().int().min(0).max(1),
            cantoLargo: z.coerce.number().int().min(0).max(2),
            cantoAncho: z.coerce.number().int().min(0).max(2),
            etiqueta: z.string().trim().max(120).nullable(),
            aclaracion: z.string().trim().max(200).nullable(),
          }),
        )
        .min(1)
        .max(500),
    })
    .optional(),
});

const lineaCola = z.object({
  variantId: z.string().uuid().nullable(),
  descripcion: z.string().min(1),
  unidad: z.string().default("unidad"),
  cantidad: z.number().positive(),
  precioUnitario: z.number().min(0),
  presentacion: z.enum(["media_largo", "media_ancho"]).nullable().optional(),
});
const ventaCola = z.object({
  clave: z.string().uuid(),
  branchId: z.string().uuid(),
  lineas: z.array(lineaCola).min(1),
  customerId: z.string().uuid().nullable(),
  contactoNombre: z.string().min(1),
  contactoTelefono: z.string().nullable().optional(),
  medioPago: medioDeMostradorSchema,
  pagos: z.array(pagoDeMostradorSchema).max(4).optional(),
  acopio: z.boolean().optional(),
  comprobante: z.enum(["interno", "fiscal"]).default("interno"),
  cuit: z.string().nullable().optional(),
  descuento: z.number().min(0).optional(),
  descuentoMotivo: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
  numeroProvisorio: z.string().min(1).max(40),
  cobradaAt: z.string().datetime(),
  usuarioId: z.string().optional(),
});
const cuerpoCola = z.object({ ventas: z.array(ventaCola).min(1).max(25) });

const movimientoCaja = z.object({
  clave: z.string().uuid(),
  branchId: z.string().uuid(),
  tipo: z.enum(["ingreso", "retiro"]),
  monto: z.number().positive(),
  motivo: z.string().min(1),
  hechoAt: z.string().datetime(),
});

const presupuestoMostrador = z.object({
  branchId: z.string().uuid(),
  lineas: z.array(lineaAccion).min(1),
  customerId: z.string().uuid().nullable(),
  contactoNombre: z.string().min(1),
  contactoTelefono: z.string().nullable().optional(),
  notas: z.string().max(1000).nullable().optional(),
});

const altaRapida = z.object({
  nombre: z.string().trim().min(2, "Poné el nombre o la razón social.").max(160),
  documento: z.string().trim().max(20),
  condicionIva: z.enum(["responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"]),
  telefono: z.string().trim().max(40).optional(),
  rubro: z.string().trim().max(40).optional(),
});

// Las muestras válidas, y de ahí miles de mutaciones.
const lineaBuena = () => ({ variantId: U(1), descripcion: "Fenólico 18 mm", unidad: "placa", cantidad: 2, precioUnitario: 45000.5, presentacion: null });
const pagoBueno = () => ({ medio: "cheque", importe: 1000, nroLote: null, nroCupon: "12", cuotas: 3, tarjeta: null, cheque: { tipo: "fisico", numero: "00123456", banco: "Nación", fechaPago: "2026-11-01", librador: null } });
const corteBueno = () => ({
  variantId: U(1),
  materialDescripcion: " MDF 18 ",
  cantoDescripcion: null,
  placaLargoMm: 2750,
  placaAnchoMm: "1830",
  mitad: null,
  placas: 1,
  pasadas: 4,
  acomodoManual: null,
  anchoSierraMm: 4.4,
  piezas: [{ largoMm: 600, anchoMm: "400", cantidad: 2, respetaVeta: 0, cantoLargo: 1, cantoAncho: 0, etiqueta: " A ", aclaracion: null }],
});
const ventaAccionBuena = () => ({
  clave: U(10),
  branchId: U(11),
  lineas: [lineaBuena(), { ...lineaBuena(), variantId: null, presentacion: "media_largo" }],
  customerId: null,
  contactoNombre: "Consumidor final",
  contactoTelefono: null,
  medioPago: "efectivo",
  pagos: [pagoBueno()],
  acopio: false,
  cuit: null,
  descuento: 0,
  descuentoMotivo: null,
  notas: null,
  autorizado: false,
  corte: corteBueno(),
});
const ventaColaBuena = () => {
  const { autorizado: _a, corte: _c, ...v } = ventaAccionBuena();
  return { ...v, comprobante: "interno", numeroProvisorio: "CAJA1-017", cobradaAt: "2026-10-29T12:00:00.000Z", usuarioId: "u1" };
};
const movimientoBueno = () => ({ clave: U(20), branchId: U(11), tipo: "retiro", monto: 1500, motivo: "Proveedor", hechoAt: "2026-10-29T12:00:00Z" });
const presupuestoBueno = () => ({ branchId: U(11), lineas: [lineaBuena()], customerId: U(12), contactoNombre: "Ana", contactoTelefono: "11", notas: "x" });
const altaBuena = () => ({ nombre: " Ana Gómez ", documento: "20-12345678-6", condicionIva: "consumidor_final", telefono: "11 5555", rubro: "carpintero" });

const valoresRaros: unknown[] = [
  undefined, null, "", " ", "x", "  ab  ", "abc", "no-uuid", U(5), "00000000-0000-0000-0000-000000000000", "8f2b5c1e-1d2a-0c3b-9a8e-111111111111",
  0, -1, 1, 0.5, 2.5, 1e9, 6001, 10001, "12", "1.5", "abc1", true, false, [], {}, [{}], "2026-10-29T12:00:00Z", "2026-10-29T12:00:00.123456Z",
  "2026-10-29T12:00:00+03:00", "2026-02-29T00:00:00Z", "2028-02-29T00:00:00Z", "2026-10-29 12:00", "x".repeat(41), "x".repeat(121), "x".repeat(201),
  "efectivo", "cheque", "fiscal", "interno", "largo", "media_ancho", "ingreso", "retiro", "monotributista", "echeq", "2026-11-01", 24, 25, 1000,
];

type Ruta = (string | number)[];
function rutasDe(v: unknown, ruta: Ruta = []): Ruta[] {
  const out: Ruta[] = ruta.length ? [ruta] : [];
  if (Array.isArray(v)) v.forEach((x, i) => out.push(...rutasDe(x, [...ruta, i])));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) out.push(...rutasDe(x, [...ruta, k]));
  return out;
}
function poner(obj: unknown, ruta: Ruta, valor: unknown) {
  let o = obj as Record<string | number, unknown>;
  for (const k of ruta.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
  const ult = ruta[ruta.length - 1]!;
  if (valor === undefined) delete o[ult];
  else o[ult] = valor;
}

function casosDe(nombre: string, esquema: z.ZodTypeAny, buena: () => unknown, n: number) {
  const casos: { entrada: unknown; ok: boolean; ruta?: string; error?: string; datos?: unknown }[] = [];
  const correr = (cruda: unknown) => {
    // Lo que viaja por la red: un hueco de una lista llega como null.
    const entrada = JSON.parse(JSON.stringify(cruda)) as unknown;
    const r = esquema.safeParse(entrada);
    if (r.success) casos.push({ entrada, ok: true, datos: r.data });
    else casos.push({ entrada, ok: false, ruta: r.error.issues[0]!.path.join("."), error: r.error.issues[0]!.message });
  };
  correr(buena());
  correr(null);
  correr("x");
  correr([]);
  for (let i = 0; i < n; i++) {
    const e = buena();
    const cambios = 1 + entero(3);
    for (let c = 0; c < cambios; c++) {
      const rutas = rutasDe(e);
      if (rutas.length === 0) break;
      poner(e, uno(rutas), uno(valoresRaros));
    }
    // A veces, listas largas.
    if (azar() < 0.05 && e && typeof e === "object" && Array.isArray((e as { pagos?: unknown[] }).pagos)) {
      (e as { pagos: unknown[] }).pagos = Array.from({ length: 5 }, pagoBueno);
    }
    correr(e);
  }
  console.log(nombre, casos.length, casos.filter((c) => c.ok).length, "válidos");
  return casos;
}

const esquemas = {
  ventaAccion: casosDe("ventaAccion", ventaAccion, ventaAccionBuena, 3000),
  cuerpoCola: casosDe("cuerpoCola", cuerpoCola, () => ({ ventas: azar() < 0.1 ? [ventaColaBuena(), { ...ventaColaBuena(), pagos: undefined }] : [ventaColaBuena()] }), 3000),
  movimientoCaja: casosDe("movimientoCaja", movimientoCaja, movimientoBueno, 1500),
  presupuestoMostrador: casosDe("presupuestoMostrador", presupuestoMostrador, presupuestoBueno, 1500),
  altaRapida: casosDe("altaRapida", altaRapida, altaBuena, 1500),
};

/* ------------------------------ salida ------------------------------ */

const carpeta = "backend/testdata/golden/mostrador";
mkdirSync(carpeta, { recursive: true });
writeFileSync(
  `${carpeta}/logica.json`,
  JSON.stringify({ ventas, escalas, permitidos, formas, fechas, ordenes, normalizados, diferencias }, null, 0),
);
writeFileSync(`${carpeta}/esquemas.json`, JSON.stringify(esquemas, null, 0));
console.log("listo:", carpeta);
