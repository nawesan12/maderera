"use client";

import type { PiezaFijada, PlanoDeCorte } from "@/lib/cortes/plano";
import { PlanoEditable } from "@/components/cortes/plano-editable";

/**
 * El plano, mientras se carga el despiece.
 *
 * **No se puede vender un corte sin ver antes cómo queda adentro de la placa.**
 * De ese acomodo sale todo lo que decide quien atiende: cuántas placas, si se
 * vende el corte o la placa entera, y cuántas pasadas se cobran.
 *
 * El plano llega ya calculado: lo resuelve el formulario, que lo necesita
 * también para proponer cuántas placas. `lib/cortes/plano.ts` es geometría pura
 * y corre en el navegador, así que se rehace con cada medida que se tipea, sin
 * ida y vuelta. Cargar una pieza y ver al instante que se pasó a una segunda
 * placa es exactamente la información que hace falta **antes** de decirle un
 * precio a alguien que está esperando en el mostrador.
 */
export function PlanoEnVivo({
  plano,
  medidaSupuesta,
  fijadas,
  onFijadas,
}: {
  plano: PlanoDeCorte;
  /** Si la medida no salió del catálogo y se está asumiendo una de plaza. */
  medidaSupuesta?: boolean;
  /** Las piezas mandadas a mano a una placa. */
  fijadas: PiezaFijada[];
  onFijadas: (f: PiezaFijada[]) => void;
}) {
  const { placaLargo, placaAncho } = plano;

  if (plano.totalPiezas === 0 && plano.noEntran.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-5 py-8 text-center">
        <p className="text-base font-medium">
          El plano aparece al cargar la primera medida
        </p>
        <p className="mt-1 text-base text-muted-foreground">
          Cargá largo, ancho y cantidad y vas a ver cómo entran las piezas en la
          placa, cuántas hacen falta y si conviene vender la placa entera.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Numeros plano={plano} />

      {medidaSupuesta && (
        <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-4 py-3 text-base">
          La placa no salió del catálogo, así que el plano está hecho sobre{" "}
          <span className="tabular font-medium">
            {placaLargo} × {placaAncho} mm
          </span>
          . Elegí la placa arriba para que las cuentas sean las de verdad.
        </p>
      )}

      {plano.noEntran.length > 0 && (
        <p className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-4 py-3 text-base font-medium">
          {plano.noEntran.length === 1
            ? "Una pieza no entra en la placa"
            : `${plano.noEntran.length} piezas no entran en la placa`}
          :{" "}
          {plano.noEntran
            .map((p) => `${p.largoMm} × ${p.anchoMm} mm`)
            .join(", ")}
          . Revisá las medidas o elegí una placa más grande. Si la pieza respeta
          la veta, girarla no es opción.
        </p>
      )}

      <PlanoEditable plano={plano} fijadas={fijadas} onFijadas={onFijadas} />
    </div>
  );
}

function Numeros({ plano }: { plano: PlanoDeCorte }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea sm:grid-cols-4">
      <Celda
        valor={String(plano.placas.length)}
        rotulo={plano.placas.length === 1 ? "placa" : "placas"}
      />
      <Celda
        valor={String(plano.placasEnteras)}
        rotulo={
          plano.placasEnteras === 1
            ? "se vende entera"
            : "se venden enteras"
        }
        destacada={plano.placasEnteras > 0}
      />
      <Celda
        valor={String(plano.pasadasCobrables)}
        rotulo="pasadas a cobrar"
      />
      <Celda
        valor={
          plano.recorteMayor
            ? `${plano.recorteMayor.ancho}×${plano.recorteMayor.alto}`
            : "—"
        }
        rotulo={plano.recorteMayor ? "retal que queda, en mm" : "sin retal útil"}
      />
    </div>
  );
}

function Celda({
  valor,
  rotulo,
  destacada,
}: {
  valor: string;
  rotulo: string;
  destacada?: boolean;
}) {
  return (
    <div className={`px-3.5 py-3 ${destacada ? "estado-marca bg-[var(--estado-fondo)]" : "bg-card"}`}>
      <p className="tabular text-2xl font-bold leading-none">{valor}</p>
      <p className="mt-1 text-sm text-muted-foreground">{rotulo}</p>
    </div>
  );
}
