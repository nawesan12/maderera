import { describe, expect, it } from "vitest";
import { avisoDePlacasDelPedido, placasDeLasDelPedido } from "@/lib/cortes/placas-del-pedido";
import { sobreQuePlaca } from "@/lib/cortes/placa";
import { laLista } from "@/lib/precios/nombre-de-lista";
import { etapaDelPedido, estadoVisibleDelPedido } from "@/lib/cuenta/portal";

const n = (x: number) => String(x).replace(".", ",");

describe("las placas del pedido (aserradero, mes 23)", () => {
  it("el alta no avisa cuando los cortes usan menos placas de las que vende el pedido", () => {
    expect(avisoDePlacasDelPedido({ numero: "PED-1147", usadas: 1, otras: 1, vendidas: 3 })).toBeNull();
    expect(avisoDePlacasDelPedido({ numero: "PED-1147", usadas: 3, otras: 0, vendidas: 3 })).toBeNull();
  });
  it("y sí cuando usan más, con el mismo texto que la ficha", () => {
    expect(avisoDePlacasDelPedido({ numero: "PED-1146", usadas: 2, otras: 1, vendidas: 2 })).toBe(
      "Los cortes de PED-1146 usan 3 placas y el pedido vende 2 placas.",
    );
    expect(avisoDePlacasDelPedido({ numero: "PED-1146", usadas: 3, otras: 0, vendidas: 2 })).toBe(
      "El plano usa 3 placas y el pedido PED-1146 vende 2 placas.",
    );
  });
  it("la ficha dice «1 de 3», nunca «3 de 2»", () => {
    expect(placasDeLasDelPedido(1, 3, n)).toBe("1 de 3");
    expect(placasDeLasDelPedido(0.5, 3, n)).toBe("0,5 de 3");
    expect(placasDeLasDelPedido(3, 2, n)).toBe("3");
  });
});

describe("el corte en el carrito (M3S1-008)", () => {
  it("dice sobre qué placa se corta, no que la placa va incluida", () => {
    expect(sobreQuePlaca({ mitad: null, placaLargoMm: 2600, placaAnchoMm: 1830 })).toBe("Sobre placa de 2600 × 1830 mm");
    expect(sobreQuePlaca({ mitad: "largo", placaLargoMm: 2600, placaAnchoMm: 912 })).toBe("Sobre media placa de 2600 × 912 mm");
  });
});

describe("clientes (mes 23)", () => {
  it("«la Lista profesional», no «la lista Lista profesional»", () => {
    expect(laLista("Lista profesional")).toEqual({ antes: "la ", nombre: "Lista profesional" });
    expect(laLista("Gremio")).toEqual({ antes: "la lista ", nombre: "Gremio" });
    expect(laLista("Listado")).toEqual({ antes: "la lista ", nombre: "Listado" });
  });
  it("el retiro con el remito sin firmar queda en «Listo» en la barra (M2S1-071)", () => {
    const visible = estadoVisibleDelPedido("entregado", [{ estado: "preparada", tipo: "retiro" }]);
    expect(visible).toBe("por-firmar");
    expect(etapaDelPedido(visible)).toBe("listo");
    expect(etapaDelPedido(estadoVisibleDelPedido("entregado", [{ estado: "firmada", tipo: "retiro" }]))).toBe("entregado");
  });
});
