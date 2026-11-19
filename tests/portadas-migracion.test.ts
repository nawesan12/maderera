import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTADA, PORTADAS_RETIRADAS } from "@/lib/db/portadas-datos";

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
    const todas = { ...PORTADA, ...PORTADAS_RETIRADAS };
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

  it("ningún rubro con portada la tiene retirada", () => {
    for (const rubro of Object.keys(PORTADAS_RETIRADAS)) expect(PORTADA[rubro]).toBeUndefined();
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
  it("Moldava lleva la misma placa en la portada y en la barra", () => {
    const tonoBarra = barra.match(/slug: "moldava"[\s\S]*?tonoDe: "(\w+)"/)?.[1];
    expect(tonoBarra).toBe("molduras");
    expect(portada).toMatch(new RegExp(`<FondoDeRubro rubro="${tonoBarra}"`));
  });
});
