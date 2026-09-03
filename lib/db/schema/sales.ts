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
import { branches } from "./inventory";
import { customers } from "./customers";
import { productVariants } from "./catalog";

/* -------------------------------------------------------------------------- */
/* Presupuestos                                                                */
/* -------------------------------------------------------------------------- */

export const estadoPresupuesto = pgEnum("estado_presupuesto", [
  "pendiente",
  "revision",
  "enviado",
  "aceptado",
  "rechazado",
  "vencido",
]);

/**
 * De dónde salió: el presupuestador del sitio, la calculadora o el mostrador.
 *
 * `express` es el del portal de profesionales (cláusula 1.7): mismo objeto, pero
 * con un compromiso de respuesta en 24 horas. No es un tipo distinto de
 * presupuesto, es una promesa distinta sobre cuándo se contesta, y por eso va
 * como origen y no como tabla aparte.
 */
export const origenPresupuesto = pgEnum("origen_presupuesto", [
  "sitio",
  "calculadora",
  "mostrador",
  "telefono",
  "express",
]);

export const quotes = pgTable(
  "quotes",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Número visible, del estilo P-2026-0421. */
    numero: text().notNull(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    /** Datos de contacto de quien pidió, aunque todavía no sea cliente cargado. */
    contactoNombre: text().notNull(),
    contactoEmail: text(),
    contactoTelefono: text(),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    estado: estadoPresupuesto().notNull().default("pendiente"),
    origen: origenPresupuesto().notNull().default("mostrador"),
    subtotal: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    total: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    notas: text(),
    asesor: text(),
    /** Hasta cuándo vale. Los precios se mueven y un presupuesto viejo no obliga. */
    validoHasta: timestamp({ withTimezone: true }),
    /**
     * Cuándo vence el compromiso de respuesta.
     *
     * Solo lo tienen los express. Sirve para ordenar la cola por urgencia real
     * y para que el panel muestre en rojo lo que se está por pasar de hora: un
     * SLA que nadie ve es un SLA que no se cumple.
     */
    respondeHasta: timestamp({ withTimezone: true }),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("quotes_numero_idx").on(t.numero),
    index("quotes_customer_idx").on(t.customerId),
    index("quotes_estado_idx").on(t.estado),
    index("quotes_created_idx").on(t.createdAt),
  ],
);

/**
 * Línea de presupuesto.
 *
 * Guarda la descripción y el precio del momento además del `variantId`. Un
 * presupuesto es una oferta con fecha: si después cambia el precio de lista o se
 * da de baja el producto, el papel que recibió el cliente tiene que seguir
 * diciendo lo mismo.
 */
export const quoteItems = pgTable(
  "quote_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    quoteId: uuid()
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, {
      onDelete: "set null",
    }),
    descripcion: text().notNull(),
    unidad: text().notNull().default("unidad"),
    cantidad: numeric({ precision: 12, scale: 2 }).notNull(),
    precioUnitario: numeric({ precision: 12, scale: 2 }).notNull(),
    subtotal: numeric({ precision: 12, scale: 2 }).notNull(),
    notas: text(),
    orden: integer().notNull().default(0),
  },
  (t) => [index("quote_items_quote_idx").on(t.quoteId)],
);

/* -------------------------------------------------------------------------- */
/* Pedidos                                                                     */
/* -------------------------------------------------------------------------- */

export const estadoPedido = pgEnum("estado_pedido", [
  "pendiente",
  "preparando",
  "listo",
  "en-camino",
  "entregado",
  "cancelado",
]);

export const tipoEntrega = pgEnum("tipo_entrega", ["retiro", "envio"]);

export const origenPedido = pgEnum("origen_pedido", [
  "tienda",
  "mostrador",
  "telefono",
  "presupuesto",
]);

export const medioPago = pgEnum("medio_pago", [
  "mercado_pago",
  "transferencia",
  "efectivo",
  // Débito y crédito van separados a propósito: en el mostrador se rinden
  // distinto —el débito acredita al otro día y el crédito según el plan— y
  // juntarlos en "tarjeta" obligaría a desarmarlos después a mano.
  "debito",
  "credito",
  "cuenta_corriente",
]);

export const estadoPago = pgEnum("estado_pago", [
  "pendiente",
  "pagado",
  "parcial",
  "rechazado",
  "reintegrado",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    numero: text().notNull(),
    /**
     * Token de la página de seguimiento.
     *
     * El número de pedido es consecutivo y sin huecos —`PED-1000`, `PED-1001`,
     * `PED-1002`— porque se dice por teléfono y va en el remito. Eso lo vuelve
     * enumerable: con el número solo alcanzando para abrir `/pedido/…`,
     * cualquiera recorría la secuencia y se llevaba el nombre, el teléfono, la
     * dirección y la compra de **cada cliente de la maderera**.
     *
     * Así que el número identifica y el token autoriza. Quien tiene el enlace
     * ve su pedido —es lo que hace falta para el checkout sin cuenta— y quien
     * no lo tiene no ve nada, salvo que tenga sesión y el pedido sea suyo.
     */
    publicToken: uuid().notNull().defaultRandom(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    quoteId: uuid().references(() => quotes.id, { onDelete: "set null" }),
    contactoNombre: text().notNull(),
    contactoEmail: text(),
    contactoTelefono: text(),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    estado: estadoPedido().notNull().default("pendiente"),
    origen: origenPedido().notNull().default("mostrador"),
    tipoEntrega: tipoEntrega().notNull().default("retiro"),
    direccionEntrega: text(),
    /** Zona de envío elegida, para poder explicar el costo cobrado. */
    zonaEnvio: text(),
    costoEnvio: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    subtotal: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    /**
     * Descuento sobre el total, en plata.
     *
     * Se guarda aparte y no se deduce de `subtotal - total` porque en el medio
     * está el costo de envío: `total = subtotal + envío − descuento`, y con dos
     * incógnitas en una resta no se reconstruye ninguna.
     */
    descuento: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    /** Por qué se hizo. Un descuento sin motivo no se puede revisar después. */
    descuentoMotivo: text(),
    total: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    medioPago: medioPago(),
    estadoPago: estadoPago().notNull().default("pendiente"),
    notas: text(),
    /**
     * Clave que trae la pantalla del mostrador para que una venta no se cobre
     * dos veces.
     *
     * En el mostrador el riesgo no es el reintento de un proveedor sino la
     * mano: se toca "Cobrar", la pantalla tarda un segundo y se vuelve a tocar.
     * Sin esto salen dos pedidos, se descuenta dos veces el stock y se le cobra
     * dos veces al cliente que está parado ahí.
     *
     * La clave la genera el navegador al empezar la venta y viaja con ella. El
     * índice único es la garantía real: dos envíos simultáneos no pueden
     * insertar los dos, gane el que gane la carrera.
     */
    claveMostrador: text(),

    /**
     * El número que se llevó el cliente cuando la venta se hizo sin internet.
     *
     * Del estilo `CAJA1-017`, asignado por la máquina. El `numero` definitivo
     * lo pone el servidor al sincronizar, pero el papel que quedó en la mano
     * dice este, y por eso se conserva: es la única forma de encontrar la venta
     * cuando alguien vuelve con el ticket provisorio.
     */
    numeroProvisorio: text(),

    /**
     * La hora real en que se cobró, según el reloj del mostrador.
     *
     * `createdAt` se escribe con este valor **acotado** —nunca en el futuro,
     * nunca más de siete días atrás— porque de ahí salen las ventas del día y
     * el cierre de caja: si la conexión vuelve al otro día, las ventas de ayer
     * aparecerían como de hoy y la caja no cerraría. El valor crudo queda acá
     * para que un reloj mal puesto se pueda ver.
     */
    cobradaAt: timestamp({ withTimezone: true }),

    /** Cuándo llegó al servidor. `null` significa que nació en línea. */
    sincronizadaAt: timestamp({ withTimezone: true }),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_numero_idx").on(t.numero),
    uniqueIndex("orders_clave_mostrador_idx").on(t.claveMostrador),
    /*
     * Segunda línea de defensa contra una caja que duplique su contador, y lo
     * que permite buscar por el número que el cliente tiene en la mano.
     */
    uniqueIndex("orders_numero_provisorio_idx").on(t.numeroProvisorio),
    index("orders_customer_idx").on(t.customerId),
    index("orders_estado_idx").on(t.estado),
    index("orders_created_idx").on(t.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid().references(() => productVariants.id, {
      onDelete: "set null",
    }),
    descripcion: text().notNull(),
    unidad: text().notNull().default("unidad"),
    cantidad: numeric({ precision: 12, scale: 2 }).notNull(),
    precioUnitario: numeric({ precision: 12, scale: 2 }).notNull(),
    subtotal: numeric({ precision: 12, scale: 2 }).notNull(),
    orden: integer().notNull().default(0),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

/**
 * Cada cambio de estado, con quién lo hizo.
 *
 * "¿Quién dijo que este pedido estaba listo?" es una pregunta que aparece sola
 * cuando el cliente llega al mostrador y la mercadería no está preparada.
 */
export const orderStatusHistory = pgTable(
  "order_status_history",
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    estado: estadoPedido().notNull(),
    nota: text(),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("order_status_history_order_idx").on(t.orderId)],
);

/* -------------------------------------------------------------------------- */
/* Cortes de placa                                                             */
/* -------------------------------------------------------------------------- */

export const estadoCorte = pgEnum("estado_corte", [
  "en-cola",
  "en-proceso",
  "terminado",
  "retirado",
]);

export const cuttingOrders = pgTable(
  "cutting_orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    numero: text().notNull(),
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    orderId: uuid().references(() => orders.id, { onDelete: "set null" }),
    contactoNombre: text().notNull(),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    /** Placa que se va a cortar. */
    variantId: uuid().references(() => productVariants.id, {
      onDelete: "set null",
    }),
    materialDescripcion: text().notNull(),
    placas: integer().notNull().default(1),
    estado: estadoCorte().notNull().default("en-cola"),
    urgente: integer().notNull().default(0),
    notas: text(),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cutting_orders_numero_idx").on(t.numero),
    index("cutting_orders_estado_idx").on(t.estado),
  ],
);

/**
 * Piezas a cortar.
 *
 * Las medidas van en milímetros y en columnas separadas, no como texto libre:
 * son los números que después necesita el optimizador de la máquina para armar
 * el patrón de corte. Guardarlas como "60x40 (x4)" obligaría a volver a
 * tipearlas.
 */
export const cuttingItems = pgTable(
  "cutting_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    cuttingOrderId: uuid()
      .notNull()
      .references(() => cuttingOrders.id, { onDelete: "cascade" }),
    largoMm: integer().notNull(),
    anchoMm: integer().notNull(),
    cantidad: integer().notNull().default(1),
    /** Si la veta tiene que correr en un sentido, no se puede rotar la pieza. */
    respetaVeta: integer().notNull().default(0),
    cantoLargo: integer().notNull().default(0),
    cantoAncho: integer().notNull().default(0),
    etiqueta: text(),
    orden: integer().notNull().default(0),
  },
  (t) => [index("cutting_items_order_idx").on(t.cuttingOrderId)],
);

/**
 * Cómo se le arma el archivo a la máquina de corte.
 *
 * Una fila por perfil, editable desde el panel. Va a la base y no a una
 * constante del código porque **todavía no vimos un archivo real del taller**:
 * no sabemos qué programa usan para optimizar, ni qué columnas espera. Dejarlo
 * escrito en el código obligaría a un deploy para acertarle, y va a haber que
 * probar varias veces contra la máquina hasta que importe limpio.
 *
 * Es la misma decisión que se tomó con la migración desde el sistema anterior,
 * y por la misma razón.
 */
export const cuttingExportProfiles = pgTable(
  "cutting_export_profiles",
  {
    id: uuid().primaryKey().defaultRandom(),
    nombre: text().notNull(),
    /** Con qué programa se probó. Se completa después de la visita al taller. */
    programa: text(),
    separador: text().notNull().default(";"),
    conEncabezado: boolean().notNull().default(true),
    unidad: text().notNull().default("mm"),
    decimal: text().notNull().default(","),
    valorSi: text().notNull().default("Sí"),
    valorNo: text().notNull().default("No"),
    finDeLinea: text().notNull().default("crlf"),
    /** Las columnas y su orden, como JSON: `[{clave, encabezado}]`. */
    columnas: text().notNull(),
    /** El que se usa cuando el operador aprieta "Exportar" sin elegir. */
    porDefecto: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cutting_export_profiles_nombre_idx").on(t.nombre)],
);

export type CuttingExportProfile = typeof cuttingExportProfiles.$inferSelect;

/* -------------------------------------------------------------------------- */
/* Relaciones                                                                  */
/* -------------------------------------------------------------------------- */

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  customer: one(customers, {
    fields: [quotes.customerId],
    references: [customers.id],
  }),
  branch: one(branches, { fields: [quotes.branchId], references: [branches.id] }),
  items: many(quoteItems),
}));

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, { fields: [quoteItems.quoteId], references: [quotes.id] }),
  variant: one(productVariants, {
    fields: [quoteItems.variantId],
    references: [productVariants.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  quote: one(quotes, { fields: [orders.quoteId], references: [quotes.id] }),
  branch: one(branches, { fields: [orders.branchId], references: [branches.id] }),
  items: many(orderItems),
  historial: many(orderStatusHistory),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const cuttingOrdersRelations = relations(
  cuttingOrders,
  ({ one, many }) => ({
    customer: one(customers, {
      fields: [cuttingOrders.customerId],
      references: [customers.id],
    }),
    branch: one(branches, {
      fields: [cuttingOrders.branchId],
      references: [branches.id],
    }),
    piezas: many(cuttingItems),
  }),
);

export const cuttingItemsRelations = relations(cuttingItems, ({ one }) => ({
  cuttingOrder: one(cuttingOrders, {
    fields: [cuttingItems.cuttingOrderId],
    references: [cuttingOrders.id],
  }),
}));

export type Quote = typeof quotes.$inferSelect;
export type QuoteItem = typeof quoteItems.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type CuttingOrder = typeof cuttingOrders.$inferSelect;
export type CuttingItem = typeof cuttingItems.$inferSelect;
