"use client";

import type { PiezaFijada, PlanoDeCorte } from "@/lib/cortes/tipos";
import type { QuienSeQueda } from "@/lib/cortes/de-quien";
import { PlanoEditable } from "@/components/cortes/plano-editable";
import { formatearMonto } from "@/lib/formato";

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
  quien = {},
  precioPorPasada = null,
}: {
  /** El precio de la pasada: el importe va al lado de su número (M2S3-019). */
  precioPorPasada?: number | null;
  plano: PlanoDeCorte;
  /** Si la medida no salió del catálogo y se está asumiendo una de plaza. */
  medidaSupuesta?: boolean;
  /** Las piezas mandadas a mano a una placa. */
  fijadas: PiezaFijada[];
  onFijadas: (f: PiezaFijada[]) => void;
  /**
   * Lo mismo que va a decir la ficha: la reposición no cobra pasadas y el
   * pedido que vende todas las placas las vende enteras (mes simulado: con
   * «Reposición sin cargo» prendido decía «Se cobra el corte · 2 pasadas a
   * cobrar»).
   */
  quien?: QuienSeQueda & { todasDelCliente?: boolean };
}) {
  const { placaLargo, placaAncho } = plano;

  if (plano.totalPiezas === 0 && plano.noEntran.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-5 py-8 text-center">
        <p className="text-base font-medium">
          El plano aparece al cargar la primera medida
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Numeros plano={plano} quien={quien} precioPorPasada={precioPorPasada} />

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

      <PlanoEditable plano={plano} fijadas={fijadas} onFijadas={onFijadas} quien={quien} />
    </div>
  );
}

function Numeros({
  plano,
  quien,
  precioPorPasada,
}: {
  plano: PlanoDeCorte;
  quien: QuienSeQueda & { todasDelCliente?: boolean };
  precioPorPasada: number | null;
}) {
  const n = plano.placas.length;
  // La placa que trae el cliente no se vende: se cobran todas las pasadas.
  const enteras = quien.placaDelCliente ? 0 : quien.todasDelCliente ? n : plano.placasEnteras;
  const pasadas = quien.placaDelCliente ? plano.pasadas : quien.todasDelCliente ? 0 : plano.pasadasCobrables;
  const placas = quien.media ? (n === 1 ? "media placa" : "medias placas") : n === 1 ? "placa" : "placas";
  const seVenden = quien.media
    ? enteras === 1 ? "media se vende" : "medias se venden"
    : enteras === 1 ? "se vende entera" : "se venden enteras";
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-linea bg-linea sm:grid-cols-4">
      <Celda valor={String(n)} rotulo={placas} />
      {/* La reposición no vende nada: sin la cifra de lo que se vende. */}
      {quien.sinCargo ? (
        <Celda valor="Sin cargo" rotulo="reposición" destacada />
      ) : (
        <Celda valor={String(enteras)} rotulo={seVenden} destacada={enteras > 0} />
      )}
      <Celda
        valor={String(quien.sinCargo ? plano.pasadasCobrables : pasadas)}
        rotulo={
          quien.sinCargo
            ? plano.pasadasCobrables === 1 ? "pasada" : "pasadas"
            : `${pasadas === 1 ? "pasada a cobrar" : "pasadas a cobrar"}${
                  precioPorPasada && pasadas > 0 ? ` · ${formatearMonto(pasadas * precioPorPasada)}` : ""
                }`
        }
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
