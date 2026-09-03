/**
 * La copia local del mostrador, en IndexedDB.
 *
 * Envoltorio propio y no una librería: lo que se usa son `get`, `put`,
 * `getAll`, `delete` y una transacción sobre siete almacenes. Una dependencia
 * para eso agrega superficie que hay que mantener, y la parte que de verdad
 * tiene decisiones —qué se guarda, cuándo se refresca, qué pasa con la cola— hay
 * que escribirla igual.
 *
 * **Nada de lo que hay acá decide accesos ni precios por su cuenta.** Es una
 * copia de lo que el servidor ya calculó: la lista de precios que corresponde
 * la resolvió él, y acá solo se guarda el resultado.
 */

const NOMBRE = "mostrador";
const VERSION = 1;

export type Almacen =
  | "variantes"
  | "precios"
  | "stock"
  | "clientes"
  | "cola"
  | "tickets"
  | "meta";

/** El navegador puede no tener IndexedDB (modo privado viejo, WebView raro). */
export function hayAlmacenLocal(): boolean {
  return typeof indexedDB !== "undefined";
}

let conexion: Promise<IDBDatabase> | null = null;

function abrir(): Promise<IDBDatabase> {
  if (conexion) return conexion;

  conexion = new Promise((listo, falla) => {
    const pedido = indexedDB.open(NOMBRE, VERSION);

    pedido.onupgradeneeded = () => {
      const db = pedido.result;

      // `keyPath` compuesto en precios y stock: la clave natural es el par, y
      // así el `put` de una sincronización pisa la fila correcta sin buscarla.
      if (!db.objectStoreNames.contains("variantes")) {
        const s = db.createObjectStore("variantes", { keyPath: "variantId" });
        s.createIndex("porSku", "sku", { unique: false });
      }
      if (!db.objectStoreNames.contains("precios")) {
        db.createObjectStore("precios", { keyPath: ["priceListId", "variantId"] });
      }
      if (!db.objectStoreNames.contains("stock")) {
        db.createObjectStore("stock", { keyPath: ["branchId", "variantId"] });
      }
      if (!db.objectStoreNames.contains("clientes")) {
        db.createObjectStore("clientes", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("cola")) {
        const s = db.createObjectStore("cola", { keyPath: "clave" });
        s.createIndex("porEstado", "estado", { unique: false });
      }
      if (!db.objectStoreNames.contains("tickets")) {
        db.createObjectStore("tickets", { keyPath: "clave" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "clave" });
      }
    };

    pedido.onsuccess = () => listo(pedido.result);
    pedido.onerror = () => falla(pedido.error);
    // Otra pestaña con una versión vieja bloquea la actualización del esquema.
    // Falla explícito en vez de quedarse colgado esperando para siempre.
    pedido.onblocked = () => {
      falla(new Error("Hay otra pestaña del mostrador abierta. Cerrala y volvé a entrar."));
    };
  });

  return conexion;
}

function comoPromesa<T>(pedido: IDBRequest<T>): Promise<T> {
  return new Promise((listo, falla) => {
    pedido.onsuccess = () => listo(pedido.result);
    pedido.onerror = () => falla(pedido.error);
  });
}

export async function leer<T>(almacen: Almacen, clave: IDBValidKey): Promise<T | null> {
  const db = await abrir();
  const tx = db.transaction(almacen, "readonly");
  const fila = await comoPromesa<T | undefined>(tx.objectStore(almacen).get(clave));
  return fila ?? null;
}

export async function leerTodo<T>(almacen: Almacen): Promise<T[]> {
  const db = await abrir();
  const tx = db.transaction(almacen, "readonly");
  return comoPromesa<T[]>(tx.objectStore(almacen).getAll());
}

export async function guardar<T>(almacen: Almacen, fila: T): Promise<void> {
  const db = await abrir();
  const tx = db.transaction(almacen, "readwrite");
  tx.objectStore(almacen).put(fila);
  await esperarTransaccion(tx);
}

/**
 * Guarda muchas filas en una sola transacción.
 *
 * Una transacción por fila con ocho mil variantes tarda lo suficiente como para
 * que se note al abrir la pantalla.
 */
export async function guardarVarios<T>(almacen: Almacen, filas: T[]): Promise<void> {
  if (filas.length === 0) return;

  const db = await abrir();
  const tx = db.transaction(almacen, "readwrite");
  const store = tx.objectStore(almacen);
  for (const fila of filas) store.put(fila);
  await esperarTransaccion(tx);
}

export async function borrar(almacen: Almacen, clave: IDBValidKey): Promise<void> {
  const db = await abrir();
  const tx = db.transaction(almacen, "readwrite");
  tx.objectStore(almacen).delete(clave);
  await esperarTransaccion(tx);
}

export async function vaciar(almacen: Almacen): Promise<void> {
  const db = await abrir();
  const tx = db.transaction(almacen, "readwrite");
  tx.objectStore(almacen).clear();
  await esperarTransaccion(tx);
}

/**
 * Escribe en varios almacenes **de una sola vez**.
 *
 * Es lo que hace que encolar una venta y guardar su ticket sean la misma
 * operación: o quedan los dos o no queda ninguno. Un ticket sin venta en la
 * cola sería un papel entregado que nunca se va a cobrar.
 */
export async function guardarJunto(
  almacenes: Almacen[],
  escribir: (store: (a: Almacen) => IDBObjectStore) => void,
): Promise<void> {
  const db = await abrir();
  const tx = db.transaction(almacenes, "readwrite");
  escribir((a) => tx.objectStore(a));
  await esperarTransaccion(tx);
}

function esperarTransaccion(tx: IDBTransaction): Promise<void> {
  return new Promise((listo, falla) => {
    tx.oncomplete = () => listo();
    tx.onerror = () => falla(tx.error);
    tx.onabort = () => falla(tx.error ?? new Error("Transacción abortada"));
  });
}

/* -------------------------------------------------------------------------- */
/* Singletons del almacén `meta`                                               */
/* -------------------------------------------------------------------------- */

export type ClaveMeta =
  | "catalogo"
  | "config"
  | "sesion"
  | "caja"
  | "turno"
  | "sucursalElegida";

export async function leerMeta<T>(clave: ClaveMeta): Promise<T | null> {
  const fila = await leer<{ clave: ClaveMeta; valor: T }>("meta", clave);
  return fila?.valor ?? null;
}

export async function guardarMeta<T>(clave: ClaveMeta, valor: T): Promise<void> {
  await guardar("meta", { clave, valor });
}

/**
 * Le pide al navegador que no desaloje esto.
 *
 * Chrome puede vaciar el almacenamiento cuando falta disco, y acá adentro puede
 * haber ventas sin subir. Si el navegador dice que no, hay que saberlo: la
 * pantalla lo muestra en vez de asumir que la cola está a salvo.
 */
export async function pedirPersistencia(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
