import { describe, expect, it } from "vitest";
import { precioTipeado, textoParaEditar } from "@/lib/precios/editar";

/**
 * Abrir un precio y salir sin tocarlo lo multiplicaba por 100: el campo
 * arrancaba con «84500.00», como lo manda Go, y se leía quitando los puntos.
 */
describe("editar un precio en la tabla", () => {
  it("abrir y cerrar sin tocar no guarda", () => {
    expect(precioTipeado(textoParaEditar("84500.00"), "84500.00")).toBeNull();
    expect(precioTipeado("84500.00", "84500.00")).toBeNull();
    expect(precioTipeado(textoParaEditar("1234.50"), "1234.50")).toBeNull();
  });

  it("el campo arranca como se tipea acá", () => {
    expect(textoParaEditar("84500.00")).toBe("84500");
    expect(textoParaEditar("1234.50")).toBe("1234,5");
  });

  it("lee lo tipeado con la regla de los cobros", () => {
    expect(precioTipeado("84.500", "80000.00")).toBe(84500);
    expect(precioTipeado("84500.00", "80000.00")).toBe(84500);
    expect(precioTipeado("84.500,50", "80000.00")).toBe(84500.5);
    expect(precioTipeado("90000", "80000.00")).toBe(90000);
  });

  it("lo que no es un precio no se guarda", () => {
    expect(precioTipeado("abc", "80000.00")).toBeNaN();
    expect(precioTipeado("-5", "80000.00")).toBeNaN();
    // No hay productos a $0 (comité final, M11).
    expect(precioTipeado("0", "80000.00")).toBeNaN();
    expect(precioTipeado("0,00", "80000.00")).toBeNaN();
  });
});
