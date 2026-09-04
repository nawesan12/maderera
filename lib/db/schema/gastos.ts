import { relations } from "drizzle-orm";
import {
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { branches } from "./inventory";
import { purchaseInvoices, suppliers } from "./compras";

/**
 * Los gastos del negocio.
 *
 * **Va aparte de `purchaseInvoices` a propósito:** la factura es la capa
 * fiscal, el gasto la de gestión. Un gasto con factura tiene las dos filas
 * unidas por FK; una propina al fletero tiene solo la segunda. Una tabla sola
 * terminaría con la mitad de las columnas fiscales en cero y con nadie sabiendo
 * cuáles de esas filas cuentan para el IVA.
 *
 * Lo más cercano que había era el `retiro` de caja, que además exige turno
 * abierto: un gasto pagado por transferencia un domingo no tenía dónde
 * anotarse.
 */

export const categoriaGasto = pgEnum("categoria_gasto", [
  "flete",
  "combustible",
  "servicios",
  "alquiler",
  "sueldos",
  "mantenimiento",
  "impuestos",
  "librería",
  "publicidad",
  "otros",
]);

export const medioGasto = pgEnum("medio_gasto", [
  "efectivo",
  "transferencia",
  "debito",
  "credito",
  "cheque",
]);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid().primaryKey().defaultRandom(),

    fecha: timestamp({ withTimezone: true }).notNull().defaultNow(),
    categoria: categoriaGasto().notNull().default("otros"),
    descripcion: text().notNull(),

    /** Lo que salió, con IVA adentro si lo tiene. Es lo que se pagó. */
    importe: numeric({ precision: 12, scale: 2 }).notNull(),

    medio: medioGasto().notNull().default("efectivo"),

    branchId: uuid().references(() => branches.id),
    supplierId: uuid().references(() => suppliers.id, { onDelete: "set null" }),

    /**
     * La factura, cuando la hay.
     *
     * Es lo que separa el gasto que da crédito fiscal del que no. Sin esta
     * unión habría que elegir entre no registrar la propina al fletero o
     * inventarle una factura.
     */
    purchaseInvoiceId: uuid().references(() => purchaseInvoices.id, {
      onDelete: "set null",
    }),

    notas: text(),
    createdByUserId: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expenses_fecha_idx").on(t.fecha),
    index("expenses_categoria_idx").on(t.categoria),
    index("expenses_supplier_idx").on(t.supplierId),
  ],
);

export const expensesRelations = relations(expenses, ({ one }) => ({
  sucursal: one(branches, {
    fields: [expenses.branchId],
    references: [branches.id],
  }),
  proveedor: one(suppliers, {
    fields: [expenses.supplierId],
    references: [suppliers.id],
  }),
  factura: one(purchaseInvoices, {
    fields: [expenses.purchaseInvoiceId],
    references: [purchaseInvoices.id],
  }),
}));

export type Expense = typeof expenses.$inferSelect;
