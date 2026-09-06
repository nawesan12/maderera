/**
 * Las reglas comerciales que el negocio decide y cambian solas con el tiempo.
 *
 * Son dos cosas que hasta ahora no existían en el modelo y se resolvían de
 * memoria en el mostrador: cuánto se descuenta por pagar de contado, y cuánto
 * sale cada pasada de sierra. Las dos aparecen en el brief con números
 * concretos, y las dos cambian sin que nadie quiera tocar código.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { medioPago } from "./sales";
import { priceLists } from "./pricing";

/* -------------------------------------------------------------------------- */
/* Descuento por medio de pago                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Cuánto se descuenta según cómo se paga, por escalón de monto.
 *
 * El brief: "Si pagan de contado/transferencia hay un -10% (si son compras de
 * mayor volumen se hace un -15%)". El umbral del 15 % no lo dijeron, así que
 * la escala es una tabla y no dos constantes: el día que lo definan se carga
 * una fila.
 *
 * Es una escala y no un porcentaje único por la misma razón que los descuentos
 * por volumen: gana la fila de `desdeMonto` más alto que el total alcance. Con
 * un solo porcentaje, subir el corte a compras grandes obligaría a inventar un
 * segundo medio de pago llamado "transferencia grande".
 */
export const paymentDiscounts = pgTable(
  "payment_discounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    medio: medioPago().notNull(),
    /** A partir de este total (final, con IVA) aplica este porcentaje. */
    desdeMonto: numeric({ precision: 12, scale: 2 }).notNull().default("0"),
    porcentaje: numeric({ precision: 5, scale: 2 }).notNull(),
    /** Lo que ve el cliente al elegir el medio: "10% por transferencia". */
    etiqueta: text().notNull().default(""),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_discounts_medio_desde_idx").on(t.medio, t.desdeMonto),
    index("payment_discounts_activo_idx").on(t.activo),
  ],
);

/* -------------------------------------------------------------------------- */
/* Tarifa de corte                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Cuánto sale cada pasada de sierra, por material y por lista de precios.
 *
 * Hasta ahora el corte no se cobraba en ninguna parte del sistema: ni
 * `cutting_orders` ni `cutting_items` tenían una columna de importe, y la
 * única forma de que entrara la plata era que el vendedor tipeara una línea
 * suelta en el mostrador con el número de memoria.
 *
 * Los cuatro precios del brief entran como cuatro filas:
 *
 * | material            | lista       | por pasada |
 * |---------------------|-------------|------------|
 * | placas              | general     | $ 1.200    |
 * | tableros de madera  | general     | $ 1.400    |
 * | placas              | profesional | $   996    |
 * | tableros de madera  | profesional | $ 1.162    |
 *
 * `priceListId` nulo significa "para cualquier lista": es el piso al que cae
 * un material cuando la lista de quien compra no tiene tarifa propia, igual
 * que el precio del catálogo cae a la lista general.
 */
export const cuttingRates = pgTable(
  "cutting_rates",
  {
    id: uuid().primaryKey().defaultRandom(),
    /**
     * Familia de material, no la variante.
     *
     * La tarifa no depende de la placa concreta sino de contra qué corta la
     * sierra: una melamina y un MDF cobran igual, un tablero de madera no.
     */
    material: text().notNull(),
    priceListId: uuid().references(() => priceLists.id, {
      onDelete: "cascade",
    }),
    /** Precio final, con IVA incluido, como todo el catálogo. */
    precioPorPasada: numeric({ precision: 12, scale: 2 }).notNull(),
    activo: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cutting_rates_material_lista_idx").on(t.material, t.priceListId),
    /*
     * El índice de arriba no alcanza para la tarifa general.
     *
     * En Postgres dos NULL no son iguales, así que un índice único sobre
     * `(material, price_list_id)` deja entrar dos filas de "placas" con la
     * lista en nulo — que son justamente las dos tarifas de público, y la
     * consulta se quedaría con cualquiera de las dos. Este índice parcial
     * cubre ese caso.
     */
    uniqueIndex("cutting_rates_material_general_idx")
      .on(t.material)
      .where(sql`${t.priceListId} is null`),
    index("cutting_rates_activo_idx").on(t.activo),
  ],
);
