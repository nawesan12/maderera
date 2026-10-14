import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESCARTADAS,
  destinoDeRutaVieja,
  mapaParaCaddy,
  redireccionesDelSitioViejo,
  redireccionesParaNext,
} from "@/lib/sitio-viejo";

/**
 * Las redirecciones del sitio viejo se prueban contra el relevamiento.
 *
 * Es lo único de la mudanza que no se puede corregir después: el día que
 * `mjbj.ar` deja de ser el WordPress, lo que Google tenía indexado se traslada
 * por estos 301 o se pierde. Un test que recorre cada dirección relevada es la
 * forma de que ninguna quede afuera por olvido.
 */

const relevamiento = JSON.parse(
  readFileSync(join(process.cwd(), "docs/sitio-viejo/relevamiento.json"), "utf8"),
) as { urls: { ruta: string; tipo: string }[] };

/** Las rutas que el sitio nuevo tiene de verdad, para validar los destinos. */
const RUTAS_NUEVAS = [
  "/",
  "/catalogo",
  "/carrito",
  "/carrito/confirmar",
  "/contacto",
  "/nosotros",
  "/sucursales",
  "/sucursales/casa-central",
  "/sucursales/aserradero",
  "/profesionales",
  "/moldava",
  "/mi-cuenta",
  "/mi-cuenta/pedidos",
  "/sitemap.xml",
];

const CATEGORIAS = [
  "techos",
  "placas",
  "pisos",
  "molduras",
  "ferreteria",
  "decks-y-escaleras",
  "construccion-en-seco",
  "cubiertas",
];

function destinoValido(destino: string): boolean {
  const [ruta, consulta] = destino.split("?");
  if (!RUTAS_NUEVAS.includes(ruta)) return false;
  if (!consulta) return true;
  const cat = new URLSearchParams(consulta).get("cat");
  return ruta === "/catalogo" && cat !== null && CATEGORIAS.includes(cat);
}

describe("relevamiento del sitio viejo", () => {
  it("tiene las direcciones del WordPress", () => {
    // Si alguien vuelve a relevar con el sitio viejo ya apagado, el archivo
    // quedaría vacío y todo lo de abajo pasaría sin probar nada.
    expect(relevamiento.urls.length).toBeGreaterThan(200);
    expect(relevamiento.urls.some((u) => u.ruta === "/placas/")).toBe(true);
  });

  it("cada dirección relevada tiene una decisión tomada", () => {
    const sinDecision: string[] = [];
    for (const { ruta } of relevamiento.urls) {
      if (ruta === "/") continue;
      const destino = destinoDeRutaVieja(ruta);
      if (destino === null && !DESCARTADAS[ruta]) {
        // Un archivo descartado lo está por su página de adjunto.
        const descartadoPorAdjunto = relevamiento.urls.some(
          (u) => u.tipo === "archivo" && u.ruta === ruta,
        );
        if (!descartadoPorAdjunto) sinDecision.push(ruta);
      }
    }
    expect(sinDecision).toEqual([]);
  });

  it("todos los destinos existen en el sitio nuevo", () => {
    for (const { ruta } of relevamiento.urls) {
      const destino = destinoDeRutaVieja(ruta);
      if (destino) expect(destinoValido(destino), `${ruta} → ${destino}`).toBe(true);
    }
  });

  it("no manda todo a la portada", () => {
    const paginas = relevamiento.urls.filter((u) => u.tipo === "pagina" && u.ruta !== "/");
    const aPortada = paginas.filter((u) => destinoDeRutaVieja(u.ruta) === "/");
    // Solo el blog vacío va a la portada.
    expect(aPortada.map((u) => u.ruta)).toEqual(["/blog/"]);
  });
});

describe("destinos", () => {
  it.each([
    ["/placas/", "/catalogo?cat=placas"],
    ["/placas", "/catalogo?cat=placas"],
    ["/PLACAS/", "/catalogo?cat=placas"],
    ["/techos/?fbclid=abc", "/catalogo?cat=techos"],
    ["/product-category/costruccion-en-seco/", "/catalogo?cat=construccion-en-seco"],
    ["/contactenos/", "/contacto"],
    ["/quienes-somos/", "/nosotros"],
    ["/profesionales-y-constructoras/", "/profesionales"],
    ["/placas/melaminas/", "/catalogo?cat=placas"],
    ["/mdh/2023/12/melaminas.jpg", "/catalogo?cat=placas"],
    ["/mdh/2023/12/melaminas-300x200.jpg", "/catalogo?cat=placas"],
    ["/mdh/2023/12/casa-central.webp", "/sucursales/casa-central"],
    ["/mdh/2023/12/moldava-catalogo-de-productos.pdf", "/moldava"],
    ["/inicio/home-molduras/", "/catalogo?cat=molduras"],
    ["/sitemap_index.xml", "/sitemap.xml"],
  ])("%s → %s", (origen, destino) => {
    expect(destinoDeRutaVieja(origen)).toBe(destino);
  });

  it("deja caer el relleno del tema y lo desconocido", () => {
    expect(destinoDeRutaVieja("/dummy-image-1/")).toBeNull();
    expect(destinoDeRutaVieja("/mdh/2016/08/dummy-1.jpg")).toBeNull();
    expect(destinoDeRutaVieja("/catalogo/tirante-pino")).toBeNull();
    expect(destinoDeRutaVieja("/algo-que-nunca-existio/")).toBeNull();
  });
});

describe("Caddy", () => {
  it("el archivo commiteado está al día con la lista", () => {
    const enDisco = readFileSync(
      join(process.cwd(), "servidor/caddy/sitio-viejo.caddy"),
      "utf8",
    );
    // Si falla: `npx tsx scripts/generar-redirecciones-caddy.ts`.
    expect(enDisco).toBe(mapaParaCaddy());
  });

  it("es un solo salto: cada destino es final", () => {
    for (const { destino } of redireccionesDelSitioViejo()) {
      // Un destino que a su vez es origen sería una cadena.
      expect(destinoDeRutaVieja(destino.split("?")[0]), destino).toSatisfy(
        (d: string | null) => d === null || d === destino.split("?")[0],
      );
      expect(destino.endsWith("/") && destino !== "/").toBe(false);
    }
  });
});

describe("Next", () => {
  const reglas = redireccionesParaNext();

  it("no se redirige nada a sí mismo", () => {
    for (const r of reglas) {
      expect(r.destination.split("?")[0], r.source).not.toBe(r.source);
    }
  });

  it("las fuentes van sin barra final, que Next ya sacó", () => {
    for (const r of reglas) expect(r.source.endsWith("/"), r.source).toBe(false);
  });

  it("los nombres de archivo no necesitan escaparse en el patrón", () => {
    for (const r of reglas.filter((x) => x.source.startsWith("/mdh/"))) {
      const nombre = r.source.match(/:archivo\(([^(]+)\(/)![1];
      expect(nombre).toMatch(/^[a-z0-9_-]+$/);
    }
  });

  it("no pisa rutas del sitio nuevo", () => {
    const fuentes = new Set(reglas.map((r) => r.source));
    for (const ruta of RUTAS_NUEVAS) expect(fuentes.has(ruta), ruta).toBe(false);
  });
});
