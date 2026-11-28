"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { guardarTarifaDeCorte, type EstadoTarifa } from "./actions";

const inicial: EstadoTarifa = {};

export interface TarifaEditable {
  id: string;
  material: string;
  priceListId: string | null;
  precioPorPasada: string;
  precioPorMetroCanto: string;
  activo: boolean;
}

/**
 * Una tarifa de corte.
 *
 * El material es texto libre y no un desplegable de productos a propósito: la
 * tarifa no depende de la placa concreta sino de **contra qué corta la
 * sierra**. Una melamina y un MDF cobran igual; un tablero de madera, no.
 */
export function EditorDeTarifa({
  tarifa,
  listas,
}: {
  tarifa: TarifaEditable | null;
  listas: { id: string; nombre: string; esGeneral: boolean }[];
}) {
  if (tarifa) return <FilaDeTarifa tarifa={tarifa} />;
  return <TarifaNueva listas={listas} />;
}

/**
 * Una tarifa cargada, en una fila: el material y la lista ya los dice el
 * título, así que solo se editan los dos precios y si se cobra. «Guardar»
 * aparece en la que cambió (M4-012, M4-058: cada tarifa era un formulario
 * de 900 px con su botón naranja siempre a la vista, y no se sabía qué
 * quedaba sin guardar).
 */
function FilaDeTarifa({ tarifa }: { tarifa: TarifaEditable }) {
  const [estado, guardar, guardando] = useActionState(guardarTarifaDeCorte, inicial);
  const [pasada, setPasada] = useState(tarifa.precioPorPasada);
  const [canto, setCanto] = useState(tarifa.precioPorMetroCanto);
  const [activo, setActivo] = useState(tarifa.activo);
  // Lo guardado pasa a ser la base: el botón se va hasta el próximo cambio.
  const [base, setBase] = useState(tarifa);
  useEffect(() => {
    if (estado.ok) {
      toast.success(estado.ok);
      setBase((b) => ({ ...b, precioPorPasada: pasada, precioPorMetroCanto: canto, activo }));
    }
    // Solo cuando llega la respuesta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado]);
  const cambio = pasada !== base.precioPorPasada || canto !== base.precioPorMetroCanto || activo !== base.activo;
  const id = useId();

  return (
    <form action={guardar} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={tarifa.id} />
      <input type="hidden" name="material" value={tarifa.material} />
      <input type="hidden" name="priceListId" value={tarifa.priceListId ?? ""} />
      {activo && <input type="hidden" name="activo" value="on" />}
      <label htmlFor={`${id}-precio`} className="grid min-w-0 flex-1 basis-28 gap-1 text-sm text-muted-foreground">
        Por pasada
        <input
          id={`${id}-precio`}
          name="precioPorPasada"
          required
          inputMode="decimal"
          value={pasada}
          onChange={(e) => setPasada(e.target.value)}
          placeholder="1.200"
          className="tabular h-11 w-full rounded-lg border bg-background px-3 text-base text-foreground"
        />
      </label>
      <label htmlFor={`${id}-canto`} className="grid min-w-0 flex-1 basis-28 gap-1 text-sm text-muted-foreground">
        Metro de tapacanto
        <input
          id={`${id}-canto`}
          name="precioPorMetroCanto"
          inputMode="decimal"
          value={canto}
          onChange={(e) => setCanto(e.target.value)}
          placeholder="0"
          className="tabular h-11 w-full rounded-lg border bg-background px-3 text-base text-foreground"
        />
      </label>
      <label className="flex h-11 cursor-pointer items-center gap-2.5 text-base">
        <Switch checked={activo} onCheckedChange={(v) => setActivo(v === true)} />
        Se cobra
      </label>
      {cambio && (
        <button
          type="submit"
          disabled={guardando}
          className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </button>
      )}
      {estado.error && <p className="w-full text-base text-destructive">{estado.error}</p>}
    </form>
  );
}

function TarifaNueva({ listas }: { listas: { id: string; nombre: string; esGeneral: boolean }[] }) {
  const [estado, guardar, guardando] = useActionState(guardarTarifaDeCorte, inicial);
  // Guardado, con el aviso de todo el panel: el renglón gris al lado del
  // botón no se veía (tercera prueba del mes).
  useEffect(() => {
    if (estado.ok) toast.success(estado.ok);
  }, [estado]);
  const id = useId();
  const [activo, setActivo] = useState(true);

  return (
    <form action={guardar} className="tarjeta p-5">
      {activo && <input type="hidden" name="activo" value="on" />}
      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor={`${id}-material`} className="block text-base font-medium">
            Material
          </label>
          <input
            id={`${id}-material`}
            name="material"
            required
            placeholder="Placas"
            className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>

        <div>
          <label htmlFor={`${id}-lista`} className="block text-base font-medium">
            Lista de precios
          </label>
          <select
            id={`${id}-lista`}
            name="priceListId"
            defaultValue=""
            className="mt-1 h-11 w-full rounded-lg border bg-background px-2.5 text-base"
          >
            <option value="">Precio de público</option>
            {listas
              .filter((l) => !l.esGeneral)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor={`${id}-precio`} className="block text-base font-medium">
            Precio por pasada
          </label>
          <input
            id={`${id}-precio`}
            name="precioPorPasada"
            required
            inputMode="decimal"
            placeholder="1.200"
            className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>

        <div>
          <label htmlFor={`${id}-canto`} className="block text-base font-medium">
            Metro de tapacanto
          </label>
          <input
            id={`${id}-canto`}
            name="precioPorMetroCanto"
            inputMode="decimal"
            placeholder="0 si no se cobra"
            className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2.5 text-base">
          <Switch checked={activo} onCheckedChange={(v) => setActivo(v === true)} />
          Se cobra
        </label>

        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Agregar tarifa
        </button>

        {estado.error && <p className="text-base text-destructive">{estado.error}</p>}
      </div>
    </form>
  );
}
