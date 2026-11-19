/**
 * La tabla de atajos del mostrador y la decisión de qué hace cada tecla.
 *
 * Es lógica pura, sin React ni `document`, para poder probarla con eventos
 * falsos: el error que costó caro (Ctrl+Enter que agregaba la línea **y**
 * cobraba el carrito de antes) no se ve leyendo el componente, se ve
 * apretando la tecla. Los manejadores y la ayuda en pantalla viven en
 * `app/mostrador/atajos.tsx`, que importa esto.
 *
 * Se lee `event.code` y no `event.key`: con `Alt` apretado, el teclado entrega
 * el carácter alternativo —en Mac, Alt+C es «ç»— y la letra se pierde. El
 * `code` es la tecla física.
 */

export type Accion =
  | "cobrar"
  | "cliente"
  | "buscador"
  | "tipo"
  | "medio1"
  | "medio2"
  | "medio3"
  | "medio4"
  | "descuento"
  | "papel"
  | "partir"
  | "presupuesto"
  | "imprimir"
  | "caja"
  | "cantidad"
  | "recibo";

/** Lo que se mira de la tecla. Un `KeyboardEvent` lo cumple; una prueba también. */
export interface Tecla {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
}

export interface Definicion {
  accion: Accion;
  /** Cómo se escribe la tecla en la ayuda. */
  teclas: string;
  /** Qué hace, en la ayuda. Vacío: no se muestra (los medios van juntos). */
  texto: string;
  coincide: (e: Tecla) => boolean;
}

/** Alt y nada más: con Ctrl o Shift encima es otro atajo, no este. */
function alt(code: string) {
  return (e: Tecla) =>
    e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === code;
}

/**
 * Ctrl (o Cmd) + Enter, y solo eso.
 *
 * Con Mayús o Alt encima no cobra: en el buscador esas son las teclas de la
 * media placa, y un dedo que se apoya de más no puede terminar la venta. El
 * Enter del teclado numérico cuenta igual: en el mostrador es el que queda
 * más a mano después de tipear el vuelto.
 */
export function esCobrar(e: Tecla) {
  return (
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    !e.shiftKey &&
    (e.code === "Enter" || e.code === "NumpadEnter")
  );
}

export const ATAJOS: Definicion[] = [
  { accion: "cobrar", teclas: "Ctrl + Enter", texto: "Cobrar", coincide: esCobrar },
  { accion: "buscador", teclas: "Alt + B", texto: "Buscar un producto", coincide: alt("KeyB") },
  { accion: "cantidad", teclas: "F2", texto: "Cambiar la cantidad del último", coincide: (e) => e.code === "F2" },
  { accion: "cliente", teclas: "Alt + C", texto: "Elegir el cliente", coincide: alt("KeyC") },
  {
    accion: "tipo",
    // Alt+T no: es el atajo con el que los avisos (`sonner`) se enfocan a sí
    // mismos, y dos cosas distintas en la misma tecla es peor que una letra
    // menos obvia.
    teclas: "Alt + O",
    texto: "Contado, cuenta corriente o acopio",
    coincide: alt("KeyO"),
  },
  { accion: "medio1", teclas: "Alt + 1", texto: "Los medios de pago, por su lugar en pantalla", coincide: alt("Digit1") },
  { accion: "medio2", teclas: "Alt + 2", texto: "", coincide: alt("Digit2") },
  { accion: "medio3", teclas: "Alt + 3", texto: "", coincide: alt("Digit3") },
  { accion: "medio4", teclas: "Alt + 4", texto: "", coincide: alt("Digit4") },
  { accion: "descuento", teclas: "Alt + D", texto: "Hacer un descuento", coincide: alt("KeyD") },
  { accion: "papel", teclas: "Alt + F", texto: "Comprobante o factura", coincide: alt("KeyF") },
  { accion: "partir", teclas: "Alt + P", texto: "Partir el pago en más de un medio", coincide: alt("KeyP") },
  { accion: "presupuesto", teclas: "Alt + U", texto: "Emitir presupuesto sin cobrar", coincide: alt("KeyU") },
  { accion: "imprimir", teclas: "Alt + I", texto: "Imprimir la última venta", coincide: alt("KeyI") },
  {
    accion: "recibo",
    // R de recibo: cobrarle la cuenta al cliente elegido, con su recibo.
    teclas: "Alt + R",
    texto: "Cobrar la cuenta del cliente elegido",
    coincide: alt("KeyR"),
  },
  {
    accion: "caja",
    // K y no C: la C es del cliente, que se toca mil veces por día y se lleva
    // la inicial.
    teclas: "Alt + K",
    texto: "Abrir y cerrar el panel de caja",
    coincide: alt("KeyK"),
  },
];

/**
 * Qué atajo dispara la tecla, o null si no es de la pantalla.
 *
 * Dos casos le sacan la tecla a la pantalla:
 *
 * - **Un campo ya la usó** (`defaultPrevented`). El buscador agrega el
 *   resultado con Enter y lo cancela: si la tecla siguiera viaje, Ctrl+Enter
 *   cobraba el carrito armado *antes* de que entrara esa línea. Esto anda
 *   porque `useAtajos` escucha en `window` en la fase de burbuja, después
 *   de que React corrió los `onKeyDown` de los campos. **Si alguien lo pasa a
 *   la fase de captura, `defaultPrevented` llega siempre en falso** y el
 *   error vuelve (hay una prueba que lo fija).
 * - **Hay un diálogo encima.** Pasó de verdad: Ctrl+Enter para cerrar el
 *   corte a medida cerró el corte y cobró la venta de atrás. Mientras hay algo
 *   encima, las teclas son del diálogo.
 */
export function accionDeLaTecla(
  e: Tecla,
  atajos: readonly Definicion[],
  hayAlgoEncima: () => boolean,
): Accion | null {
  if (e.defaultPrevented) return null;
  if (hayAlgoEncima()) return null;
  for (const atajo of atajos) {
    if (atajo.coincide(e)) return atajo.accion;
  }
  return null;
}

/* -------------------------------------------------------------------------- */

/** Lo que hace el Enter del buscador. Solo «soltar» deja seguir la tecla. */
export type EnterDelBuscador =
  | { que: "agregar"; media: "media_largo" | "media_ancho" | null; yCobrar: boolean }
  | { que: "cortar" }
  | { que: "sinPrecio" }
  | { que: "aMano" }
  | { que: "esperar" }
  | { que: "soltar" };

/**
 * Qué hace Enter (con o sin modificadores) en el buscador.
 *
 * La regla: **con algo escrito, la tecla es del buscador**. Antes la soltaba
 * siempre y Ctrl+Enter cobraba el carrito sin la línea que se estaba
 * agregando; peor todavía con un código que no existe, que cobraba sin
 * avisar que no había entrado nada.
 *
 * - Con un resultado marcado, agrega. Ctrl+Enter agrega **y cobra**, pero con
 *   la línea ya adentro: para el que vende, Ctrl+Enter es cobrar, y pedirle
 *   que lo apriete dos veces le cambia la costumbre para tapar un error
 *   nuestro (crítica del operario, T4).
 * - Ctrl+Enter sobre una placa que se corta abre el corte y no cobra: el
 *   corte todavía no está armado.
 * - Mayús o Alt + Enter son media placa y nunca cobran, aunque venga Ctrl.
 * - Con texto que no encontró nada, abre la carga a mano. Ninguna de las
 *   dos cobra.
 * - Mientras no se sabe qué hay para **este** texto, espera, aunque haya un
 *   resultado a la vista: sin copia local, la lista es la de la búsqueda
 *   anterior durante los 180 ms y la ida al servidor. Con «mdf 18» tipeado y
 *   la lista de «mdf 1» todavía en pantalla, Ctrl+Enter metía el MDF de 15 y
 *   cobraba e imprimía en el acto (comité de T4); y un lector de códigos, que
 *   tipea y aprieta Enter en el mismo instante, agregaba el de antes.
 * - Con el buscador vacío la tecla sigue de largo y cobra: es el caso de
 *   todos los días, porque terminada cada línea el foco vuelve acá.
 * - Un resultado sin precio no se agrega, con ninguna tecla (comité final,
 *   M14 y decisión 4): no hay productos a $0, y Ctrl+Enter lo cobraba.
 * - Sin conexión, Ctrl+Enter sobre una placa la agrega y no cobra: sin
 *   catálogo no se puede cortar, y la placa entera salía cobrada en el acto
 *   cuando lo que se pedía era un corte (comité final, M14).
 */
export function enterDelBuscador(t: {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Lo tipeado, sin el prefijo de cantidad. */
  texto: string;
  /** Si hay un resultado marcado. */
  hayResultado: boolean;
  /** Si ese resultado es una placa con medidas y se puede cortar ahora. */
  seCorta: boolean;
  /**
   * Si ya se sabe qué hay para este texto: con la copia local, siempre; sin
   * ella, cuando volvió la búsqueda de este mismo texto.
   */
  resuelto: boolean;
  /** Si el resultado marcado no tiene precio (o es $0). */
  sinPrecio?: boolean;
  /** Si el resultado marcado es una placa. */
  esPlaca?: boolean;
  /** Si el mostrador está sin conexión. */
  sinConexion?: boolean;
}): EnterDelBuscador {
  if (t.texto.trim() === "") return { que: "soltar" };
  if (!t.resuelto) return { que: "esperar" };
  if (t.hayResultado) {
    if (t.sinPrecio) return { que: "sinPrecio" };
    if (t.ctrl && !t.shift && !t.alt && t.seCorta) return { que: "cortar" };
    const media = t.shift ? "media_largo" : t.alt ? "media_ancho" : null;
    const placaSinConexion = Boolean(t.esPlaca && t.sinConexion);
    return { que: "agregar", media, yCobrar: t.ctrl && !t.shift && !t.alt && !placaSinConexion };
  }
  return { que: "aMano" };
}
