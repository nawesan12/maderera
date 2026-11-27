"use client";

import { useActionState, useState } from "react";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { importeDelCampo, importeIlegible, importeParaElCampo } from "@/lib/formato";
import { CampoImporte } from "@/components/admin/campo-importe";
import { guardarRegimen, type EstadoRegimen } from "./actions";

const inicial: EstadoRegimen = {};

export interface RegimenEditable {
  id: string;
  codigo: string;
  nombre: string;
  impuesto: string;
  jurisdiccion: string | null;
  alicuota: number;
  alicuotaNoInscripto: number;
  minimoNoImponible: number;
  minimoRetencion: number;
  activo: boolean;
}

const IMPUESTOS: Record<string, string> = {
  ganancias: "Ganancias",
  iva: "IVA",
  suss: "SUSS",
  iibb: "Ingresos Brutos",
};

/** La alícuota como se escribe acá: «8,68». */
const alicuotaParaElCampo = (n: number) => String(n).replace(".", ",");

/**
 * La alícuota escrita: con coma o con punto, es un porcentaje («1.5» es uno
 * y medio, no quince: no lleva separador de miles). NaN si no es un número.
 */
function alicuotaDelCampo(texto: string): number {
  const t = texto.trim().replace(",", ".");
  return t === "" ? 0 : Number(t);
}

const CAMPO =
  "tabular mt-1 h-10 w-full rounded-lg border border-linea bg-background px-2.5 text-right text-base";

/**
 * Las alícuotas y los mínimos con los que se retiene, editables, y el alta
 * de uno nuevo.
 *
 * **Por qué hacía falta.** La tabla se sembraba con un script y no se podía
 * tocar desde ninguna pantalla: cambiar una alícuota —que ARCA actualiza por
 * resolución varias veces al año— era entrar a la base. Y el pedido concreto de
 * la clienta fue justamente ése: «ya no les retienen tantos impuestos, solo
 * ingresos brutos, dejar en 0 los demás sin borrarlos».
 *
 * **Cero no es borrar.** Un régimen en cero no retiene nada pero sigue a la
 * vista, con su código y su mínimo, listo para el día que vuelva a
 * corresponder. Borrarlo perdería el código —que va impreso en el certificado—
 * y dejaría los certificados viejos apuntando a nada.
 *
 * Va plegado y al final de la pantalla: es configuración que casi no se toca,
 * y abierto tapaba la carga diaria del certificado (M2S1-041). Los campos van
 * en una grilla de anchos iguales, y la alícuota se escribe con coma, como en
 * Pagos.
 */
export function Regimenes({ regimenes }: { regimenes: RegimenEditable[] }) {
  const enUso = regimenes.filter((r) => r.activo && r.alicuota > 0).length;
  return (
    <details className="tarjeta group overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block text-base font-medium">Con qué se retiene</span>
          <span className="block text-sm text-muted-foreground">
            {enUso} de {regimenes.length} retienen
          </span>
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <ul className="divide-y divide-linea border-t border-linea">
        {regimenes.map((r) => (
          <Fila key={r.id} regimen={r} />
        ))}
        <li className="px-5 py-3.5">
          <Alta />
        </li>
      </ul>
    </details>
  );
}

/** «78 · Ganancias»; el SUSS, cuyo código es su nombre, no lo repite. */
function rotulo(r: { codigo: string; impuesto: string; jurisdiccion: string | null }) {
  const impuesto = IMPUESTOS[r.impuesto] ?? r.impuesto;
  const partes = r.codigo.toLowerCase() === impuesto.toLowerCase() ? [impuesto] : [r.codigo, impuesto];
  if (r.jurisdiccion) partes.push(r.jurisdiccion);
  return partes.join(" · ");
}

function Fila({ regimen }: { regimen: RegimenEditable }) {
  const [estado, guardar, guardando] = useActionState(guardarRegimen, inicial);
  const [alicuota, setAlicuota] = useState(alicuotaParaElCampo(regimen.alicuota));
  const [noInscripto, setNoInscripto] = useState(alicuotaParaElCampo(regimen.alicuotaNoInscripto));
  const [activo, setActivo] = useState(regimen.activo);
  const [minimoNoImponible, setMinimoNoImponible] = useState(importeParaElCampo(regimen.minimoNoImponible));
  const [minimoRetencion, setMinimoRetencion] = useState(importeParaElCampo(regimen.minimoRetencion));

  const a = alicuotaDelCampo(alicuota);
  const ni = alicuotaDelCampo(noInscripto);
  const ilegible =
    Number.isNaN(a) || Number.isNaN(ni) || importeIlegible(minimoNoImponible) || importeIlegible(minimoRetencion);
  const cambio =
    a !== regimen.alicuota ||
    ni !== regimen.alicuotaNoInscripto ||
    importeDelCampo(minimoNoImponible) !== regimen.minimoNoImponible ||
    importeDelCampo(minimoRetencion) !== regimen.minimoRetencion ||
    activo !== regimen.activo;

  return (
    <li className="px-5 py-3.5">
      <form action={guardar} className="space-y-3">
        <input type="hidden" name="id" value={regimen.id} />
        <input type="hidden" name="alicuota" value={String(a)} />
        <input type="hidden" name="alicuotaNoInscripto" value={String(ni)} />
        <input type="hidden" name="minimoNoImponible" value={String(importeDelCampo(minimoNoImponible))} />
        <input type="hidden" name="minimoRetencion" value={String(importeDelCampo(minimoRetencion))} />

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-medium">{regimen.nombre}</p>
            <p className="text-sm text-muted-foreground">{rotulo(regimen)}</p>
          </div>
          <label className="flex h-10 shrink-0 items-center gap-2 text-base">
            <input
              type="checkbox"
              name="activo"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="h-4 w-4 accent-brand-orange"
            />
            En uso
          </label>
        </div>

        <Numeros
          alicuota={alicuota}
          setAlicuota={setAlicuota}
          noInscripto={noInscripto}
          setNoInscripto={setNoInscripto}
          minimoNoImponible={minimoNoImponible}
          setMinimoNoImponible={setMinimoNoImponible}
          minimoRetencion={minimoRetencion}
          setMinimoRetencion={setMinimoRetencion}
        />

        {(cambio || estado.error || estado.ok) && (
          <div className="flex flex-wrap items-center gap-3">
            {cambio && (
              <button
                type="submit"
                disabled={guardando || ilegible}
                className="boton-accion inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-base font-medium disabled:opacity-60"
              >
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </button>
            )}
            {(estado.error || estado.ok) && (
              <span role={estado.error ? "alert" : "status"} className={`text-sm ${estado.error ? "text-saldo-debe" : "text-muted-foreground"}`}>
                {estado.error ?? estado.ok}
              </span>
            )}
          </div>
        )}
      </form>
    </li>
  );
}

/** Los cuatro números del régimen, en una grilla de anchos iguales. */
function Numeros(p: {
  alicuota: string;
  setAlicuota: (v: string) => void;
  noInscripto: string;
  setNoInscripto: (v: string) => void;
  minimoNoImponible: string;
  setMinimoNoImponible: (v: string) => void;
  minimoRetencion: string;
  setMinimoRetencion: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <label className="block">
        <span className="text-sm text-muted-foreground">Alícuota %</span>
        <input value={p.alicuota} onChange={(e) => p.setAlicuota(e.target.value)} inputMode="decimal" className={CAMPO} />
      </label>
      <label className="block">
        <span className="text-sm text-muted-foreground">No inscripto %</span>
        <input value={p.noInscripto} onChange={(e) => p.setNoInscripto(e.target.value)} inputMode="decimal" className={CAMPO} />
      </label>
      {/* Los dos mínimos, en pesos. El no imponible se descuenta del
          acumulado del mes antes de aplicar la alícuota (solo al inscripto);
          por debajo del de retención no se retiene. Lo escrito se lee como
          se escribe en Argentina («224.000»). */}
      <label className="block">
        <span className="text-sm text-muted-foreground">Mín. no imponible $</span>
        <CampoImporte valor={p.minimoNoImponible} alCambiar={p.setMinimoNoImponible} className={CAMPO} />
      </label>
      <label className="block">
        <span className="text-sm text-muted-foreground">Mín. de retención $</span>
        <CampoImporte valor={p.minimoRetencion} alCambiar={p.setMinimoRetencion} className={CAMPO} />
      </label>
    </div>
  );
}

/**
 * Un régimen nuevo: el código que va impreso en el certificado, el nombre, el
 * impuesto, la jurisdicción y sus números. Solo se podían editar los
 * sembrados, y el IIBB que la clienta sí retiene no se podía cargar
 * (M2S1-031).
 */
function Alta() {
  const [abierto, setAbierto] = useState(false);
  const [estado, guardar, guardando] = useActionState(async (previo: EstadoRegimen, fd: FormData) => {
    const r = await guardarRegimen(previo, fd);
    if (r.ok) setAbierto(false);
    return r;
  }, inicial);
  const [alicuota, setAlicuota] = useState("0");
  const [noInscripto, setNoInscripto] = useState("0");
  const [minimoNoImponible, setMinimoNoImponible] = useState("0");
  const [minimoRetencion, setMinimoRetencion] = useState("0");

  if (!abierto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="inline-flex h-10 items-center gap-2 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
        >
          <Plus className="h-5 w-5" />
          Agregar un régimen
        </button>
        {estado.ok && (
          <span role="status" className="text-sm text-muted-foreground">
            {estado.ok}
          </span>
        )}
      </div>
    );
  }

  const a = alicuotaDelCampo(alicuota);
  const ni = alicuotaDelCampo(noInscripto);
  return (
    <form action={guardar} className="space-y-3">
      <input type="hidden" name="activo" value="on" />
      <input type="hidden" name="alicuota" value={String(a)} />
      <input type="hidden" name="alicuotaNoInscripto" value={String(ni)} />
      <input type="hidden" name="minimoNoImponible" value={String(importeDelCampo(minimoNoImponible))} />
      <input type="hidden" name="minimoRetencion" value={String(importeDelCampo(minimoRetencion))} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="block">
          <span className="text-sm text-muted-foreground">Código</span>
          <input name="codigo" required maxLength={20} placeholder="IIBB-BA" className={`${CAMPO} text-left`} />
        </label>
        <label className="block">
          <span className="text-sm text-muted-foreground">Impuesto</span>
          <select name="impuesto" defaultValue="iibb" className="mt-1 h-10 w-full rounded-lg border border-linea bg-background px-2 text-base">
            {Object.entries(IMPUESTOS).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 block">
          <span className="text-sm text-muted-foreground">Nombre</span>
          <input name="nombre" required maxLength={80} placeholder="Ingresos Brutos · ARBA" className={`${CAMPO} text-left`} />
        </label>
        <label className="col-span-2 block">
          <span className="text-sm text-muted-foreground">Jurisdicción</span>
          <input name="jurisdiccion" maxLength={40} placeholder="Buenos Aires" className={`${CAMPO} text-left`} />
        </label>
      </div>
      <Numeros
        alicuota={alicuota}
        setAlicuota={setAlicuota}
        noInscripto={noInscripto}
        setNoInscripto={setNoInscripto}
        minimoNoImponible={minimoNoImponible}
        setMinimoNoImponible={setMinimoNoImponible}
        minimoRetencion={minimoRetencion}
        setMinimoRetencion={setMinimoRetencion}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={guardando || Number.isNaN(a) || Number.isNaN(ni) || importeIlegible(minimoNoImponible) || importeIlegible(minimoRetencion)}
          className="boton-accion inline-flex h-10 items-center gap-1.5 rounded-lg px-4 text-base font-medium disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Agregar
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="inline-flex h-10 items-center rounded-lg px-3 text-base font-medium text-muted-foreground hover:text-foreground"
        >
          Cancelar
        </button>
        {estado.error && (
          <span role="alert" className="text-sm text-saldo-debe">
            {estado.error}
          </span>
        )}
      </div>
    </form>
  );
}
