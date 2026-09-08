import "server-only";

import { db } from "@/lib/db";
import { calculatorSettings } from "@/lib/db/schema";
import { cachearPublico, ETIQUETAS } from "@/lib/cache-publico";
import {
  ANCHO_DE_SIERRA_MM,
  FACTOR_PENDIENTE,
  MARGEN_DE_SEGURIDAD,
  MEDIDA_DECK_POR_DEFECTO,
  MERMA_MACHIMBRE,
  RINDE_ROLLO_AISLACION,
  RINDE_ROLLO_MEMBRANA,
  SEPARACION_TIRANTES_PISO,
  SEPARACION_TIRANTES_TECHO,
  type ParametrosDeCalculo,
} from "@/lib/calculations";

/**
 * Los parámetros con los que calculan las calculadoras.
 *
 * `lib/calculations.ts` sigue sin tocar la base: son funciones puras con tests,
 * y los valores entran por argumento. Este archivo es el único puente entre
 * esos números y la pantalla donde se editan.
 *
 * Si no hay fila cargada devuelve las constantes del código, que son las del
 * brief. Eso importa: una calculadora que devuelve cero porque nadie configuró
 * nada es peor que una que usa el valor documentado.
 */
export const PARAMETROS_POR_DEFECTO: ParametrosDeCalculo = {
  mermaMachimbre: MERMA_MACHIMBRE,
  factorPendiente: FACTOR_PENDIENTE,
  margenSeguridad: MARGEN_DE_SEGURIDAD,
  anchoSierraMm: ANCHO_DE_SIERRA_MM,
  rindeRolloMembrana: RINDE_ROLLO_MEMBRANA,
  rindeRolloAislacion: RINDE_ROLLO_AISLACION,
  separacionTechoM: SEPARACION_TIRANTES_TECHO,
  separacionPisoM: SEPARACION_TIRANTES_PISO,
  deck: {
    grandis: { ...MEDIDA_DECK_POR_DEFECTO.grandis },
    pvc: { ...MEDIDA_DECK_POR_DEFECTO.pvc },
  },
};

export const parametrosDeCalculo = cachearPublico(
  async (): Promise<ParametrosDeCalculo> => {
    const [fila] = await db.select().from(calculatorSettings).limit(1);

    if (!fila) return PARAMETROS_POR_DEFECTO;

    return {
      mermaMachimbre: Number(fila.mermaMachimbre),
      factorPendiente: Number(fila.factorPendiente),
      margenSeguridad: Number(fila.margenSeguridad),
      anchoSierraMm: fila.anchoSierraMm,
      rindeRolloMembrana: Number(fila.rindeRolloMembrana),
      rindeRolloAislacion: Number(fila.rindeRolloAislacion),
      separacionTechoM: Number(fila.separacionTechoM),
      separacionPisoM: Number(fila.separacionPisoM),
      deck: {
        grandis: {
          largoM: Number(fila.deckGrandisLargoM),
          anchoM: Number(fila.deckGrandisAnchoM),
        },
        pvc: {
          largoM: Number(fila.deckPvcLargoM),
          anchoM: Number(fila.deckPvcAnchoM),
        },
      },
    };
  },
  ["calculadora", "parametros"],
  ETIQUETAS.catalogo,
);
