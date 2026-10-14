/**
 * Los errores de hidratación, mandados al servidor con la ruta.
 *
 * Son los que el servidor no ve: el HTML sale bien y se rompe al ensamblarse
 * en el navegador. El React #419 que se vio dos veces en el sitio era de esos,
 * y en la consola de quien lo vio decía el número y nada más. Ver
 * `lib/diagnostico/registro.ts`.
 *
 * Solo en producción —en desarrollo el error se ve entero en pantalla—, solo
 * los de hidratación, y como mucho tres por carga: una página rota no tiene que
 * convertirse en una ráfaga de pedidos.
 */
import { esErrorDeHidratacion } from "@/lib/diagnostico/registro";

let enviados = 0;

function reportar(mensaje: string, pila?: string) {
  if (enviados >= 3 || !esErrorDeHidratacion(mensaje)) return;
  enviados++;

  try {
    const cuerpo = JSON.stringify({
      ruta: location.pathname + location.search,
      mensaje,
      pila: pila?.split("\n").slice(0, 6).join(" | "),
      build: process.env.NEXT_PUBLIC_BUILD_ID,
    });
    // `sendBeacon` sobrevive a que la persona cierre la pestaña; si no está,
    // un fetch común alcanza.
    if (!navigator.sendBeacon?.("/api/diagnostico", new Blob([cuerpo], { type: "application/json" }))) {
      void fetch("/api/diagnostico", { method: "POST", body: cuerpo, keepalive: true });
    }
  } catch {
    // Diagnosticar nunca puede romper la página.
  }
}

if (process.env.NODE_ENV === "production") {
  // React manda los errores de los que se recupera por `reportError`, que es
  // justamente un evento `error` de la ventana.
  window.addEventListener("error", (evento) => {
    const error = evento.error as Error | undefined;
    reportar(error?.message ?? evento.message ?? "", error?.stack);
  });
}
