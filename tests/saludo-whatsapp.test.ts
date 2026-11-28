import { describe, expect, it } from "vitest";
import { nombreDeSaludo } from "@/lib/whatsapp/saludo";

// Espejo de backend/internal/whatsapp/saludo_test.go.
describe("nombreDeSaludo", () => {
  it("a una persona, el primer nombre; a una empresa, el nombre sin la forma societaria", () => {
    expect(nombreDeSaludo("Carpintería Prueba SRL")).toBe("Carpintería Prueba");
    expect(nombreDeSaludo("Marta Gómez")).toBe("Marta");
    expect(nombreDeSaludo("Maderas del Sur")).toBe("Maderas del Sur");
  });

  it("el rubro en la segunda palabra también es una empresa (M2S4-072)", () => {
    expect(nombreDeSaludo("Sim Mueblería Atlántica")).toBe("Sim Mueblería Atlántica");
    expect(nombreDeSaludo("Sim Obra Barrio Parque")).toBe("Sim Obra Barrio Parque");
    expect(nombreDeSaludo("Juan Obra")).toBe("Juan");
    // Mes 23: el rubro en la tercera palabra.
    expect(nombreDeSaludo("Sim V1at Carpintería Ruiz")).toBe("Sim V1at Carpintería Ruiz");
    expect(nombreDeSaludo("Sim V1at Aberturas Norte SRL")).toBe("Sim V1at Aberturas Norte");
    expect(nombreDeSaludo("Ana María Taller")).toBe("Ana");
  });

  it("un club o una escuela, con la asociación civil afuera (M4-106)", () => {
    expect(nombreDeSaludo("Sim Club Náutico Sur Asociación Civil")).toBe("Sim Club Náutico Sur");
    expect(nombreDeSaludo("Club Atlético Kimberley")).toBe("Club Atlético Kimberley");
    expect(nombreDeSaludo("Sim Escuela Técnica 5")).toBe("Sim Escuela Técnica 5");
  });
});
