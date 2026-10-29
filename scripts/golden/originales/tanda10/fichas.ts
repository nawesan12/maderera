/**
 * Qué ficha de cliente se marca como profesional al aprobar una solicitud.
 *
 * Suena a detalle y es la parte que se rompió: un profesional puede estar dos
 * veces en la cartera —una ficha cargada en el mostrador, con CUIT y con
 * historia, y otra creada por él mismo al registrarse en el sitio, con cuenta
 * web y sin CUIT— y la aprobación tiene que elegir una sin partir la cuenta
 * corriente ni chocar con el índice único de la cuenta web
 * (`customers_user_idx`). Cuando chocaba, la transacción entera se caía: la
 * solicitud quedaba sin aprobar y el cliente no aparecía en Clientes.
 *
 * La regla, en una línea: **gana la ficha con CUIT** —es la que tiene la
 * historia comercial— y la cuenta web se muda a ella.
 */

export interface FichaCandidata {
  id: string;
  /** La cuenta web que ya cuelga de esta ficha, si cuelga alguna. */
  userId?: string | null;
}

export interface DecisionDeFicha {
  /** La ficha que se marca como profesional. `null` = hay que crearla. */
  destino: string | null;
  /**
   * Ficha a la que hay que sacarle la cuenta web antes de mudarla, porque el
   * índice único no admite dos fichas con el mismo usuario.
   */
  liberar: string | null;
  /** Si la cuenta web se cuelga de la ficha destino. */
  vincularCuentaWeb: boolean;
}

export function decidirFicha({
  porCuit,
  porUsuario,
  userId,
}: {
  /** Ficha encontrada por CUIT, si la solicitud trae CUIT. */
  porCuit?: FichaCandidata | null;
  /** Ficha encontrada por la cuenta web de quien solicita. */
  porUsuario?: FichaCandidata | null;
  /** La cuenta web de quien solicita, si pidió acceso estando logueado. */
  userId?: string | null;
}): DecisionDeFicha {
  // Sin ficha previa: se crea, y el insert ya lleva la cuenta web.
  if (!porCuit && !porUsuario) {
    return { destino: null, liberar: null, vincularCuentaWeb: false };
  }

  // Solo la de la cuenta web: es la del registro del sitio. Ya tiene el
  // usuario colgado, así que no hay nada que mudar.
  if (!porCuit) {
    return { destino: porUsuario!.id, liberar: null, vincularCuentaWeb: false };
  }

  // La misma ficha por los dos caminos: el caso feliz.
  if (porUsuario && porUsuario.id === porCuit.id) {
    return { destino: porCuit.id, liberar: null, vincularCuentaWeb: false };
  }

  // Dos fichas distintas, o una sola con CUIT. Gana la del CUIT, y la cuenta
  // web se le cuelga **solo si está libre**: pisar el `userId` de una ficha que
  // ya tiene otra cuenta le daría a alguien la cuenta corriente de otro.
  return {
    destino: porCuit.id,
    liberar: porUsuario ? porUsuario.id : null,
    vincularCuentaWeb: Boolean(userId) && !porCuit.userId,
  };
}
