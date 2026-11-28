import { describe, expect, it } from "vitest";
import { responderLocal, type Entendido } from "@/lib/asistente/respuestas";

function leido(intencion: Entendido["intencion"], texto: string): Entendido {
  return {
    intencion,
    puntaje: 1,
    texto,
    consulta: "",
    medida: { espesorMm: null, largoMm: null, anchoMm: null },
    cantidad: null,
    rubro: null,
    despiece: null,
    enlace: null,
  } as Entendido;
}

const equipaje = {
  sucursales: [],
  envios: [
    { titulo: "Mar del Plata", detalle: "Sin cargo" },
    { titulo: "Tandil", detalle: "A cotizar" },
  ],
  pagos: [{ titulo: "Efectivo", detalle: "Al retirar" }],
  promociones: [{ titulo: "12 cuotas sin interés · Banco Nación", detalle: "Jueves" }],
};

// Mes simulado: a «¿hacen envíos a Batán?» contestaba «Sí» con una lista
// sin Batán (M2S1-104), y a las cuotas, sin ninguna promoción (M2S1-200).
describe("respuestas del asistente", () => {
  it("contesta la zona que se preguntó, y sin el «Sí» si no está", () => {
    const tandil = responderLocal(leido("envios", "¿llegan a tandil?"), equipaje)!;
    expect(tandil.datos).toEqual([{ titulo: "Tandil", detalle: "A cotizar" }]);
    const batan = responderLocal(leido("envios", "¿hacen envíos a Batán?"), equipaje)!;
    expect(batan.texto.startsWith("Sí")).toBe(false);
    expect(batan.datos).toHaveLength(2);
    expect(batan.aPersona).toBe(true);
  });

  it("las cuotas de la portada van primero", () => {
    const r = responderLocal(leido("pagos", "¿puedo pagar con cuotas?"), equipaje)!;
    expect(r.datos![0].titulo).toContain("12 cuotas");
  });
});
