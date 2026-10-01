import { describe, expect, it } from "vitest";
import { leerDocumento, precargaDelAlta, sugerirCondicionIva } from "@/lib/clientes/documento";
import { ordenarClientes } from "@/lib/mostrador/ranking-clientes";

/**
 * El alta de un cliente en el mostrador (nota del 30/9/2026: «hacer
 * eficiencia al momento de cargar clientes en caja»). Lo que se fija es lo que
 * después cuesta: un CUIT inválido termina en una factura rechazada, y uno
 * guardado de otra forma duplica al cliente.
 */
describe("el documento del cliente nuevo", () => {
  it("reconoce un CUIT válido con o sin guiones", () => {
    expect(leerDocumento("20-12345678-6")).toEqual({ tipo: "cuit", digitos: "20123456786" });
    expect(leerDocumento("30589445259")).toEqual({ tipo: "cuit", digitos: "30589445259" });
  });

  it("rechaza un CUIT con el verificador mal", () => {
    expect(leerDocumento("20-12345678-0")).toEqual({ error: expect.stringMatching(/verificador/) });
  });

  it("reconoce un DNI de siete u ocho números", () => {
    expect(leerDocumento("12.345.678")).toEqual({ tipo: "dni", digitos: "12345678" });
    expect(leerDocumento("1234567")).toEqual({ tipo: "dni", digitos: "1234567" });
  });

  it("vacío es válido: el consumidor final que deja solo el nombre", () => {
    expect(leerDocumento("")).toEqual({ tipo: "ninguno" });
  });

  it("cualquier otro largo no es un documento", () => {
    expect(leerDocumento("12345")).toEqual({ error: expect.any(String) });
  });
});

describe("la condición de IVA que se propone", () => {
  it("una sociedad es responsable inscripta", () => {
    expect(sugerirCondicionIva({ tipo: "cuit", digitos: "30589445259" })).toBe("responsable_inscripto");
  });

  it("de una persona no se adivina: se propone consumidor final", () => {
    expect(sugerirCondicionIva({ tipo: "cuit", digitos: "20123456786" })).toBe("consumidor_final");
    expect(sugerirCondicionIva({ tipo: "dni", digitos: "12345678" })).toBe("consumidor_final");
  });
});

describe("lo que se buscó pasa al alta", () => {
  it("un número va al documento", () => {
    expect(precargaDelAlta("20-12345678-6")).toEqual({ nombre: "", documento: "20-12345678-6" });
  });

  it("un nombre va al nombre", () => {
    expect(precargaDelAlta("García")).toEqual({ nombre: "García", documento: "" });
    expect(precargaDelAlta("Obra 25 de Mayo")).toEqual({ nombre: "Obra 25 de Mayo", documento: "" });
  });
});

describe("el orden del buscador de clientes", () => {
  const clientes = [
    { id: "a", nombre: "Ana García", razonSocial: null, cuit: null },
    { id: "b", nombre: "García Hnos", razonSocial: "García Hermanos S.A.", cuit: "30589445259" },
    { id: "c", nombre: "Pedro Garcíarena", razonSocial: null, cuit: "20123456786" },
    { id: "d", nombre: "García Luis", razonSocial: null, cuit: null },
  ];

  it("el documento exacto va primero", () => {
    expect(ordenarClientes(clientes, "20-12345678-6")[0]!.id).toBe("c");
    // El DNI dentro del CUIT también encuentra a la persona.
    expect(ordenarClientes(clientes, "12345678")[0]!.id).toBe("c");
  });

  it("después el que empieza con lo tipeado, y entre iguales el más reciente", () => {
    const orden = ordenarClientes(clientes, "garcia", ["d"]).map((c) => c.id);
    expect(orden.slice(0, 2)).toEqual(["d", "b"]);
    // «Ana García» contiene una palabra que empieza así: va después.
    expect(orden.indexOf("a")).toBeGreaterThan(1);
  });
});
