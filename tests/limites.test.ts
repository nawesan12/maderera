import { describe, expect, it } from "vitest";
import {
  cuantoFalta,
  evaluar,
  inicioDeVentana,
  type Limite,
} from "@/lib/limites/ventana";

/**
 * El límite de frecuencia.
 *
 * Se prueba porque es de las pocas piezas del sistema donde **equivocarse para
 * el lado seguro también rompe**: un límite demasiado flojo deja pasar la ráfaga
 * que viene a frenar, y uno que no se suelta deja a un cliente sin poder
 * comprar, que es peor que no tenerlo.
 */
const limite: Limite = { maximo: 5, ventanaSegundos: 60 };

describe("la ventana", () => {
  it("agrupa todos los intentos del mismo minuto en la misma fila", () => {
    const a = inicioDeVentana(new Date("2026-03-14T10:05:03Z"), 60);
    const b = inicioDeVentana(new Date("2026-03-14T10:05:59Z"), 60);

    expect(a.getTime()).toBe(b.getTime());
  });

  it("empieza una ventana nueva al pasar el minuto", () => {
    const a = inicioDeVentana(new Date("2026-03-14T10:05:59Z"), 60);
    const b = inicioDeVentana(new Date("2026-03-14T10:06:00Z"), 60);

    expect(b.getTime()).toBeGreaterThan(a.getTime());
  });
});

describe("si el intento entra", () => {
  const ahora = new Date("2026-03-14T10:05:30Z");
  const inicio = inicioDeVentana(ahora, 60);

  it("deja pasar hasta el máximo", () => {
    for (let cuenta = 1; cuenta <= 5; cuenta++) {
      expect(evaluar(cuenta, limite, ahora, inicio).permitido).toBe(true);
    }
  });

  it("frena el que se pasa", () => {
    const v = evaluar(6, limite, ahora, inicio);

    expect(v.permitido).toBe(false);
    expect(v.quedan).toBe(0);
  });

  it("dice cuánto falta para reintentar", () => {
    // La ventana arranca a las 10:05:00 y dura 60 s; son las 10:05:30.
    expect(evaluar(6, limite, ahora, inicio).esperaSegundos).toBe(30);
  });

  it("el que entra no tiene que esperar nada", () => {
    expect(evaluar(1, limite, ahora, inicio).esperaSegundos).toBe(0);
  });

  it("va diciendo cuántos quedan", () => {
    expect(evaluar(1, limite, ahora, inicio).quedan).toBe(4);
    expect(evaluar(5, limite, ahora, inicio).quedan).toBe(0);
  });

  it("la ventana se suelta sola: con la cuenta en uno otra vez, pasa", () => {
    // Es el caso que importa de verdad. Un límite que no se suelta deja a un
    // cliente sin poder comprar y nadie se entera hasta que llama.
    const despues = new Date("2026-03-14T10:06:01Z");
    const ventanaNueva = inicioDeVentana(despues, 60);

    expect(ventanaNueva.getTime()).toBeGreaterThan(inicio.getTime());
    expect(evaluar(1, limite, despues, ventanaNueva).permitido).toBe(true);
  });
});

describe("cómo se le dice a una persona", () => {
  it("no dice «94 segundos»", () => {
    expect(cuantoFalta(94)).toBe("2 minutos");
  });

  it("lo corto es «unos segundos»", () => {
    expect(cuantoFalta(5)).toBe("unos segundos");
    expect(cuantoFalta(45)).toBe("unos segundos");
  });

  it("un minuto es un minuto", () => {
    expect(cuantoFalta(60)).toBe("un minuto");
  });

  it("lo largo pasa a horas", () => {
    expect(cuantoFalta(3600)).toBe("una hora");
    expect(cuantoFalta(7200)).toBe("2 horas");
  });
});
