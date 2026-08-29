import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Bitácora del panel: quién hizo qué, cuándo y sobre qué.
 *
 * No lo pide el contrato. Lo pide operar con varias personas cargando en el
 * mismo sistema: cuando un precio aparece cambiado, un pedido cancelado o un
 * stock ajustado y nadie lo hizo, la única salida sin registro es adivinar. En
 * el sistema anterior esa discusión existía y se resolvía por memoria.
 *
 * Se guarda el **nombre y el correo** de quien actuó además de su `userId`,
 * duplicando datos a propósito: la bitácora tiene que seguir siendo legible
 * después de que la persona deje la empresa y se borre su usuario. Por eso
 * `usuarioId` es `text` sin foreign key —borrar un empleado no puede borrar el
 * registro de lo que hizo—.
 *
 * `entidadId` tampoco lleva foreign key: apunta a tablas distintas según la
 * entidad, y un pedido eliminado no debería llevarse su historial.
 */
export const accionAuditoria = pgEnum("accion_auditoria", [
  "crear",
  "editar",
  "eliminar",
  "cambiar_estado",
  "cobrar",
  "anular",
  "importar",
  "exportar",
]);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    usuarioId: text(),
    usuarioNombre: text().notNull(),
    usuarioEmail: text(),
    /** `admin`, `vendedor` o `deposito` al momento de la acción. */
    usuarioRol: text(),
    accion: accionAuditoria().notNull(),
    /** Tipo de cosa tocada: `producto`, `pedido`, `precio`, `sucursal`… */
    entidad: text().notNull(),
    entidadId: text(),
    /**
     * Una línea en castellano, redactada por quien registra la acción.
     *
     * Es lo que se lee en la pantalla. Guardar solo `accion` + `entidad`
     * obligaría a reconstruir la frase en el front y a mantener un diccionario
     * de textos que se desincroniza con el código que registra.
     */
    descripcion: text().notNull(),
    /**
     * Lo que cambió, como JSON, para lo que no entra en una línea.
     *
     * Opcional a propósito: forzar un diff completo en cada acción haría que
     * registrar sea caro y termine no registrándose.
     */
    detalle: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_fecha_idx").on(t.createdAt),
    index("audit_log_entidad_idx").on(t.entidad, t.entidadId),
    index("audit_log_usuario_idx").on(t.usuarioId),
  ],
);

export type AuditEntry = typeof auditLog.$inferSelect;
