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

  /*
   * Las tres pantallas de puesto fijo viven fuera de `/admin`, así que el layout
   * del panel —que es quien aplica esta lista— no las cubre y cada página tiene
   * que pedirla por su cuenta. El día que no lo hizo, el agujero fue exactamente
   * este: `/admin/whatsapp` rebotaba al depósito y `/atencion`, que es la misma
   * bandeja con los mismos datos, le abría.
   */
  it("la bandeja a pantalla completa es de los mismos que la del panel", () => {
    expect(quienEntra("/atencion")).toEqual(quienEntra("/admin/whatsapp"));

    for (const rol of ["deposito", "aserradero"] as const) {
      expect(puedeEntrar("/atencion", rol)).toBe(false);
    }
    expect(puedeEntrar("/atencion", "vendedor")).toBe(true);
    expect(puedeEntrar("/atencion", "admin")).toBe(true);
  });

  it("el taller lo ve todo el personal y el mostrador no", () => {
    for (const rol of ["admin", "vendedor", "deposito", "aserradero"] as const) {
      expect(puedeEntrar("/taller", rol)).toBe(true);
    }
    // La misma lista que usan la página del mostrador y los endpoints de su
    // copia local, que llevan el padrón de clientes y las dos listas de precios.
    expect(puedeEntrar("/mostrador", "aserradero")).toBe(false);
    expect(puedeEntrar("/mostrador", "deposito")).toBe(false);
  });

  it("ninguna pantalla de puesto fijo quedó sin declarar", () => {
    // Están afuera de `/admin` y no salen en el menú: si alguna se agrega y no
    // se declara, `quienEntra` devuelve null y la abre todo el personal.
    for (const ruta of ["/mostrador", "/atencion", "/taller"]) {
      expect(quienEntra(ruta)).not.toBeNull();
    }
  });

  it("al aserradero le abre los cortes pero no la tarifa del corte", () => {
    /*
     * El layout le deja pasar todo lo que cuelga de `/admin/cortes` —la ficha
     * de un trabajo y el formato para la máquina, que se ajusta parado frente
     * a la seccionadora—, pero la lista sigue mandando adentro de esa carpeta.
     * La tarifa por pasada es un precio, no una regulación de la máquina.
     */
    expect(puedeEntrar("/admin/cortes", "aserradero")).toBe(true);
    expect(puedeEntrar("/admin/cortes/abc-123", "aserradero")).toBe(true);
    expect(puedeEntrar("/admin/cortes/formato", "aserradero")).toBe(true);
    expect(puedeEntrar("/admin/cortes/tarifas", "aserradero")).toBe(false);
    expect(puedeEntrar("/admin/cortes/tarifas", "vendedor")).toBe(false);
  });

  it("sin rol no entra a ningún lado", () => {
    expect(puedeEntrar("/admin", null)).toBe(false);
    expect(puedeEntrar("/admin/pedidos", null)).toBe(false);
    expect(puedeEntrar("/atencion", null)).toBe(false);
    expect(puedeEntrar("/mostrador", null)).toBe(false);
  });
});
