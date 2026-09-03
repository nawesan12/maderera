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

const VERSION = "mjbj-mostrador-v1";
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
        IMPRESCINDIBLE.map((ruta) =>
          fetch(ruta, { cache: "reload" }).then((r) => guardarSiSirve(cache, ruta, r)),
        ),
      );
      await self.skipWaiting();
    })(),
  );
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

  const respuesta = await fetch(pedido);
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

  try {
    const preload = await evento.preloadResponse;
    const respuesta = preload || (await conTope(pedido));
    await guardarSiSirve(cache, pedido.url, respuesta.clone());
    return respuesta;
  } catch {
    const guardado = (await cache.match(pedido)) || (await cache.match("/mostrador"));
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
async function guardarSiSirve(cache, clave, respuesta) {
  const tipo = respuesta.headers.get("content-type") || "";

  if (respuesta.ok && !respuesta.redirected && tipo.includes("text/html")) {
    await cache.put(clave, respuesta);
  }
}
