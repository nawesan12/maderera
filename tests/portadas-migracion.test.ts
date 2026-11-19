import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTADA } from "@/lib/db/portadas-datos";

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
    expect(Object.keys(PORTADA)).toHaveLength(8);
    for (const [rubro, url] of Object.entries(PORTADA)) expect(up, rubro).toContain(`'${url}'`);
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
