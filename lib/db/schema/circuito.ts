import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Por qué circuito de facturación va una operación.
 *
 * **No es un registro de evasión y conviene dejarlo escrito**, porque la
 * pasada anterior lo leyó así y lo rechazó. MJBJ factura una parte de lo que
 * compra y paga por otra vía o contra otra cuenta, y necesita seguir los dos
 * conjuntos por separado: cuánto salió por cada uno, qué le debe a cada
 * proveedor en cada uno, y que el cierre del mes no los mezcle. Sin esta
 * columna, los dos circuitos quedan sumados en el mismo total y el número que
 * se mira para decidir no sirve para ninguno de los dos.
 *
 * **Las etiquetas son las que usa el equipo**: "en blanco" y "en negro". No es
 * la nomenclatura que uno elegiría para un modelo de datos —"circuito A" y
 * "circuito B" serían más neutras— pero el panel lo usan entre tres y cinco
 * personas que ya nombran así las dos cajas, todos los días, y una pantalla
 * que las llama de otra manera obliga a traducir en la cabeza cada vez. La
 * regla del proyecto es copiarles el proceso, no renombrárselo.
 *
 * Es distinto de **si el gasto tiene factura o no**, que ya vive en
 * `expenses.purchaseInvoiceId`: puede haber gasto con factura en cualquiera de
 * los dos circuitos. Son dos preguntas y se responden por separado.
 */
export const circuito = pgEnum("circuito", ["blanco", "negro"]);

export const ETIQUETA_CIRCUITO: Record<string, string> = {
  blanco: "En blanco",
  negro: "En negro",
};
