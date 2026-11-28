"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Save } from "lucide-react";
import { PlanoEditable } from "@/components/cortes/plano-editable";
import type { PiezaAcortar, PiezaFijada } from "@/lib/cortes/tipos";
import type { QuienSeQueda } from "@/lib/cortes/de-quien";
import { piezasParaElPlano, usePlano } from "@/lib/cortes/en-vivo";
import { guardarAcomodoManual } from "./actions";
import { usePublicarPlano } from "./[id]/plano-vivo";

/**
 * Corregir el acomodo de un corte ya cargado.
 *
 * El alta deja mover piezas, pero la decisión se toma muchas veces después: el
 * trabajo entra a la cola y al mirarlo con calma se ve que esa puerta conviene
 * sacarla de la placa nueva. Sin esto había que borrar el corte y cargarlo de
 * nuevo.
 *
 * El plano se recalcula con cada cambio (lo calcula Go, ver
 * `lib/cortes/en-vivo.ts`) y el acomodo recién se guarda al apretar Guardar. Así se puede probar
 * mover una pieza, ver qué pasa con las placas, y arrepentirse sin haber
 * escrito nada.
 */
export function AcomodoDelCorte({
  id,
  piezas,
  placaLargo,
  placaAncho,
  anchoSierra,
  busqueda,
  inicial,
  quien,
}: {
  id: string;
  piezas: PiezaAcortar[];
  placaLargo: number;
  placaAncho: number;
  /** El espesor del disco del trabajo. */
  anchoSierra: number;
  /** Si el trabajo se armó con el motor que busca (ver `motorPlano`). */
  busqueda: boolean;
  inicial: PiezaFijada[];
  /** Cómo se rotula cada placa (ver PlanoEditable). */
  quien?: QuienSeQueda & { todasDelCliente?: boolean };
}) {
  const [fijadas, setFijadas] = useState<PiezaFijada[]>(inicial);
  const [guardando, empezar] = useTransition();
  const [aviso, setAviso] = useState<{ texto: string; mal: boolean } | null>(
    null,
  );

  // El mismo disco que usó la ficha para presupuestar: si acá se acomodara
  // con otro espesor, mover una pieza podría cambiar el precio sin que nadie
  // tocara el despiece.
  const { plano, pasadasACobrar } = usePlano({
    piezas: piezasParaElPlano(piezas),
    placaLargo,
    placaAncho,
    anchoSierra,
    fijadas,
    busqueda,
  });

  // Comparado como texto: las dos listas son del mismo origen y el orden no
  // cambia salvo que alguien mueva algo, que es justamente lo que se detecta.
  const sinGuardar = JSON.stringify(fijadas) !== JSON.stringify(inicial);

  // Las cifras de arriba de la ficha siguen al plano que se prueba (M2S2-138).
  const publicar = usePublicarPlano();
  const router = useRouter();
  useEffect(() => {
    publicar?.(sinGuardar && plano.placas.length > 0 ? { plano, pasadas: pasadasACobrar } : null);
  }, [publicar, sinGuardar, plano, pasadasACobrar]);

  return (
    <div className="space-y-3">
      <PlanoEditable
        plano={plano}
        fijadas={fijadas}
        quien={quien}
        sinPasadas
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
                // Las cifras y la cuenta guardadas, sin recargar a mano.
                if (!r.error) router.refresh();
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
