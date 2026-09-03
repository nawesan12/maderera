import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { condicionIva } from "./profiles";

/**
 * Compras: proveedores y lo que se les debe.
 *
 * **Tres reglas gobiernan todo este módulo, y las tres invierten algo que en
 * ventas ya está escrito al revés.** Van acá arriba porque si no quedan
 * explícitas se rompen solas, y cada una de las tres roturas se ve recién dos
 * meses después, en un número que no cierra.
 *
 * 1. **En ventas el precio es final; en compras el número base es el neto.** El
 *    catálogo guarda precios con IVA adentro y `lib/fiscal/impuestos.ts` lo
 *    desagrega; el proveedor factura al revés: neto, después IVA. Todo lo de
 *    compras usa `agregarIva()` y nunca `desagregar()`. Cruzarlos es de donde
 *    salen los márgenes inflados un 21 %.
 *
 * 2. **En clientes, positivo = el cliente debe. En proveedores, positivo = le
 *    debemos.** Es el espejo natural, pero cambia de signo según quién mira, y
 *    copiar una consulta de cuenta corriente sin invertirlo da un saldo con el
 *    signo cambiado que igual parece razonable.
 *
 * 3. **El promedio ponderado no es reversible.** Anular una recepción baja la
 *    cantidad y **no toca el costo**: revertir la mezcla exigiría recalcular
 *    toda la historia posterior, y la historia posterior ya se usó para decidir
 *    precios.
 */

export const estadoProveedor = pgEnum("estado_proveedor", [
  "activo",
  "inactivo",
]);

/**
 * El proveedor.
 *
 * Es el espejo de `customers` menos cuatro cosas que no tienen sentido de este
 * lado: `userId` (un proveedor no se loguea en el sitio), `priceListId` (no se
 * le vende), `tipo` y `limiteCredito` (el tope de crédito lo pone él, no
 * nosotros). Y suma tres que solo existen acá: los días de pago acordados, el
 * CBU donde se le transfiere y con quién se habla.
 */
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text().notNull(),
    razonSocial: text(),
    cuit: text(),
    condicionIva: condicionIva().notNull().default("responsable_inscripto"),
    email: text(),
    telefono: text(),
    direccion: text(),
    rubro: text(),

    /** Con quién se habla del otro lado. Un proveedor es una persona. */
    contacto: text(),

    /** Días acordados de pago. Cero es contra entrega. */
    diasPago: integer().notNull().default(0),

    /** Para transferirle. Se guarda tal cual lo mandó, sin normalizar. */
    cbu: text(),
    aliasCbu: text(),

    estado: estadoProveedor().notNull().default("activo"),
    notas: text(),

    /**
     * Su código en el sistema anterior, igual que en clientes: es lo único que
     * permite volver a correr la importación sin duplicar la lista, y el
     * nombre por el que la maderera lo va a seguir llamando.
     */
    codigoLegacy: text(),

    active: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("suppliers_nombre_idx").on(t.nombre),
    index("suppliers_cuit_idx").on(t.cuit),
    uniqueIndex("suppliers_codigo_legacy_idx").on(t.codigoLegacy),
  ],
);

export const tipoMovimientoProveedor = pgEnum("tipo_movimiento_proveedor", [
  /** Nos facturó: la deuda sube. */
  "factura",
  /** Le pagamos: la deuda baja. */
  "pago",
  /** Nos acreditó una devolución o un error: la deuda baja. */
  "nota_credito",
  /** Nos cargó algo más sobre una factura ya emitida: la deuda sube. */
  "nota_debito",
  "ajuste",
]);

/**
 * La cuenta corriente del proveedor.
 *
 * Espejo de `accountMovements` con **el signo invertido**: positivo es lo que
 * le debemos. El saldo tampoco se guarda acá, se suma, por la misma razón: un
 * saldo cacheado se desincroniza en cuanto algo falla a la mitad, y esa
 * diferencia se descubre discutiendo por teléfono.
 *
 * A diferencia de la cuenta de clientes, la referencia a la factura es una **FK
 * real** y no texto libre. Acá importa más: el proveedor llama y pregunta por
 * la 0003-00001274, y hay que poder ir de ese número al movimiento y al revés
 * sin buscar por una cadena que alguien tipeó a mano.
 */
export const supplierMovements = pgTable(
  "supplier_movements",
  {
    id: uuid().primaryKey().defaultRandom(),
    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),

    tipo: tipoMovimientoProveedor().notNull(),

    /** Con signo, como en el resto del proyecto: el saldo es una suma sola. */
    monto: numeric({ precision: 12, scale: 2 }).notNull(),

    detalle: text(),

    /**
     * Cómo lo nombra el proveedor: "0003-00001274". Se guarda además de la FK
     * porque un movimiento puede referirse a un comprobante que todavía no se
     * cargó, y porque es lo que se busca cuando llaman.
     */
    referencia: text(),

    createdByUserId: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("supplier_movements_supplier_idx").on(t.supplierId),
    index("supplier_movements_created_idx").on(t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Recepciones                                                                 */
/* -------------------------------------------------------------------------- */

export const estadoRecepcion = pgEnum("estado_recepcion", [
  /** Se está cargando. No tocó el stock ni el costo todavía. */
  "borrador",
  "confirmada",
  "anulada",
]);

/**
 * La mercadería que entró, con el remito en la mano.
 *
 * Es el documento que ingresa stock **y** mueve el costo, y son dos cosas
 * distintas que pasan juntas: el stock es físico y el costo es plata. Por eso
 * la recepción tiene estado: mientras es borrador no tocó nada, y confirmar es
 * el acto que mueve las dos cosas en una transacción.
 *
 * **La factura es otro documento.** Llega después, a veces por otro camino y
 * con otro número, y a veces cubre tres remitos. Mezclarlas obligaría a esperar
 * la factura para poder vender lo que ya está en el depósito.
 */
export const goodsReceipts = pgTable(
  "goods_receipts",
  {
    id: uuid().primaryKey().defaultRandom(),

    supplierId: uuid()
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),

    /** Adónde entró. El stock es por sucursal aunque el costo no lo sea. */
    branchId: uuid().notNull(),

    /** Como lo numeró el proveedor: "0002-00034512". */
    numeroRemito: text(),

    /** Cuándo entró de verdad, que puede no ser cuándo se cargó. */
    fecha: timestamp({ withTimezone: true }).notNull().defaultNow(),

    /**
     * Flete y demás gastos de la entrega, netos.
     *
     * Se reparten entre las líneas en proporción a su valor: el flete de un
     * camión con veinte tablas y un tornillo no se divide en dos.
     */
    gastos: numeric({ precision: 12, scale: 2 }).notNull().default("0"),

    estado: estadoRecepcion().notNull().default("borrador"),
    notas: text(),

    confirmadaAt: timestamp({ withTimezone: true }),
    confirmadaPor: text().references(() => user.id),

    createdByUserId: text().references(() => user.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("goods_receipts_supplier_idx").on(t.supplierId),
    index("goods_receipts_fecha_idx").on(t.fecha),
    /*
     * Un remito por proveedor. Es lo que impide cargar dos veces la misma
     * entrega, que además de duplicar el stock **corrompe el costo promedio**,
     * y el costo promedio no se puede revertir.
     */
    uniqueIndex("goods_receipts_remito_idx").on(t.supplierId, t.numeroRemito),
  ],
);

/**
 * Cada renglón de la recepción, con la cuenta del costo escrita.
 *
 * Guarda **los cuatro números que explican la mezcla**: cuánto había y a
 * cuánto, cuánto costó lo que entró con los gastos adentro, y con qué costo
 * quedó. Es lo que permite auditar una recepción de hace ocho meses sin rehacer
 * toda la historia posterior, que es exactamente lo que no se puede hacer
 * porque el promedio ponderado no es reversible.
 */
export const goodsReceiptItems = pgTable(
  "goods_receipt_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    receiptId: uuid()
      .notNull()
      .references(() => goodsReceipts.id, { onDelete: "cascade" }),

    variantId: uuid().notNull(),

    cantidad: numeric({ precision: 14, scale: 4 }).notNull(),

    /** Lo que facturó el proveedor por unidad, **neto**. */
    costoUnitario: numeric({ precision: 14, scale: 4 }).notNull(),

    /** Con qué IVA vino. Hace falta para el libro de compras. */
    alicuotaIva: numeric({ precision: 5, scale: 2 }).notNull().default("21"),

    /* ---- La cuenta, escrita al confirmar ---- */

    /** El costo unitario con la parte de flete que le tocó. */
    costoConGastos: numeric({ precision: 14, scale: 4 }),
    cantidadAnterior: numeric({ precision: 14, scale: 4 }),
    costoAnterior: numeric({ precision: 14, scale: 4 }),
    costoResultante: numeric({ precision: 14, scale: 4 }),

    orden: integer().notNull().default(0),
  },
  (t) => [index("goods_receipt_items_receipt_idx").on(t.receiptId)],
);

export const goodsReceiptsRelations = relations(
  goodsReceipts,
  ({ one, many }) => ({
    proveedor: one(suppliers, {
      fields: [goodsReceipts.supplierId],
      references: [suppliers.id],
    }),
    items: many(goodsReceiptItems),
  }),
);

export const goodsReceiptItemsRelations = relations(
  goodsReceiptItems,
  ({ one }) => ({
    recepcion: one(goodsReceipts, {
      fields: [goodsReceiptItems.receiptId],
      references: [goodsReceipts.id],
    }),
  }),
);

export type GoodsReceipt = typeof goodsReceipts.$inferSelect;
export type GoodsReceiptItem = typeof goodsReceiptItems.$inferSelect;

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  movimientos: many(supplierMovements),
  recepciones: many(goodsReceipts),
}));

export const supplierMovementsRelations = relations(
  supplierMovements,
  ({ one }) => ({
    proveedor: one(suppliers, {
      fields: [supplierMovements.supplierId],
      references: [suppliers.id],
    }),
  }),
);

export type Supplier = typeof suppliers.$inferSelect;
export type SupplierMovement = typeof supplierMovements.$inferSelect;
