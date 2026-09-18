import type { MetadataRoute } from "next";
import { sitioIndexable, urlAbsoluta } from "@/lib/seo";

/**
 * Qué puede recorrer un buscador.
 *
 * Tres criterios. Primero, **fuera de producción no se indexa nada**: cada
 * vista previa queda publicada en una URL real y alcanzable, y si Google las
 * encuentra el sitio termina compitiendo consigo mismo con varias copias del
 * catálogo.
 *
 * Segundo, adentro del sitio quedan afuera las pantallas que no son contenido
 * y que además exponen datos de alguien: el panel, la cuenta del cliente, el
 * carrito, el remito que se firma y el puesto de atención. No es una medida
 * de seguridad —eso lo hace la sesión—, es no gastar el presupuesto de rastreo
 * en páginas que devuelven una redirección al login.
 *
 * Tercero, **los robots de inteligencia artificial no son todos lo mismo**, y
 * acá se los trata distinto según lo que hacen con el material. Ver abajo.
 */

/**
 * Los que se llevan el catálogo para entrenar un modelo.
 *
 * No devuelven nada: no mandan una visita, no citan la fuente, no aparece el
 * nombre del negocio en ningún lado. Solo recorren el sitio entero —cada ficha,
 * cada variante— y eso es tráfico que se paga. Quedan afuera.
 */
const DE_ENTRENAMIENTO = [
  "GPTBot",
  "CCBot",
  "ClaudeBot",
  "anthropic-ai",
  "Google-Extended",
  "Applebot-Extended",
  "Meta-ExternalAgent",
  "meta-externalagent",
  "FacebookBot",
  "Bytespider",
  "Amazonbot",
  "Omgili",
  "Diffbot",
  "AI2Bot",
];

/**
 * Los que contestan una pregunta y citan con enlace.
 *
 * Estos sí traen gente: cuando alguien le pregunta a una IA dónde comprar
 * placas en Mar del Plata y aparece «Maderera Juan B. Justo» con el enlace, eso
 * es una visita que no se pagó. Entran, con las mismas restricciones que
 * cualquier buscador.
 */
const QUE_CITAN = [
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Perplexity-User",
  "Claude-User",
  "Claude-SearchBot",
];

/** Lo que no es contenido y no vale la pena rastrear. */
const PRIVADO = [
  "/admin",
  "/atencion",
  "/taller",
  "/mi-cuenta",
  "/carrito",
  "/pedido",
  "/remito",
  "/firmar",
  "/pago-demo",
  "/ingresar",
  "/registro",
  "/api/",
];

export default function robots(): MetadataRoute.Robots {
  if (!sitioIndexable()) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVADO },

      // Los que citan: mismas reglas que cualquiera, dichas aparte para que se
      // vea que es una decisión y no un olvido.
      { userAgent: QUE_CITAN, allow: "/", disallow: PRIVADO },

      // Los de entrenamiento, afuera de todo.
      { userAgent: DE_ENTRENAMIENTO, disallow: "/" },

      /*
       * El armador de cortes queda afuera para **todos**, incluidos los
       * buscadores.
       *
       * Es la pantalla que más CPU cuesta del sitio: cada corte que se arma
       * acomoda piezas con una heurística pesada. No tiene nada que indexar
       * —es una herramienta, no contenido— y lo que se quiere que aparezca en
       * Google es la página que la explica, no la calculadora en sí.
       */
      { userAgent: "*", disallow: ["/corte/"] },
    ],
    sitemap: urlAbsoluta("/sitemap.xml"),
  };
}
