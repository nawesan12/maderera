import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTADA, PORTADAS_DE_BANCO, PORTADAS_RETIRADAS } from "@/lib/db/portadas-datos";

/*
 * La 00150 borra de los productos las fotos de banco. Si alguien cambia una
 * portada en `portadas-datos.ts` sin sumarla a la migración, la vieja quedaría
 * como foto de producto: esta prueba lo frena.
 */
const sql = readFileSync(
  new URL("../backend/db/migraciones/00150_fotos_de_rubro_fuera_de_producto.sql", import.meta.url),
  "utf8",
);
const up = sql.slice(sql.indexOf("-- +goose Up"), sql.indexOf("-- +goose Down"));

describe("migración 00150", () => {
  it("borra las ocho portadas de los rubros", () => {
    const todas = { ...PORTADAS_DE_BANCO, ...PORTADAS_RETIRADAS };
    expect(Object.keys(todas)).toHaveLength(8);
    for (const [rubro, url] of Object.entries(todas)) expect(up, rubro).toContain(`'${url}'`);
  });

  it("guarda lo que borra y el Down lo devuelve", () => {
    expect(up).toContain("INSERT INTO product_images_rubro_00150");
    expect(up).toMatch(/DELETE FROM product_images WHERE id IN \(SELECT id FROM product_images_rubro_00150\)/);
    const down = sql.slice(sql.indexOf("-- +goose Down"));
    expect(down).toContain("INSERT INTO product_images");
  });

  it("no toca lo que sube la clienta", () => {
    expect(up).not.toContain("/subidas/");
    expect(up).not.toMatch(/LIKE '\/fotos\/%'/);
  });
});

const sql180 = readFileSync(
  new URL("../backend/db/migraciones/00180_portadas_de_banco_fuera.sql", import.meta.url),
  "utf8",
);

describe("migración 00180", () => {
  it("saca de las categorías las portadas retiradas, y solo esas", () => {
    const up = sql180.slice(sql180.indexOf("-- +goose Up"), sql180.indexOf("-- +goose Down"));
    for (const [rubro, url] of Object.entries(PORTADAS_RETIRADAS)) {
      expect(up, rubro).toContain(`'${rubro}'`);
      expect(up, rubro).toContain(`'${url}'`);
    }
    for (const url of Object.values(PORTADA)) expect(up).not.toContain(url);
  });

  it("ningún rubro tiene de portada una foto de banco retirada", () => {
    for (const [rubro, url] of Object.entries(PORTADAS_RETIRADAS)) expect(PORTADA[rubro]).not.toBe(url);
  });
});

/** Comité final, M18: sin portada, la placa del rubro; Moldava sin la foto de Molduras. */
describe("las tarjetas de los rubros", () => {
  const portada = readFileSync(new URL("../app/(public)/page.tsx", import.meta.url), "utf8");
  const barra = readFileSync(new URL("../components/navbar.tsx", import.meta.url), "utf8");
  it("sin foto dibujan la placa del rubro", () => {
    expect(portada).toContain("<FondoDeRubro rubro={cat.slug} />");
    expect(barra).toContain("<FondoDeRubro rubro={link.tonoDe ?? link.slug} />");
  });
  it("Moldava no repite la foto de Molduras", () => {
    expect(portada).not.toMatch(/slug === "molduras"\)\??\.image/);
    expect(barra).not.toContain("imagenDe");
  });
  it("Moldava lleva la estantería y Molduras otra foto (revisión del 19/11)", () => {
    // La tarjeta más grande de la grilla era un degradado liso.
    const tarjeta = portada.slice(portada.indexOf('href="/moldava"'), portada.indexOf("{categorias.map"));
    expect(tarjeta).toContain("src={moldavaCasilleros}");
    expect(tarjeta).not.toContain("<FondoDeRubro");
    // Y Molduras, al lado, no repite la estantería.
    expect(PORTADA.molduras).toBeDefined();
    expect(PORTADA.molduras).not.toMatch(/moldava|estanteria|casilleros/);
  });
});

const sql185 = readFileSync(
  new URL("../backend/db/migraciones/00185_portadas_propias.sql", import.meta.url),
  "utf8",
);
const portadasGo = readFileSync(
  new URL("../backend/internal/catalogo/portadas.go", import.meta.url),
  "utf8",
);

/** Las portadas propias del Drive de la clienta (19/11/2026, docs/fotos.md). */
describe("migración 00185 y la tabla de Go", () => {
  const up = sql185.slice(sql185.indexOf("-- +goose Up"), sql185.indexOf("-- +goose Down"));
  const propias = Object.entries(PORTADA).filter(([, url]) => url.startsWith("/sitio/"));

  it("pone cada portada propia de portadas-datos.ts", () => {
    expect(propias.length).toBeGreaterThan(0);
    for (const [rubro, url] of propias) expect(up, rubro).toContain(`('${rubro}', '${url}')`);
  });

  it("solo pisa portadas de banco, y la de ferretería vacía (la 00180)", () => {
    expect(up).toContain("c.image LIKE '/fotos/%' OR (c.image IS NULL AND c.slug = 'ferreteria')");
  });

  it("no le avisa a Next: lo consumiría la versión anterior, sin las fotos", () => {
    expect(up).not.toContain("trabajos");
  });

  it("las fotos propias llevan versión en el nombre", () => {
    for (const [, url] of propias) expect(url).toMatch(/-v\d+\.webp$/);
  });

  it("Go dice lo mismo que portadas-datos.ts", () => {
    const go = Object.fromEntries(
      [...portadasGo.matchAll(/^\s*"([\w-]+)":\s*"([^"]+)",/gm)].map((m) => [m[1], m[2]]),
    );
    expect(go).toEqual(PORTADA);
  });
});
