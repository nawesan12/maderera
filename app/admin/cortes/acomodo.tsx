"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react";
import { PlanoEditable } from "@/components/cortes/plano-editable";
import {
  calcularPlanoDeCorte,
  type PiezaAcortar,
  type PiezaFijada,
} from "@/lib/cortes/plano";
import { guardarAcomodoManual } from "./actions";

/**
 * Corregir el acomodo de un corte ya cargado.
 *
 * El alta deja mover piezas, pero la decisión se toma muchas veces después: el
 * trabajo entra a la cola y al mirarlo con calma se ve que esa puerta conviene
 * sacarla de la placa nueva. Sin esto había que borrar el corte y cargarlo de
 * nuevo.
 *
 * El plano se recalcula acá, en el navegador, con cada cambio —es geometría
 * pura— y recién se va al servidor al apretar Guardar. Así se puede probar
 * mover una pieza, ver qué pasa con las placas, y arrepentirse sin haber
 * escrito nada.
 */
export function AcomodoDelCorte({
  id,
  piezas,
  placaLargo,
  placaAncho,
  anchoSierra,
  inicial,
}: {
  id: string;
  piezas: PiezaAcortar[];
  placaLargo: number;
  placaAncho: number;
  /** El espesor del disco, de /admin/calculadoras. */
  anchoSierra: number;
  inicial: PiezaFijada[];
}) {
  const [fijadas, setFijadas] = useState<PiezaFijada[]>(inicial);
  const [guardando, empezar] = useTransition();
  const [aviso, setAviso] = useState<{ texto: string; mal: boolean } | null>(
    null,
  );

  const plano = calcularPlanoDeCorte({
    piezas,
    placaLargo,
    placaAncho,
    // El mismo que usó la ficha para presupuestar: si acá se acomodara con
    // otro espesor, mover una pieza podría cambiar el precio sin que nadie
    // tocara el despiece.
    anchoSierra,
    fijadas,
  });

  // Comparado como texto: las dos listas son del mismo origen y el orden no
  // cambia salvo que alguien mueva algo, que es justamente lo que se detecta.
  const sinGuardar = JSON.stringify(fijadas) !== JSON.stringify(inicial);

  return (
    <div className="space-y-3">
      <PlanoEditable
        plano={plano}
        fijadas={fijadas}
        onFijadas={(f) => {
          setFijadas(f);
          setAviso(null);
        }}
      />

      {sinGuardar && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={guardando}
            onClick={() =>
              empezar(async () => {
                const r = await guardarAcomodoManual(id, fijadas);
                setAviso(
                  r.error
                    ? { texto: r.error, mal: true }
                    : { texto: r.ok ?? "Guardado.", mal: false },
                );
              })
            }
            className="inline-flex h-11 items-center gap-2 rounded-lg boton-accion px-4 text-base font-medium disabled:opacity-60"
          >
            {guardando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Guardar el acomodo
          </button>
          <p className="text-base text-muted-foreground">
            Los cambios todavía no se guardaron.
          </p>
        </div>
      )}

      {aviso && (
        <p
          className={`flex items-start gap-1.5 text-base ${
            aviso.mal ? "estado-problema font-medium" : "text-muted-foreground"
          }`}
        >
          {aviso.mal ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <span>{aviso.texto}</span>
        </p>
      )}
    </div>
  );
}
