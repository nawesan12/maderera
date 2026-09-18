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
 * **Las etiquetas son las que usa el equipo**, y cambiaron: donde el panel
 * decía "En blanco" y "En negro" ahora dice **"Facturas"** y **"B"**. Lo pidió
 * la clienta y tiene sentido puesto en la pantalla: el circuito que se factura
 * se nombra por lo que tiene —facturas—, y el otro por la letra con la que lo
 * llaman entre ellos. Sigue siendo la regla de copiarles el proceso y no
 * renombrárselo; lo que cambió es cómo lo nombran.
 *
 * **Los valores del enum no se tocan.** `blanco` y `negro` están en la base,
 * en los índices y en 57 migraciones: renombrarlos sería una migración de datos
 * para ganar nada. La traducción vive en `ETIQUETA_CIRCUITO` (`lib/circuito.ts`,
 * sin dependencias de la base porque la usan componentes de cliente) y es el
 * único lugar del que salen los textos de la pantalla.
 *
 * Es distinto de **si el gasto tiene factura o no**, que ya vive en
 * `expenses.purchaseInvoiceId`: puede haber gasto con factura en cualquiera de
 * los dos circuitos. Son dos preguntas y se responden por separado.
 */
export const circuito = pgEnum("circuito", ["blanco", "negro"]);
