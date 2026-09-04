/*
 * El ayudante que hace que el mostrador abra sin internet.
 *
 * Escrito a mano y no con Serwist por una razón concreta: la documentación de
 * Next 16 que viene en este repo dice que ese plugin **requiere configuración
 * de webpack**, y el proyecto compila con Turbopack. Cambiar todo el build por
 * un ayudante de caché es una apuesta más grande que lo que compra. Además, la
 * lógica interesante —la cola de ventas, las reglas de conflicto— vive en la
 * página, no acá: esto son ciento cincuenta líneas de política de caché.
 *
 * Alcance: **solo el mostrador**. El panel y el sitio público no se interceptan.
 * Un POS a medio conectar es útil; un panel a medio conectar es peligroso,
 * porque ahí se cierran cajas y se factura, y un dato viejo es peor que un
 * error.
 */

/*
 * La versión sale de la propia dirección del script: se registra como
 * `/sw.js?v=<id del build>`.
 *
 * **Antes era una constante escrita a mano, y eso lo dejaba clavado.** Un
 * archivo que no cambia byte a byte no dispara reinstalación, así que el
 * mostrador seguía sirviendo el shell y los chunks del día que se instaló,
 * para siempre. Se descubrió porque `/ticket/local` nunca llegó al caché: se
 * agregó a la lista después de que el ayudante ya estuviera instalado, y no
 * hubo una segunda instalación que lo trajera.
 *
 * Con el id del build adentro, cada deploy es un script distinto: se instala,
 * y `activate` borra los cachés de la versión anterior.
 */
const VERSION =
  "mjbj-mostrador-" +
  (new URL(self.location.href).searchParams.get("v") || "dev");
const SHELL = `${VERSION}-shell`;
const ESTATICOS = `${VERSION}-estaticos`;

/** Lo que tiene que estar sí o sí para que la pantalla abra sin red. */
const IMPRESCINDIBLE = ["/mostrador", "/ticket/local"];

/**
 * Cuánto se espera a la red antes de servir lo guardado.
 *
 * "Internet caído" en la práctica casi nunca es el cable desenchufado: es
 * internet malísimo. Sin este tope, el navegador se queda treinta segundos en
 * blanco con alguien esperando del otro lado del mostrador.
 */
const ESPERA_MS = 2500;

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // `reload` evita que el propio caché HTTP devuelva una copia vieja justo
      // en el momento de guardar la buena.
      await Promise.allSettled(
        IMPRESCINDIBLE.map(async (ruta) => {
          const respuesta = await fetch(ruta, { cache: "reload" });
          // Se lee el cuerpo antes de guardar: la copia va al caché y el
          // original se usa para saber qué archivos hacen falta.
          const html = await respuesta.clone().text();
          await guardarSiSirve(cache, ruta, respuesta);
          await guardarLoQuePide(html);
        }),
      );

      /*
       * **No se llama a `skipWaiting()` acá**, a propósito.
       *
       * Activar de una borraría los cachés de la versión anterior mientras la
       * pantalla vieja sigue abierta, y si en ese momento se corta internet, un
       * chunk que esa pantalla todavía no cargó ya no está en ningún lado. Peor
       * si pasa en medio de un cobro.
       *
       * El ayudante nuevo espera. La pantalla avisa que hay versión nueva y
       * quien atiende decide cuándo; ahí llega el mensaje de abajo.
       */
    })(),
  );
});

/**
 * La pantalla pide el relevo.
 *
 * Es la otra mitad del botón "Recargar": una recarga sola **no** activa al
 * ayudante que está esperando —mientras haya un cliente controlado por el
 * viejo, el nuevo sigue en espera— así que el botón avisa por acá y recién
 * después recarga.
 */
self.addEventListener("message", (evento) => {
  if (evento.data === "activar-ahora") self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    (async () => {
      // Que la navegación no espere a que arranque este worker.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }

      const nombres = await caches.keys();
      await Promise.all(
        nombres
          .filter((n) => n.startsWith("mjbj-mostrador-") && !n.startsWith(VERSION))
          .map((n) => caches.delete(n)),
      );

      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (evento) => {
  const pedido = evento.request;

  if (pedido.method !== "GET") return;

  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin) return;

  // Los assets con hash en el nombre: nunca cambian, se sirven de una.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/mostrador/icono")) {
    evento.respondWith(primeroElCache(pedido));
    return;
  }

  /*
   * Los datos del mostrador van a la red y, si falla, **fallan**.
   *
   * No se sirven del caché a propósito: la copia buena vive en IndexedDB, y un
   * caché de respuestas sería una segunda verdad sobre los mismos precios. Que
   * el fetch falle es lo que le dice a la pantalla "usá lo local".
   */
  if (url.pathname.startsWith("/api/mostrador/")) {
    evento.respondWith(soloRed(pedido));
    return;
  }

  // La pantalla del mostrador y el ticket local.
  if (pedido.mode === "navigate" && esDelMostrador(url.pathname)) {
    evento.respondWith(primeroLaRed(evento, pedido));
  }
});

function esDelMostrador(ruta) {
  return ruta === "/mostrador" || ruta.startsWith("/ticket/local");
}

async function primeroElCache(pedido) {
  const cache = await caches.open(ESTATICOS);
  const guardado = await cache.match(pedido);
  if (guardado) return guardado;

  /*
   * Con tope, igual que la navegación.
   *
   * Sin él, un archivo que no quedó guardado se queda esperando **para
   * siempre** cuando no hay servidor: la pantalla no termina de cargar nunca y
   * ni siquiera muestra un error. Se descubrió abriendo el ticket con el
   * servidor apagado: la página quedaba colgada en blanco.
   *
   * Fallar rápido deja que el navegador muestre lo que sí tiene y que el resto
   * dé error, que es algo con lo que se puede seguir trabajando.
   */
  const respuesta = await conTope(pedido);
  if (respuesta.ok) cache.put(pedido, respuesta.clone());
  return respuesta;
}

async function soloRed(pedido) {
  try {
    return await fetch(pedido);
  } catch {
    return new Response(
      JSON.stringify({ error: "sin_conexion" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
}

async function primeroLaRed(evento, pedido) {
  const cache = await caches.open(SHELL);

  /*
   * La clave del caché es **la ruta sin el query**.
   *
   * El ticket local se abre como `/ticket/local?clave=<uuid de la venta>`, así
   * que guardar por URL completa dejaría una entrada por cada venta impresa: el
   * caché del shell crecería sin techo en la máquina que más se usa.
   */
  const clave = new URL(pedido.url).pathname;

  try {
    const preload = await evento.preloadResponse;
    const respuesta = preload || (await conTope(pedido));
    await guardarSiSirve(cache, clave, respuesta.clone());
    return respuesta;
  } catch {
    /*
     * `ignoreSearch` es lo que hace que el ticket salga.
     *
     * **Sin esto el papel no se imprimía justo el día que no hay internet**:
     * `/ticket/local?clave=abc` no coincidía con el `/ticket/local` guardado, se
     * caía al shell de `/mostrador`, y el botón "Imprimir" abría el punto de
     * venta en vez del comprobante. Que la ruta sea fija y la clave viaje en el
     * query fue una decisión para poder precachearla; faltaba la otra mitad.
     */
    const guardado =
      (await cache.match(pedido, { ignoreSearch: true })) ||
      (await cache.match("/mostrador"));
    if (guardado) return guardado;

    return new Response(
      "<!doctype html><meta charset=utf-8><p>El mostrador todavía no se guardó para usar sin internet. Conectate una vez.",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

function conTope(pedido) {
  return new Promise((listo, falla) => {
    const reloj = setTimeout(() => falla(new Error("tardó demasiado")), ESPERA_MS);
    fetch(pedido).then(
      (r) => { clearTimeout(reloj); listo(r); },
      (e) => { clearTimeout(reloj); falla(e); },
    );
  });
}

/**
 * Guarda la respuesta **solo si es la pantalla de verdad**.
 *
 * Sin este filtro, la primera visita sin sesión guarda como shell del mostrador
 * la redirección al login, y la máquina queda inservible offline: abre siempre
 * en "iniciá sesión" aunque la sesión esté abierta. Es el error más fácil de
 * cometer acá y el más difícil de diagnosticar después.
 */
/**
 * Guarda los archivos que la página necesita para arrancar.
 *
 * Sin esto el HTML quedaba en el caché y **los chunks no**: al abrir sin
 * internet, la pantalla cargaba y explotaba al hidratar, porque su JavaScript
 * no estaba en ningún lado. Pasaba sobre todo con `/ticket/local`, que nadie
 * visita mientras hay internet: se descubrió imprimiendo un ticket con el
 * servidor apagado y encontrando "Se nos rompió algo".
 *
 * Se sacan del propio HTML: es la única fuente que sabe qué chunks le tocan a
 * cada ruta, porque los nombres llevan hash y cambian en cada build.
 */
async function guardarLoQuePide(html) {
  const cache = await caches.open(ESTATICOS);

  const rutas = new Set(
    [...html.matchAll(/["'](\/_next\/static\/[^"']+)["']/g)].map((m) => m[1]),
  );

  await Promise.allSettled(
    [...rutas].map(async (ruta) => {
      // Ya guardado por otra ruta imprescindible: no se pide de nuevo.
      if (await cache.match(ruta)) return;

      const respuesta = await fetch(ruta, { cache: "reload" });
      if (respuesta.ok) await cache.put(ruta, respuesta);
    }),
  );
}

async function guardarSiSirve(cache, clave, respuesta) {
  const tipo = respuesta.headers.get("content-type") || "";

  if (respuesta.ok && !respuesta.redirected && tipo.includes("text/html")) {
    await cache.put(clave, respuesta);
  }
}
