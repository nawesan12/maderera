import { describe, expect, it } from "vitest";
import { leerTienda } from "@/lib/tienda";

/**
 * Los interruptores de la tienda se leen igual que en Go
 * (`backend/internal/catalogo/tienda.go`): encendido solo con «si», y un
 * ajuste que no existe cuenta como encendido, que es como andaba el sitio
 * antes de que existieran.
 */
describe("leerTienda", () => {
  it("la primera entrega: los dos apagados", () => {
    expect(leerTienda({ tienda_activa: "no", stock_visible: "no" })).toEqual({ activa: false, stockVisible: false });
  });

  it("sin los ajustes, la tienda de siempre", () => {
    expect(leerTienda({ whatsapp_principal: "5492235903118" })).toEqual({ activa: true, stockVisible: true });
  });

  it("solo «si» enciende: un valor raro no abre la tienda", () => {
    expect(leerTienda({ tienda_activa: "sí", stock_visible: "" })).toEqual({ activa: false, stockVisible: false });
    expect(leerTienda({ tienda_activa: "si", stock_visible: "no" })).toEqual({ activa: true, stockVisible: false });
  });
});
