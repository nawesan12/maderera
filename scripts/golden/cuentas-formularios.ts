/**
 * Golden de los formularios de la tanda 4: los esquemas de zod de la ficha
 * del cliente, el movimiento manual, la carga de un cheque, el vendedor y el
 * seguimiento. Están copiados tal cual de las acciones (git 8d995f7), que no
 * los exportan: lo que importa es que los corra zod. El Go
 * (internal/clientes, internal/cobros) tiene que dar el mismo primer error o
 * los mismos datos.
 *
 *   npx tsx scripts/golden/cuentas-formularios.ts
 */
import { writeFileSync } from "node:fs";
import { z } from "zod";

const clienteSchema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(2, "El nombre es obligatorio.").max(160),
  razonSocial: z.string().trim().max(160).optional(),
  cuit: z
    .string()
    .trim()
    .max(20)
    .optional()
    .refine((v) => !v || /^\d{2}-?\d{8}-?\d$/.test(v), "El CUIT tiene que tener 11 dígitos, con o sin guiones."),
  condicionIva: z.enum(["responsable_inscripto", "monotributista", "exento", "consumidor_final", "no_categorizado"]),
  tipo: z.enum(["particular", "profesional"]),
  email: z.string().trim().email("Revisá el correo.").optional().or(z.literal("")),
  telefono: z.string().trim().max(40).optional(),
  direccion: z.string().trim().max(200).optional(),
  rubro: z.string().trim().max(80).optional(),
  asesor: z.string().trim().max(60).optional(),
  sellerId: z.string().uuid().optional(),
  limiteCredito: z.string().default("0"),
  priceListId: z.string().uuid().optional(),
  notas: z.string().trim().max(1000).optional(),
});

const movimientoSchema = z.object({
  customerId: z.string().uuid(),
  tipo: z.enum(["compra", "nota_credito", "nota_debito", "ajuste"]),
  monto: z.string(),
  detalle: z.string().trim().max(200).optional(),
});

const vendedorSchema = z.object({
  id: z.string().uuid().optional(),
  nombre: z.string().trim().min(2, "Poné el nombre.").max(80),
  tipo: z.enum(["salon", "calle"]),
});

const gestionSchema = z.object({
  customerId: z.string().uuid("Elegí el cliente."),
  asunto: z.string().trim().min(3, "Escribí de qué se trata, aunque sea en tres palabras.").max(160),
  notas: z.string().trim().max(2000).optional(),
  proximaAccion: z.string().trim().optional(),
});

const U = "8f2b5c1e-1d2a-4c3b-9a8e-111111111111";
type Caso = Record<string, unknown>;
const base: Caso = { nombre: "Juan Pérez", condicionIva: "consumidor_final", tipo: "particular", email: "", limiteCredito: "0" };
const clientes: Caso[] = [
  base,
  { ...base, nombre: " J " },
  { ...base, nombre: "x".repeat(161) },
  { ...base, cuit: "30-58944525-9" },
  { ...base, cuit: "30589445259" },
  { ...base, cuit: "30 58944525 9" },
  { ...base, cuit: "3058944525" },
  { ...base, cuit: "30-58944525-9-1" },
  { ...base, cuit: "x".repeat(21) },
  { ...base, condicionIva: "otro" },
  { ...base, tipo: "empresa" },
  { ...base, email: "juan@x" },
  { ...base, email: "  juan@mjbj.com.ar  " },
  { ...base, email: "Juan <j@x.com>" },
  { ...base, telefono: "1".repeat(41) },
  { ...base, sellerId: "no" },
  { ...base, priceListId: U, sellerId: U, id: U, razonSocial: " Pérez SRL ", rubro: "Carpintero", asesor: "Ana", notas: "  ok  " },
  { ...base, id: "x" },
  { ...base, limiteCredito: "$ 1.500.000,50" },
  { ...base, notas: "n".repeat(1001) },
  { ...base, nombre: "", cuit: "1" },
];
const limites = ["0", "", "1500000", "$ 1.500.000,50", "1.500.000", "1500000.5", "-200", "abc", "1.2.3", "250.000,99", "1e3"].map((t) => ({
  t,
  // La cuenta de guardarCliente.
  r: (Number(t.replace(/[^\d.-]/g, "")) || 0).toFixed(2),
}));
const movimientos: Caso[] = [
  { customerId: U, tipo: "compra", monto: "1000" },
  { customerId: "x", tipo: "compra", monto: "1000" },
  { customerId: U, tipo: "pago", monto: "1000" },
  { customerId: U, tipo: "ajuste", monto: "-1.234,5", detalle: "  corrección  " },
  { customerId: U, tipo: "nota_credito", monto: "10", detalle: "d".repeat(201) },
];
const vendedores: Caso[] = [
  { nombre: "Ana", tipo: "salon" },
  { nombre: "A", tipo: "salon" },
  { nombre: "Ana", tipo: "moto" },
  { id: "x", nombre: "Ana", tipo: "calle" },
  { nombre: "n".repeat(81), tipo: "calle" },
];
const gestiones: Caso[] = [
  { customerId: U, asunto: "Llamar por la deuda" },
  { customerId: "", asunto: "Llamar" },
  { customerId: U, asunto: "ab" },
  { customerId: U, asunto: "Cobrar", notas: "n".repeat(2001) },
  { customerId: U, asunto: "Cobrar", proximaAccion: " 2026-11-05 " },
];

const correr = (esquema: z.ZodTypeAny, casos: Caso[]) =>
  casos.map((entrada) => {
    const r = esquema.safeParse(entrada);
    return r.success ? { entrada, datos: r.data } : { entrada, error: r.error.issues[0]?.message, campo: r.error.issues[0]?.path.join(".") };
  });

const destino = new URL("../../backend/testdata/golden/cuentas/formularios.json", import.meta.url);
writeFileSync(
  destino,
  JSON.stringify(
    {
      clientes: correr(clienteSchema, clientes),
      limites,
      movimientos: correr(movimientoSchema, movimientos),
      vendedores: correr(vendedorSchema, vendedores),
      gestiones: correr(gestionSchema, gestiones),
    },
    null,
    1,
  ) + "\n",
);
console.log(`formularios de la tanda 4 en ${destino.pathname}`);
