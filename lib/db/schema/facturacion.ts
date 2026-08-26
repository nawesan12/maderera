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
import { condicionIva } from "./profiles";
import { orders } from "./sales";

/**
 * Facturación electrónica.
 *
 * Dos cosas gobiernan este modelo y conviene tenerlas presentes antes de
 * tocarlo:
 *
 * 1. **Un comprobante emitido no se edita ni se borra.** Si está mal, se
 *    corrige con una nota de crédito que lo referencia. Por eso acá no hay
 *    borrado y los importes se guardan en la fila en vez de recalcularse: la
 *    factura tiene que seguir diciendo lo mismo dentro de diez años, aunque el
 *    precio del producto haya cambiado veinte veces.
 *
 * 2. **La numeración no puede tener huecos.** ARCA controla que los
 *    comprobantes de un punto de venta sean correlativos, así que el número se
 *    asigna dentro de la misma transacción que crea la factura y con un lock,
 *    nunca antes ni "reservando".
 */

/* -------------------------------------------------------------------------- */
/* Datos del emisor                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Como tributa Ingresos Brutos.
 *
 * "local" es una sola provincia; "convenio_multilateral" es el regimen de quien
 * opera en varias y reparte la base imponible entre jurisdicciones. MJBJ tiene
 * dos sucursales, las dos en Buenos Aires, asi que hoy es local: el enum existe
 * para no tener que migrar si abren en otra provincia.
 */
export const regimenIibb = pgEnum("regimen_iibb", [
  "local",
  "convenio_multilateral",
  "exento",
  "no_inscripto",
]);

/**
 * Datos fiscales de la empresa. Una sola fila.
 *
 * Van en la base y no en variables de entorno porque el CUIT, la razón social y
 * el domicilio se imprimen en cada comprobante y los tiene que poder cargar y
 * corregir el cliente, sin depender de un despliegue.
 */
export const configuracionFiscal = pgTable("configuracion_fiscal", {
  id: uuid().primaryKey().defaultRandom(),
  razonSocial: text().notNull().default("Maderera Juan B. Justo"),
  nombreFantasia: text(),
  cuit: text(),
  condicionIva: condicionIva().notNull().default("responsable_inscripto"),
  domicilio: text(),
  localidad: text().notNull().default("Mar del Plata"),
  codigoPostal: text(),
  telefono: text(),
  email: text(),
  /* Ingresos Brutos: es provincial y convive con lo nacional en el mismo
     comprobante. Se separa el numero de inscripcion del regimen porque una
     empresa con sucursales en mas de una provincia tributa por Convenio
     Multilateral y eso cambia como se liquida. */
  ingresosBrutos: text(),
  regimenIibb: regimenIibb().notNull().default("local"),
  /** Alicuota de percepcion de IIBB que se aplica a los clientes, si percibe. */
  alicuotaPercepcionIibb: numeric({ precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  /** Si esta empresa actua como agente de percepcion de IIBB. */
  percibeIibb: boolean().notNull().default(false),
  inicioActividades: timestamp({ withTimezone: true }),
  /** Pie de página de los comprobantes: leyendas, condiciones de venta. */
  leyenda: text(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Puntos de venta habilitados en ARCA.
 *
 * Tabla propia y no una constante porque todavía no está decidido si va uno
 * para toda la plataforma o uno por sucursal, y esa decisión afecta la
 * numeración fiscal de forma irreversible: no se puede reordenar después.
 * Modelado así, las dos opciones entran sin migrar nada — `branchId` en null
 * significa "sirve para toda la empresa".
 */
export const puntosVenta = pgTable(
  "puntos_venta",
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Número de punto de venta según ARCA (1, 2, 3…). */
    numero: integer().notNull(),
    nombre: text().notNull(),
    branchId: uuid().references(() => branches.id, { onDelete: "set null" }),
    /** Modalidad habilitada en ARCA. Los webservices exigen "webservice". */
    modalidad: text().notNull().default("webservice"),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("puntos_venta_numero_idx").on(t.numero)],
);

/* -------------------------------------------------------------------------- */
/* Comprobantes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Tipo de comprobante.
 *
 * La letra no se elige a gusto: sale de cruzar la condición frente al IVA del
 * emisor con la del receptor. Un responsable inscripto le factura A a otro
 * responsable inscripto y B a todos los demás; un monotributista emite siempre
 * C. La lógica vive en `lib/fiscal/comprobantes.ts`.
 */
export const tipoComprobante = pgEnum("tipo_comprobante", [
  "factura_a",
  "factura_b",
  "factura_c",
  "nota_credito_a",
  "nota_credito_b",
  "nota_credito_c",
  "nota_debito_a",
  "nota_debito_b",
  "nota_debito_c",
]);

/**
 * Estado del comprobante.
 *
 * `borrador` es el único que se puede editar y el único que no consume número.
 * `emitida` es definitiva. `autorizada` agrega el CAE de ARCA; sin él el
 * comprobante existe en el sistema pero no tiene valor fiscal, y eso se muestra
 * escrito en la pantalla y en la impresión.
 */
export const estadoComprobante = pgEnum("estado_comprobante", [
  "borrador",
  "emitida",
  "autorizada",
  "anulada",
  "rechazada",
]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid().primaryKey().defaultRandom(),
    tipo: tipoComprobante().notNull(),
    puntoVentaId: uuid().references(() => puntosVenta.id, {
      onDelete: "restrict",
    }),
    /** Número de punto de venta, copiado: la fila puede cambiar de nombre. */
    puntoVenta: integer().notNull(),
    /** Correlativo dentro del punto de venta y el tipo. */
    numero: integer().notNull(),
    estado: estadoComprobante().notNull().default("borrador"),

    /* Receptor: se copian los datos del momento, no se leen del cliente.
       Si mañana el cliente cambia de razón social, la factura vieja tiene que
       seguir mostrando a quién se le facturó ese día. */
    customerId: uuid().references(() => customers.id, { onDelete: "set null" }),
    orderId: uuid().references(() => orders.id, { onDelete: "set null" }),
    receptorNombre: text().notNull(),
    receptorCuit: text(),
    receptorCondicionIva: condicionIva().notNull().default("consumidor_final"),
    receptorDomicilio: text(),

    /* Importes. `neto` es sin IVA, `total` es lo que paga el cliente.
       En la factura B el IVA no se discrimina en el papel pero se guarda igual:
       ARCA lo pide en el envío y el libro IVA ventas lo necesita. */
    neto: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    iva21: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    iva105: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    exento: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    /** Suma de percepciones y otros tributos que no son IVA. */
    tributos: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    total: numeric({ precision: 12, scale: 2 }).notNull().default("0"),

    /* Autorización de ARCA */
    cae: text(),
    caeVencimiento: timestamp({ withTimezone: true }),
    /** Qué contestó ARCA cuando rechazó, para poder corregir y reenviar. */
    observacionesArca: text(),

    /** Comprobante que corrige, en notas de crédito y débito. */
    comprobanteOrigenId: uuid(),

    fechaEmision: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Vencimiento del pago, no del comprobante. */
    fechaVencimiento: timestamp({ withTimezone: true }),
    observaciones: text(),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Dos comprobantes del mismo tipo no pueden compartir número en un punto de
    // venta. Es la garantía de que la numeración no se pisa ni con dos personas
    // facturando a la vez.
    uniqueIndex("invoices_numeracion_idx").on(t.puntoVenta, t.tipo, t.numero),
    index("invoices_customer_idx").on(t.customerId),
    index("invoices_order_idx").on(t.orderId),
    index("invoices_estado_idx").on(t.estado),
    index("invoices_fecha_idx").on(t.fechaEmision),
  ],
);

export const invoiceItems = pgTable(
  "invoice_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    descripcion: text().notNull(),
    unidad: text().notNull().default("unidad"),
    cantidad: numeric({ precision: 12, scale: 2 }).notNull(),
    /** Precio unitario sin IVA. */
    precioUnitario: numeric({ precision: 12, scale: 4 }).notNull(),
    /** 21, 10.5 o 0. La madera va al 21 salvo excepciones puntuales. */
    alicuotaIva: numeric({ precision: 4, scale: 2 }).notNull().default("21"),
    neto: numeric({ precision: 12, scale: 2 }).notNull(),
    iva: numeric({ precision: 12, scale: 2 }).notNull(),
    subtotal: numeric({ precision: 12, scale: 2 }).notNull(),
    orden: integer().notNull().default(0),
  },
  (t) => [index("invoice_items_invoice_idx").on(t.invoiceId)],
);

/**
 * Percepciones y otros tributos del comprobante.
 *
 * Todo lo que se cobra y no es IVA: percepcion de Ingresos Brutos, impuestos
 * municipales, internos. Va en tabla aparte y no como una columna porque un
 * comprobante puede llevar varios a la vez y WSFEv1 los espera como una lista,
 * cada uno con su base imponible y su alicuota.
 *
 * Los codigos son los de ARCA: 01 nacional, 02 provincial (donde entra la
 * percepcion de IIBB), 03 municipal, 04 internos, 99 otros.
 */
export const invoiceTributos = pgTable(
  "invoice_tributos",
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    /** Codigo de tributo de ARCA. */
    codigo: text().notNull().default("02"),
    descripcion: text().notNull(),
    baseImponible: numeric({ precision: 12, scale: 2 }).notNull(),
    alicuota: numeric({ precision: 5, scale: 2 }).notNull(),
    importe: numeric({ precision: 12, scale: 2 }).notNull(),
  },
  (t) => [index("invoice_tributos_invoice_idx").on(t.invoiceId)],
);

/* -------------------------------------------------------------------------- */
/* Cobros                                                                      */
/* -------------------------------------------------------------------------- */

export const medioCobro = pgEnum("medio_cobro", [
  "efectivo",
  "transferencia",
  "mercado_pago",
  "tarjeta",
  "cheque",
  "cuenta_corriente",
]);

/**
 * Cobros aplicados a un comprobante.
 *
 * Una factura se puede cobrar en partes y con distintos medios: mitad
 * transferencia, mitad efectivo. Por eso es una tabla y no un campo "pagado" en
 * la factura, que obligaría a elegir un solo medio y una sola fecha.
 */
export const invoicePayments = pgTable(
  "invoice_payments",
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    medio: medioCobro().notNull(),
    monto: numeric({ precision: 12, scale: 2 }).notNull(),
    referencia: text(),
    fecha: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("invoice_payments_invoice_idx").on(t.invoiceId)],
);

/* -------------------------------------------------------------------------- */
/* ARCA                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Ticket de acceso de ARCA, cacheado.
 *
 * El WSAA devuelve un ticket que vale 12 horas y limita cuántas veces se puede
 * pedir uno nuevo: pedirlo en cada factura hace que ARCA empiece a rechazar.
 * Se guarda y se reusa hasta que vence.
 */
export const arcaTokens = pgTable("arca_tokens", {
  id: uuid().primaryKey().defaultRandom(),
  servicio: text().notNull().default("wsfe"),
  /** "homologacion" o "produccion": los tickets no son intercambiables. */
  ambiente: text().notNull().default("homologacion"),
  token: text().notNull(),
  sign: text().notNull(),
  expiraAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * Registro de cada llamada a ARCA.
 *
 * Es documentación fiscal: cuando un comprobante se rechaza o aparece una
 * diferencia, lo único que permite reconstruir qué se envió y qué contestaron
 * es haberlo guardado en el momento.
 */
export const arcaLog = pgTable(
  "arca_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    invoiceId: uuid().references(() => invoices.id, { onDelete: "set null" }),
    operacion: text().notNull(),
    ambiente: text().notNull().default("homologacion"),
    exito: boolean().notNull().default(false),
    solicitud: text(),
    respuesta: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("arca_log_invoice_idx").on(t.invoiceId)],
);

/* -------------------------------------------------------------------------- */
/* Relaciones                                                                  */
/* -------------------------------------------------------------------------- */

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, {
    fields: [invoices.customerId],
    references: [customers.id],
  }),
  order: one(orders, { fields: [invoices.orderId], references: [orders.id] }),
  puntoDeVenta: one(puntosVenta, {
    fields: [invoices.puntoVentaId],
    references: [puntosVenta.id],
  }),
  items: many(invoiceItems),
  cobros: many(invoicePayments),
  tributos: many(invoiceTributos),
}));

export const invoiceTributosRelations = relations(invoiceTributos, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceTributos.invoiceId],
    references: [invoices.id],
  }),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
}));

export const invoicePaymentsRelations = relations(
  invoicePayments,
  ({ one }) => ({
    invoice: one(invoices, {
      fields: [invoicePayments.invoiceId],
      references: [invoices.id],
    }),
  }),
);

export type Invoice = typeof invoices.$inferSelect;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type InvoicePayment = typeof invoicePayments.$inferSelect;
export type InvoiceTributo = typeof invoiceTributos.$inferSelect;
export type PuntoVenta = typeof puntosVenta.$inferSelect;
export type ConfiguracionFiscal = typeof configuracionFiscal.$inferSelect;
