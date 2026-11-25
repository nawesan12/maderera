import { describe, expect, it } from "vitest";
import { secciones, seccionesPara } from "@/components/admin/secciones";
import { puedeEntrar, type RolStaff } from "@/lib/roles";

/**
 * El menú pregunta lo mismo que la página (hallazgo 31, T7).
 *
 * El menú filtraba por la clave exacta de `ACCESO` y la página por prefijo:
 * Vendedores y Seguimiento, sin clave propia, le aparecían al depósito y al
 * tocarlas rebotaba.
 */
const ROLES: RolStaff[] = ["admin", "vendedor", "deposito", "aserradero"];
const hrefs = (rol: RolStaff) => seccionesPara(rol).flatMap((s) => s.items.map((i) => i.href));

describe("el menú de cada rol", () => {
  for (const rol of ROLES) {
    it(`${rol}: muestra exactamente lo que puede abrir`, () => {
      const suyos = hrefs(rol);
      for (const href of suyos) expect(puedeEntrar(href, rol), href).toBe(true);
      const todos = secciones.flatMap((s) => s.items.map((i) => i.href));
      for (const href of todos.filter((h) => puedeEntrar(h, rol))) {
        expect(suyos, href).toContain(href);
      }
    });
  }

  it("el depósito no ve Vendedores ni Seguimiento; el vendedor ve Seguimiento", () => {
    expect(hrefs("deposito")).not.toContain("/admin/clientes/vendedores");
    expect(hrefs("deposito")).not.toContain("/admin/clientes/seguimiento");
    expect(hrefs("vendedor")).toContain("/admin/clientes/seguimiento");
  });

  it("sin rol resuelto devuelve todo: el servidor vuelve a chequear", () => {
    expect(seccionesPara(null).flatMap((s) => s.items)).toHaveLength(
      secciones.flatMap((s) => s.items).length,
    );
  });
});
