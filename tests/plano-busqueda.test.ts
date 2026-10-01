import { describe, expect, it } from "vitest";
import {
  calcularPlanoDeCorte,
  calcularPlanoDeCorteSinTrabar,
  type PlanoDeCorte,
} from "@/lib/cortes/plano";
import { despiecesDePrueba } from "../scripts/benchmark-plano";

/**
 * La búsqueda del plano de corte.
 *
 * Lo que tiene que garantizar no es «encontrar el óptimo», que no encuentra,
 * sino tres cosas de las que depende la plata: **nunca gastar más placas que
 * la heurística sola**, **dar siempre el mismo plano para el mismo despiece**
 * —porque el plano no se guarda y se rehace en la ficha, el PDF y la hoja del
 * taller— y **no armar nada que la sierra no pueda cortar**.
 */

const banco = despiecesDePrueba(40);

const retal = (p: PlanoDeCorte) =>
  p.recorteMayor ? p.recorteMayor.ancho * p.recorteMayor.alto : 0;

describe("la búsqueda del plano", () => {
  it("nunca gasta más placas que la heurística, y a igualdad no deja un retal menor", () => {
    let conBusqueda = 0;
    let sinBusqueda = 0;
    for (const d of banco) {
      const heuristica = calcularPlanoDeCorte({ ...d, busqueda: false });
      const buscado = calcularPlanoDeCorte(d);
      expect(buscado.placas.length).toBeLessThanOrEqual(heuristica.placas.length);
      if (buscado.placas.length === heuristica.placas.length) {
        expect(retal(buscado)).toBeGreaterThanOrEqual(retal(heuristica));
      }
      conBusqueda += buscado.placas.length;
      sinBusqueda += heuristica.placas.length;
    }
    // Y sobre el banco, efectivamente ahorra placas: si esto deja de pasar, la
    // búsqueda se rompió en silencio y solo devuelve la heurística.
    expect(conBusqueda).toBeLessThan(sinBusqueda);
  });

  it("da el mismo plano cada vez, y el servidor el mismo que el navegador", async () => {
    for (const d of banco.slice(0, 10)) {
      const a = calcularPlanoDeCorte(d);
      const b = calcularPlanoDeCorte(d);
      const servidor = await calcularPlanoDeCorteSinTrabar(d);
      expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      expect(JSON.stringify(servidor)).toBe(JSON.stringify(a));
    }
  });

  it("con otra semilla puede dar otro plano, pero siempre el mismo para esa semilla", () => {
    const d = banco[3]!;
    const a = calcularPlanoDeCorte({ ...d, semilla: 7 });
    const b = calcularPlanoDeCorte({ ...d, semilla: 7 });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("no gira una pieza con veta", () => {
    for (const d of banco) {
      const plano = calcularPlanoDeCorte(d);
      for (const placa of plano.placas) {
        for (const pieza of placa.piezas) {
          if (d.piezas[pieza.indice]!.respetaVeta === 1) {
            expect(pieza.girada).toBe(false);
          }
        }
      }
    }
  });

  it("deja el ancho de la sierra entre pieza y pieza y no se sale de la placa", () => {
    const sierra = 5;
    for (const d of banco) {
      const plano = calcularPlanoDeCorte({ ...d, anchoSierra: sierra });
      for (const placa of plano.placas) {
        for (const p of placa.piezas) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.x + p.ancho).toBeLessThanOrEqual(d.placaLargo);
          expect(p.y + p.alto).toBeLessThanOrEqual(d.placaAncho);
        }
        const piezas = placa.piezas;
        for (let i = 0; i < piezas.length; i++) {
          for (let j = i + 1; j < piezas.length; j++) {
            const a = piezas[i]!;
            const b = piezas[j]!;
            const separadas =
              a.x + a.ancho + sierra <= b.x ||
              b.x + b.ancho + sierra <= a.x ||
              a.y + a.alto + sierra <= b.y ||
              b.y + b.alto + sierra <= a.y;
            expect(separadas).toBe(true);
          }
        }
      }
    }
  });

  it("no pierde ni duplica piezas", () => {
    for (const d of banco) {
      const plano = calcularPlanoDeCorte(d);
      const pedidas = d.piezas.reduce((t, p) => t + p.cantidad, 0);
      const colocadas = plano.placas.reduce((t, p) => t + p.piezas.length, 0);
      expect(colocadas + plano.noEntran.length).toBe(pedidas);
      const claves = plano.placas.flatMap((p) => p.piezas.map((x) => `${x.indice}/${x.unidad}`));
      expect(new Set(claves).size).toBe(claves.length);
    }
  });

  it("respeta la placa a la que alguien mandó una pieza a mano", () => {
    const d = banco.find((x) => calcularPlanoDeCorte(x).placas.length >= 2)!;
    const plano = calcularPlanoDeCorte(d);
    // La primera pieza de la placa 1, mandada a la placa 2.
    const elegida = plano.placas[0]!.piezas[0]!;
    const fijadas = [{ indice: elegida.indice, unidad: elegida.unidad, placa: 2 }];
    const conFijada = calcularPlanoDeCorte({ ...d, fijadas });
    expect(conFijada.fijadasDescartadas).toEqual([]);
    const enLaDos = conFijada.placas[1]!.piezas.some(
      (p) => p.indice === elegida.indice && p.unidad === elegida.unidad,
    );
    expect(enLaDos).toBe(true);
    // Y con la búsqueda sigue siendo reproducible.
    expect(JSON.stringify(calcularPlanoDeCorte({ ...d, fijadas }))).toBe(
      JSON.stringify(conFijada),
    );
  });

  it("con muchísimas piezas no busca: la heurística sola, en milisegundos", () => {
    const piezas = [{ largoMm: 300, anchoMm: 200, cantidad: 500, respetaVeta: 0 }];
    const datos = { piezas, placaLargo: 2750, placaAncho: 1830 };
    expect(JSON.stringify(calcularPlanoDeCorte(datos))).toBe(
      JSON.stringify(calcularPlanoDeCorte({ ...datos, busqueda: false })),
    );
  });
});
