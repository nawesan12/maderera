import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Cuántas veces se hizo algo en la ventana en curso.
 *
 * **Por qué en Postgres y no en memoria.** En Vercel cada instancia de función
 * tiene su propia memoria y se recicla sola: un contador en memoria se pierde en
 * cada arranque en frío y no se comparte entre instancias, así que un límite de
 * cinco intentos se convierte en cinco por instancia. Es exactamente el problema
 * que tiene el límite que trae Better Auth con su `storage: "memory"`.
 *
 * Tampoco se suma Redis: sería una pieza de infraestructura más —con su costo y
 * su caída propia— para guardar un entero por clave. La base ya está, ya es el
 * estado compartido de todo lo demás, y esto es la operación más barata que
 * sabe hacer: un `INSERT … ON CONFLICT DO UPDATE` sobre la clave primaria.
 *
 * **La fila se pisa, no se acumula.** La clave incluye el comienzo de la
 * ventana, así que al pasar a la siguiente se escribe una fila nueva y la vieja
 * queda muerta. No hay historial que consultar ni que limpiar en caliente: las
 * viejas las barre `limpiarVentanasViejas` cada tanto.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    /**
     * Qué se está limitando y a quién: `ingresar:ip:190.1.2.3`,
     * `contacto:correo:juan@…`. El prefijo es la acción y lo que sigue, el
     * sujeto: así dos acciones distintas nunca comparten cuenta.
     */
    clave: text().notNull(),
    /** El comienzo de la ventana. Ver `inicioDeVentana` en `lib/limites/ventana.ts`. */
    ventana: timestamp({ withTimezone: true }).notNull(),
    cuenta: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.clave, t.ventana] })],
);

export type RateLimit = typeof rateLimits.$inferSelect;
