import { describe, expect, it } from "vitest";
import { rutaDeEntidad } from "@/lib/dal/admin/rutas-entidad";

/**
 * A dónde lleva cada renglón de la bitácora y de la campana.
 *
 * Se prueba porque el id que anota la bitácora **no siempre es un uuid**: hay
 * acciones que guardan el número visible ("CRT-459") porque es lo que sirve
 * para leer el renglón. Tratarlos igual armaría `/admin/cortes/CRT-459`, que
 * es un 404, y el enlace fallaría justo en la pantalla que se abre cuando algo
 * no cuadra.
 */
describe("rutas de la bitácora", () => {
  const UUID = "7bd3a414-3856-4932-a220-3244b53a1f10";

  it("abre la ficha cuando el id es un uuid", () => {
    expect(rutaDeEntidad("cliente", UUID)).toBe(`/admin/clientes/${UUID}`);
    expect(rutaDeEntidad("pedido", UUID)).toBe(`/admin/pedidos/${UUID}`);
    expect(rutaDeEntidad("factura", UUID)).toBe(`/admin/facturacion/${UUID}`);
  });

  it("busca en el listado cuando el id es el número visible", () => {
    expect(rutaDeEntidad("corte", "CRT-459")).toBe("/admin/cortes?buscar=CRT-459");
    expect(rutaDeEntidad("pedido", "PED-1205")).toBe(
      "/admin/pedidos?buscar=PED-1205",
    );
  });

  it("escapa lo que va en el parámetro de búsqueda", () => {
    expect(rutaDeEntidad("presupuesto", "P 2026/0419")).toBe(
      "/admin/presupuestos?buscar=P%202026%2F0419",
    );
  });

  it("lleva al listado cuando la entidad no tiene ficha propia", () => {
    expect(rutaDeEntidad("cheque", UUID)).toBe("/admin/cheques");
    expect(rutaDeEntidad("gasto", UUID)).toBe("/admin/compras/gastos");
    expect(rutaDeEntidad("zona_envio", null)).toBe("/admin/envios");
  });

  it("devuelve la sección sin id cuando no hay a qué apuntar", () => {
    expect(rutaDeEntidad("cliente", null)).toBe("/admin/clientes");
  });

  /*
   * Es el caso que importa que no rompa: una entidad nueva que alguien agregue
   * sin pasar por acá tiene que quedarse sin enlace, no romper la pantalla.
   */
  it("no inventa una ruta para una entidad que no conoce", () => {
    expect(rutaDeEntidad("entidad_que_no_existe", UUID)).toBeNull();
  });
});
