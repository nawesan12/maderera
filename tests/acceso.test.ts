import { describe, expect, it } from "vitest";
import { ACCESO, puedeEntrar, quienEntra } from "@/lib/roles";

/**
 * Quién entra a cada sección del panel.
 *
 * Se prueba porque es lo único que separa a un vendedor de la pantalla de
 * precios, y porque el error que esto arregla no se veía: el menú escondía las
 * secciones y las páginas las abrían igual. Un test no habría escondido nada.
 */
describe("acceso a las secciones del panel", () => {
  it("deja al admin en todos lados", () => {
    for (const ruta of Object.keys(ACCESO)) {
      expect(puedeEntrar(ruta, "admin")).toBe(true);
    }
  });

  it("no deja al vendedor donde se toca plata o configuración", () => {
    for (const ruta of [
      "/admin/precios",
      "/admin/pagos",
      "/admin/facturacion",
      "/admin/arca",
      "/admin/caja",
      "/admin/migracion",
      "/admin/contenido",
      "/admin/sucursales",
      "/admin/bitacora",
    ]) {
      expect(puedeEntrar(ruta, "vendedor")).toBe(false);
    }
  });

  it("deja al vendedor donde atiende", () => {
    for (const ruta of [
      "/admin",
      "/admin/pedidos",
      "/admin/presupuestos",
      "/admin/clientes",
      "/admin/whatsapp",
      "/mostrador",
    ]) {
      expect(puedeEntrar(ruta, "vendedor")).toBe(true);
    }
  });

  it("al depósito lo deja en stock y pedidos, y afuera del resto", () => {
    expect(puedeEntrar("/admin/stock", "deposito")).toBe(true);
    expect(puedeEntrar("/admin/pedidos", "deposito")).toBe(true);
    expect(puedeEntrar("/admin/precios", "deposito")).toBe(false);
    expect(puedeEntrar("/mostrador", "deposito")).toBe(false);
  });

  it("las direcciones de adentro heredan de su sección", () => {
    // La ficha de un pedido es tan del vendedor como el listado.
    expect(puedeEntrar("/admin/pedidos/PED-1206", "vendedor")).toBe(true);
    // Y la de una factura sigue sin serlo.
    expect(puedeEntrar("/admin/facturacion/abc-123", "vendedor")).toBe(false);
  });

  it("hereda del prefijo más largo y no del primero que coincida", () => {
    // `/admin` deja entrar al vendedor; `/admin/precios` no. La regla que vale
    // es la más específica, si no todo el panel heredaría de `/admin`.
    expect(puedeEntrar("/admin/precios", "vendedor")).toBe(false);
  });

  it("no confunde una sección con otra que empieza igual", () => {
    // `/admin/pagos-especiales` sería otra sección y otra decisión, no una
    // dirección de adentro de `/admin/pagos`.
    expect(quienEntra("/admin/pagos-especiales")).toBeNull();
    expect(puedeEntrar("/admin/pagos-especiales", "vendedor")).toBe(true);
  });

  it("sin rol no entra a ningún lado", () => {
    expect(puedeEntrar("/admin", null)).toBe(false);
    expect(puedeEntrar("/admin/pedidos", null)).toBe(false);
  });
});
