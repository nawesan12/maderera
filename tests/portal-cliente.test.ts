import { describe, expect, it } from "vitest";
import {
  avisoDePagosEnVerificacion,
  distintivoDeLista,
  estadoDelPago,
  mensajeDeConsulta,
  pedidosEnCurso,
  importeAInformar,
  saludoDelCliente,
  unaPorProducto,
} from "@/lib/cuenta/portal";

/** Lo que encontró el mes simulado en «Mi cuenta» (noviembre de 2026). */

describe("el saludo", () => {
  it("a una persona, por su nombre de pila", () => {
    expect(saludoDelCliente("Lucía Fernández", "27-30111222-3")).toBe("Lucía");
    expect(saludoDelCliente("Lucía Fernández", null)).toBe("Lucía");
  });
  it("a una empresa, con el nombre entero (H091)", () => {
    expect(
      saludoDelCliente("Constructora del Sur S.R.L.", "30-71234567-1"),
    ).toBe("Constructora del Sur S.R.L.");
    // Sin CUIT, el nombre de la empresa tampoco se corta en «Constructora».
    expect(saludoDelCliente("Constructora Costa Atlántica SRL", null)).toBe("Constructora Costa Atlántica");
  });
  it("el distintivo es el de su lista", () => {
    expect(distintivoDeLista("profesional", "Lista constructora")).toBe(
      "Constructora",
    );
    expect(distintivoDeLista("profesional", null)).toBe("Profesional");
    expect(distintivoDeLista("particular", null)).toBeNull();
  });
});

describe("los pedidos en curso", () => {
  it("no dicen «en camino» ni «en caminos» (H083, H313)", () => {
    expect(pedidosEnCurso(1)).toBe("1 en curso");
    expect(pedidosEnCurso(2)).toBe("2 en curso");
  });
});

describe("la tarjeta del pago", () => {
  const base = {
    estado: "pendiente",
    estadoPago: "pendiente",
    medioPago: "transferencia",
    total: 1000,
    debeEnCuenta: null,
  };

  it("a cuenta corriente no dice «Falta abonarlo» (H088)", () => {
    const e = estadoDelPago({
      ...base,
      medioPago: "cuenta_corriente",
      debeEnCuenta: 1000,
    });
    expect(e?.etiqueta).toBe("A cuenta corriente");
  });
  it("a cuenta, pagado por imputación o en parte (H208)", () => {
    expect(
      estadoDelPago({ ...base, medioPago: "cuenta_corriente", debeEnCuenta: 0 })
        ?.etiqueta,
    ).toBe("Pagado");
    const parte = estadoDelPago({
      ...base,
      medioPago: "cuenta_corriente",
      debeEnCuenta: 400,
    });
    expect(parte?.etiqueta).toBe("Pagado en parte");
    expect(parte?.falta).toBe(400);
  });
  it("pagado dice pagado y nada más (H214)", () => {
    const e = estadoDelPago({
      ...base,
      estado: "preparando",
      estadoPago: "pagado",
    });
    expect(e).toMatchObject({ etiqueta: "Pagado", sigue: null });
  });
  it("cancelado no habla de datos bancarios ni de preparar (H310)", () => {
    const e = estadoDelPago({
      ...base,
      estado: "cancelado",
      estadoPago: "reintegrado",
    });
    expect(e).toMatchObject({ etiqueta: "Reintegrado", sigue: null });
  });
  it("cancelado sin plata de por medio no dice nada del pago (H310)", () => {
    expect(estadoDelPago({ ...base, estado: "cancelado" })).toBeNull();
  });
  it("entregado y sin pagar dice cuánto falta, sin «al retirar» (H393)", () => {
    const e = estadoDelPago({
      ...base,
      estado: "entregado",
      medioPago: "efectivo",
    });
    expect(e).toMatchObject({
      etiqueta: "Falta abonarlo",
      sigue: null,
      falta: 1000,
    });
  });
  it("una transferencia informada se está verificando", () => {
    expect(estadoDelPago({ ...base, enRevision: 1000 })?.clave).toBe(
      "en_revision",
    );
  });
});

describe("los pagos en verificación", () => {
  it("con dos, «los confirmemos» (H314)", () => {
    expect(avisoDePagosEnVerificacion(2)).toContain("Cuando los confirmemos");
    expect(avisoDePagosEnVerificacion(1)).toContain("Cuando lo confirmemos");
  });
});

describe("la consulta por WhatsApp", () => {
  it("dice quién pregunta si hay sesión (H087)", () => {
    expect(
      mensajeDeConsulta("Hola! Quería el precio de 20 placas.", {
        nombre: "Carpintería Sim",
        cuit: "20-12345678-6",
      }),
    ).toBe(
      "Hola! Quería el precio de 20 placas. Soy Carpintería Sim (CUIT 20-12345678-6).",
    );
    expect(mensajeDeConsulta("Hola!", null)).toBe("Hola!");
  });
  it("un nombre que termina en punto no queda con dos", () => {
    expect(
      mensajeDeConsulta("Hola!", { nombre: "Constructora Atlántica del Sur S.R.L." }),
    ).toBe("Hola! Soy Constructora Atlántica del Sur S.R.L.");
  });
});

describe("las reseñas", () => {
  it("una por producto, aunque se haya comprado en varios pedidos (H391)", () => {
    const items = [
      { productId: "membrana", orderId: "4", yaResenado: false },
      { productId: "placa", orderId: "4", yaResenado: false },
      { productId: "membrana", orderId: "3", yaResenado: true },
      { productId: "membrana", orderId: "2", yaResenado: false },
    ];
    expect(unaPorProducto(items)).toEqual([
      { productId: "membrana", orderId: "4", yaResenado: true },
      { productId: "placa", orderId: "4", yaResenado: false },
    ]);
  });
});

describe("Pagar tu cuenta", () => {
  it("propone lo que se debe menos lo que ya está en revisión", () => {
    expect(importeAInformar(5890600, 566456)).toBe(5324144);
    expect(importeAInformar(1000, 0)).toBe(1000);
  });
  it("si ya está todo informado, el campo va vacío", () => {
    expect(importeAInformar(1000, 1000)).toBeNull();
    expect(importeAInformar(1000, 1500)).toBeNull();
  });
});
