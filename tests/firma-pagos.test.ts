import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  firmaValida,
  leerCabeceraFirma,
  manifiestoFirma,
} from "@/lib/pagos/firma";

/**
 * La firma del webhook es la única defensa contra alguien que descubra la URL y
 * mande "pago aprobado" para un pedido que no se pagó. Un error acá no se nota
 * en ninguna pantalla, así que se prueba.
 */

const SECRETO = "clave-de-prueba-del-webhook";

function firmar(dataId: string | null, requestId: string | null, ts: string) {
  return createHmac("sha256", SECRETO)
    .update(manifiestoFirma({ dataId, requestId, ts }))
    .digest("hex");
}

describe("leerCabeceraFirma", () => {
  it("parte ts y v1", () => {
    expect(leerCabeceraFirma("ts=1704908010,v1=abc123")).toEqual({
      ts: "1704908010",
      v1: "abc123",
    });
  });

  it("tolera espacios y orden invertido", () => {
    expect(leerCabeceraFirma(" v1=abc , ts=123 ")).toEqual({
      ts: "123",
      v1: "abc",
    });
  });

  it("devuelve null si falta alguno de los dos", () => {
    expect(leerCabeceraFirma("ts=123")).toBeNull();
    expect(leerCabeceraFirma("basura")).toBeNull();
    expect(leerCabeceraFirma(null)).toBeNull();
  });
});

describe("manifiestoFirma", () => {
  it("respeta el orden del contrato de Mercado Pago", () => {
    expect(
      manifiestoFirma({ dataId: "123", requestId: "req-1", ts: "999" }),
    ).toBe("id:123;request-id:req-1;ts:999;");
  });

  it("omite entero el segmento cuyo valor no vino", () => {
    // Incluirlo vacío da otra firma y hace fallar avisos legítimos.
    expect(manifiestoFirma({ dataId: null, requestId: "req-1", ts: "999" })).toBe(
      "request-id:req-1;ts:999;",
    );
    expect(manifiestoFirma({ dataId: "123", requestId: null, ts: "999" })).toBe(
      "id:123;ts:999;",
    );
  });
});

describe("firmaValida", () => {
  const ahora = 1_700_000_000_000;
  const ts = String(Math.floor(ahora / 1000));

  it("acepta la firma correcta", () => {
    const v1 = firmar("123", "req-1", ts);
    expect(
      firmaValida({ dataId: "123", requestId: "req-1", ts, v1 }, SECRETO, ahora),
    ).toBe(true);
  });

  it("rechaza una firma de otro secreto", () => {
    const v1 = createHmac("sha256", "otro-secreto")
      .update(manifiestoFirma({ dataId: "123", requestId: "req-1", ts }))
      .digest("hex");

    expect(
      firmaValida({ dataId: "123", requestId: "req-1", ts, v1 }, SECRETO, ahora),
    ).toBe(false);
  });

  it("rechaza si cambia el id del pago", () => {
    // Es el ataque concreto: tomar un aviso legítimo y cambiarle el pago.
    const v1 = firmar("123", "req-1", ts);
    expect(
      firmaValida({ dataId: "999", requestId: "req-1", ts, v1 }, SECRETO, ahora),
    ).toBe(false);
  });

  it("rechaza un aviso viejo, aunque la firma sea correcta", () => {
    const viejo = String(Math.floor((ahora - 3_600_000) / 1000));
    const v1 = firmar("123", "req-1", viejo);

    expect(
      firmaValida(
        { dataId: "123", requestId: "req-1", ts: viejo, v1 },
        SECRETO,
        ahora,
      ),
    ).toBe(false);
  });

  it("acepta el ts en milisegundos", () => {
    const tsMs = String(ahora);
    const v1 = firmar("123", null, tsMs);

    expect(
      firmaValida({ dataId: "123", requestId: null, ts: tsMs, v1 }, SECRETO, ahora),
    ).toBe(true);
  });

  it("sin secreto configurado devuelve false, nunca true", () => {
    // Un webhook sin verificar es un endpoint público que acredita pagos.
    const v1 = firmar("123", "req-1", ts);
    expect(
      firmaValida({ dataId: "123", requestId: "req-1", ts, v1 }, null, ahora),
    ).toBe(false);
    expect(
      firmaValida({ dataId: "123", requestId: "req-1", ts, v1 }, "", ahora),
    ).toBe(false);
  });

  it("no se rompe con un v1 de largo distinto", () => {
    expect(
      firmaValida(
        { dataId: "123", requestId: "req-1", ts, v1: "corto" },
        SECRETO,
        ahora,
      ),
    ).toBe(false);
  });

  it("rechaza un ts que no es número", () => {
    expect(
      firmaValida(
        { dataId: "123", requestId: "req-1", ts: "ayer", v1: "a".repeat(64) },
        SECRETO,
        ahora,
      ),
    ).toBe(false);
  });
});
