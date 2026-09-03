import { describe, expect, it } from "vitest";
import {
  ESPERA_MAXIMA_MS,
  INTENTOS_MAXIMOS,
  esperaPara,
  estaListo,
  nuevoItem,
  reducirCola,
  resumir,
} from "@/lib/mostrador/offline/cola-estado";

const AHORA = 1_000_000;

/**
 * La cola guarda ventas ya cobradas: hay plata en el cajón y mercadería en la
 * calle. La regla que todo esto protege es una sola —**una venta nunca se
 * descarta**— y cada caso de acá es una forma conocida de romperla.
 */
describe("cola de ventas sin conexión", () => {
  it("una venta nueva sale pendiente y lista para el primer intento", () => {
    const item = nuevoItem("abc", AHORA);
    expect(item.estado).toBe("pendiente");
    expect(estaListo(item, AHORA)).toBe(true);
  });

  it("la respuesta del servidor la confirma con su número", () => {
    const item = reducirCola(
      nuevoItem("abc", AHORA),
      { tipo: "sincronizada", numero: "PED-1206", orderId: "o1" },
      AHORA,
    );

    expect(item.estado).toBe("confirmada");
    expect(item.resultado?.numero).toBe("PED-1206");
  });

  it("lo confirmado no vuelve a la cola aunque llegue una respuesta tarde", () => {
    // Pasa de verdad: se reintentó, la primera respuesta se perdió, y la
    // segunda llega después de que la primera ya confirmó.
    const confirmada = reducirCola(
      nuevoItem("abc", AHORA),
      { tipo: "sincronizada", numero: "PED-1206", orderId: "o1" },
      AHORA,
    );

    const tarde = reducirCola(confirmada, { tipo: "reintentar", motivo: "timeout" }, AHORA);
    expect(tarde.estado).toBe("confirmada");
    expect(tarde).toEqual(confirmada);
  });

  it("un rechazo definitivo no se reintenta nunca", () => {
    // Insistir con algo que el servidor no va a aceptar es un bucle infinito.
    const item = reducirCola(
      nuevoItem("abc", AHORA),
      { tipo: "rechazada", motivo: "El cliente no existe." },
      AHORA,
    );

    expect(item.estado).toBe("rechazada");
    expect(estaListo(item, AHORA + 10_000_000)).toBe(false);
  });

  it("un fallo transitorio espera cada vez más, con tope", () => {
    let item = nuevoItem("abc", AHORA);
    const esperas: number[] = [];

    for (let i = 0; i < 5; i++) {
      item = reducirCola(item, { tipo: "reintentar", motivo: "red" }, AHORA);
      esperas.push(item.proximoIntentoAt - AHORA);
    }

    expect(esperas).toEqual([2000, 4000, 8000, 16000, 32000]);
    expect(esperaPara(99)).toBe(ESPERA_MAXIMA_MS);
  });

  it("después de mucho insistir queda apartada, no borrada", () => {
    let item = nuevoItem("abc", AHORA);

    for (let i = 0; i < INTENTOS_MAXIMOS; i++) {
      item = reducirCola(item, { tipo: "reintentar", motivo: "red" }, AHORA);
    }

    expect(item.estado).toBe("atascada");
    expect(item.clave).toBe("abc");
    expect(item.ultimoError).toBe("red");
  });

  it("la sesión vencida no gasta intentos", () => {
    /*
     * Si contara como intento, una jornada larga sin volver a entrar
     * consumiría los ocho y apartaría ventas perfectamente válidas.
     */
    let item = nuevoItem("abc", AHORA);

    for (let i = 0; i < 20; i++) {
      item = reducirCola(item, { tipo: "sin_sesion" }, AHORA);
    }

    expect(item.intentos).toBe(0);
    expect(item.estado).toBe("pendiente");
  });

  it("no le toca hasta que pasa la espera", () => {
    const item = reducirCola(nuevoItem("abc", AHORA), { tipo: "reintentar", motivo: "red" }, AHORA);

    expect(estaListo(item, AHORA + 1000)).toBe(false);
    expect(estaListo(item, AHORA + 2000)).toBe(true);
  });

  it("mientras se está enviando no se vuelve a mandar", () => {
    // Dos drenajes en paralelo mandarían la misma venta dos veces.
    const item = reducirCola(nuevoItem("abc", AHORA), { tipo: "enviando" }, AHORA);
    expect(estaListo(item, AHORA)).toBe(false);
  });

  it("el resumen cuenta lo que falta subir", () => {
    const items = [
      nuevoItem("1", AHORA),
      reducirCola(nuevoItem("2", AHORA), { tipo: "enviando" }, AHORA),
      reducirCola(nuevoItem("3", AHORA), { tipo: "sincronizada", numero: "PED-1", orderId: "o" }, AHORA),
      reducirCola(nuevoItem("4", AHORA), { tipo: "rechazada", motivo: "x" }, AHORA),
    ];

    const r = resumir(items);
    expect(r.sinSubir).toBe(2);
    expect(r.rechazadas).toBe(1);
    expect(r.pendientes).toBe(1);
  });
});
