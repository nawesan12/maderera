import { describe, expect, it } from "vitest";
import { nombreDeSeccion, rebote } from "@/components/admin/secciones";

/** El rebote de permisos dice a qué no se tiene acceso, con el nombre del menú. */
describe("el aviso del rebote de permisos", () => {
  it("nombra la sección de la ruta, la más específica", () => {
    expect(nombreDeSeccion("/admin/precios")).toBe("Precios");
    expect(nombreDeSeccion("/admin/precios/formas-de-pago")).toBe("Precios");
    expect(nombreDeSeccion("/admin/clientes/123")).toBe("Clientes");
    expect(nombreDeSeccion("/admin/clientes/vendedores")).toBe("Vendedores");
  });
  it("no repite una dirección que no es del menú", () => {
    expect(nombreDeSeccion("/admin")).toBeNull();
    expect(nombreDeSeccion("/admin/<script>")).toBeNull();
    expect(nombreDeSeccion("/otra")).toBeNull();
  });
  it("arma el destino con la ruta, salvo el resumen", () => {
    expect(rebote("/admin", "/admin/precios")).toBe("/admin?sin-acceso=%2Fadmin%2Fprecios");
    expect(rebote("/taller", "/admin/clientes")).toBe("/taller?sin-acceso=%2Fadmin%2Fclientes");
    expect(rebote("/taller", "/admin")).toBe("/taller");
    expect(rebote("/admin", "")).toBe("/admin");
  });
});
