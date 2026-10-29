import { presupuestoPdf } from "./ts/presupuesto";
import { desagregar } from "@/lib/fiscal/impuestos";
import type { PresupuestoCompleto } from "@/lib/dal/admin/ventas";
import type { DatosParaTransferir } from "@/lib/dal/pagos";
import { writeFileSync } from "node:fs";
import type { CasoPdf } from "../pdf";
import { EMISOR, EMISOR_LARGO, azarCon } from "./_azar";

const { entero, elegir, palabras, azar } = azarCon(1211);

type Emisor = Parameters<typeof presupuestoPdf>[1];

function caso(nombre: string, presupuesto: PresupuestoCompleto, emisor: Emisor, banco: DatosParaTransferir | null): CasoPdf {
  return { nombre, datos: { presupuesto, emisor, banco }, generar: () => presupuestoPdf(presupuesto, emisor, banco) };
}

const BANCO: DatosParaTransferir = {
  banco: "Banco de la Provincia de Buenos Aires",
  titular: "Maderera Juan B. Justo S.R.L.",
  cuit: "30-71234567-8",
  cbu: "0140123401234567890123",
  alias: "MADERA.JUSTO.PINO",
  instrucciones: null,
};

const importe = () => (azar() < 0.1 ? (azar() * 1e9).toFixed(2) : (azar() * 300000).toFixed(entero(3)));

function items(n: number): PresupuestoCompleto["items"] {
  return Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    variantId: azar() < 0.2 ? null : `v${i}`,
    descripcion: palabras(1 + entero(16)),
    unidad: elegir(["unidad", "metro_lineal", "metro_cuadrado", "kg", "tabla"]),
    cantidad: elegir(["1.000", "2.500", "12.000", "0.125"]),
    precioUnitario: importe(),
    subtotal: importe(),
    orden: i,
    alicuotaIva: elegir([null, "21.00", "10.50", "27.00", "0.00", ""]),
  })) as PresupuestoCompleto["items"];
}

function base(extra: Partial<PresupuestoCompleto> = {}): PresupuestoCompleto {
  return {
    id: "p1",
    numero: "P-000123",
    cliente: "Carolina Méndez",
    email: null,
    telefono: null,
    empresa: "Estudio Méndez & Asoc.",
    customerId: "c1",
    clienteCodigo: "C-4471",
    clienteCuit: "27-23456789-4",
    clienteCondicionIva: "responsable_inscripto",
    clienteDireccion: "Güemes 2900, Mar del Plata",
    sucursal: "Casa Central",
    sucursalSlug: "casa-central",
    vendedor: "Juan Pérez",
    estado: "enviado",
    origen: "mostrador",
    subtotal: "150000.00",
    total: "135000.00",
    notas: null,
    asesor: null,
    validoHasta: new Date("2026-03-20T03:00:00.000Z"),
    createdAt: new Date("2026-03-05T14:30:00.000Z"),
    items: items(4),
    ...extra,
  } as PresupuestoCompleto;
}

// Golden de desagregar: plata, comparación exacta en Go.
const casosDesagregar: { p: number; a: number; neto: number; iva: number; total: number; alicuota: number }[] = [];
for (const p of [0, 0.005, 0.015, 1.005, 121, 100, 1e9, -50, 99.995]) {
  for (const a of [0, 21, 10.5, 27, -1, NaN]) {
    const r = desagregar(p, a);
    casosDesagregar.push({ p, a: Number.isNaN(a) ? -999 : a, ...r, alicuota: Number.isNaN(r.alicuota) ? -999 : r.alicuota });
  }
}
for (let i = 0; i < 3000; i++) {
  const p = Number((azar() * 10 ** entero(9)).toFixed(entero(5)));
  const a = elegir([21, 10.5, 27, 0, 2.5, 5]);
  casosDesagregar.push({ p, a, ...desagregar(p, a) });
}
// El benchmark (bench/tanda12) importa los casos sin reescribir los golden.
if (!process.env.PDF_GOLDEN_SOLO_LEER) writeFileSync(
  new URL("../../../backend/testdata/golden/pdf/desagregar.json", import.meta.url),
  JSON.stringify(casosDesagregar) + "\n",
);

export const casos: CasoPdf[] = [
  caso("inscripto-con-banco", base(), EMISOR, BANCO),
  caso("consumidor-sin-banco", base({ clienteCondicionIva: null, empresa: null, clienteCuit: null, clienteCodigo: null, clienteDireccion: null, vendedor: null, asesor: "Ana (asesora)", validoHasta: null, sucursal: null, total: "150000.00" }), EMISOR, null),
  caso("monotributo-descuento", base({ clienteCondicionIva: "monotributista", subtotal: "1000000.00", total: "873456.78", notas: "Precio especial por volumen. " + palabras(60) }), EMISOR_LARGO, { ...BANCO, cbu: "", alias: "" }),
  caso("exento", base({ clienteCondicionIva: "exento", vendedor: null, asesor: null }), null, { ...BANCO, banco: "" }),
  caso("otra-condicion", base({ clienteCondicionIva: "rara_condicion" as never }), EMISOR, BANCO),
  caso("muchos-renglones", base({ items: items(90), subtotal: "9999999999.99", total: "9999999999.99" }), EMISOR, BANCO),
  caso("muchos-con-descuento", base({ items: items(45), subtotal: "500000", total: "1", notas: palabras(200) }), EMISOR, BANCO),
  caso("sin-items", base({ items: [], subtotal: "0", total: "0" }), EMISOR, null),
  ...Array.from({ length: 6 }, (_, i) =>
    caso(`azar-${i}`, base({
      clienteCondicionIva: elegir(["responsable_inscripto", "monotributista", "consumidor_final", null]),
      items: items(entero(40)),
      subtotal: importe(),
      total: importe(),
      notas: azar() < 0.5 ? palabras(entero(80)) : null,
      createdAt: new Date(Date.UTC(2020 + entero(8), entero(12), 1 + entero(28), entero(24))),
    }), EMISOR, azar() < 0.5 ? BANCO : null)),
];
