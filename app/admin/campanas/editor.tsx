"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Eye, Loader2, Save, Send, TestTube2, Users } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
import type { Esquemas } from "@/lib/api/tipos";
import { duracionDelEnvio } from "@/lib/campanas/segmento";
import {
  alcanceDelSegmento,
  enviarCampana,
  enviarPrueba,
  guardarCampana,
  programarCampana,
  vistaPrevia,
  type EstadoCampana,
} from "./actions";

type SegmentoCampana = Esquemas["SegmentoCampana"];

export interface CamposDeCampana {
  id?: string;
  asunto: string;
  adelanto: string;
  cuerpo: string;
  imagenUrl: string;
  botonTexto: string;
  botonUrl: string;
  segmento: SegmentoCampana;
}

const CAMPO = "mt-1 block w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground";

/**
 * El editor de una campaña: a la izquierda lo que se escribe, a la derecha el
 * correo tal cual va a llegar.
 *
 * La vista previa la arma el servidor con la misma función que el envío, no
 * una copia en el navegador: lo que se ve es lo que sale, con el saludo y el
 * enlace de baja incluidos. Se pide de nuevo un momento después de que se
 * deja de tipear.
 */
export function EditorDeCampana({
  inicial,
  rubros,
  impedimento,
}: {
  inicial: CamposDeCampana;
  rubros: { valor: string; etiqueta: string }[];
  /** Por qué no se puede enviar todavía, si es el caso. */
  impedimento: string | null;
}) {
  const router = useRouter();
  const formulario = useRef<HTMLFormElement>(null);
  const [segmento, setSegmento] = useState<SegmentoCampana>(inicial.segmento);
  const [alcance, setAlcance] = useState<{ cantidad: number; descripcion: string; porMinuto: number } | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [errorPrevia, setErrorPrevia] = useState<string | null>(null);
  const [sucio, setSucio] = useState(false);
  const [version, setVersion] = useState(0);
  const [confirmando, setConfirmando] = useState(false);
  const [cuando, setCuando] = useState("");
  const [pendiente, empezar] = useTransition();

  const [estado, guardar, guardando] = useActionState(
    async (previo: EstadoCampana, datos: FormData) => {
      const r = await guardarCampana(previo, datos);
      if (r.ok) {
        setSucio(false);
        toast.success(r.ok);
        if (!inicial.id && r.id) router.replace(`/admin/campanas/${r.id}`);
        else router.refresh();
      }
      return r;
    },
    {} as EstadoCampana,
  );

  // Alcance del segmento, un momento después de cada cambio.
  useEffect(() => {
    const reloj = setTimeout(() => {
      void alcanceDelSegmento(segmento).then(setAlcance);
    }, 300);
    return () => clearTimeout(reloj);
  }, [segmento]);

  // Vista previa, un momento después de dejar de tipear.
  useEffect(() => {
    const reloj = setTimeout(() => {
      if (!formulario.current) return;
      void vistaPrevia(new FormData(formulario.current)).then((r) => {
        if (r.html) {
          setHtml(r.html);
          setErrorPrevia(null);
        } else setErrorPrevia(r.error ?? null);
      });
    }, 600);
    return () => clearTimeout(reloj);
  }, [version]);

  function cambio() {
    setSucio(true);
    setVersion((v) => v + 1);
  }

  function cambiarSegmento(nuevo: Partial<SegmentoCampana>) {
    setSegmento((s) => ({ ...s, ...nuevo }));
    setSucio(true);
  }

  function prueba() {
    if (!formulario.current) return;
    const datos = new FormData(formulario.current);
    empezar(async () => {
      const r = await enviarPrueba(datos);
      if (r.ok) toast.success(r.ok);
      else toast.error(r.error);
    });
  }

  function enviar() {
    if (!inicial.id) return;
    empezar(async () => {
      const r = await enviarCampana(inicial.id!);
      setConfirmando(false);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  function programar() {
    if (!inicial.id || !cuando) return;
    empezar(async () => {
      const r = await programarCampana(inicial.id!, cuando);
      if (r.ok) {
        toast.success(r.ok);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  const listoParaEnviar = Boolean(inicial.id) && !sucio;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form ref={formulario} action={guardar} onChange={cambio} className="space-y-5">
        {inicial.id && <input type="hidden" name="id" value={inicial.id} />}

        <section className="tarjeta space-y-4 p-5">
          <label className="block text-base font-medium">
            Asunto
            <input name="asunto" defaultValue={inicial.asunto} required maxLength={150} className={`${CAMPO} h-11`} placeholder="Nueva lista de precios para el gremio" />
          </label>
          <label className="block text-base font-medium">
            Adelanto <span className="font-normal text-muted-foreground">(opcional)</span>
            <input name="adelanto" defaultValue={inicial.adelanto} maxLength={150} className={`${CAMPO} h-11`} placeholder="Lo que se lee en la bandeja antes de abrir" />
          </label>
          <label className="block text-base font-medium">
            Texto
            <textarea name="cuerpo" defaultValue={inicial.cuerpo} required rows={10} data-enter="enviar" className={`${CAMPO} py-2.5 leading-relaxed`} />
            <span className="mt-1.5 block text-sm font-normal text-muted-foreground">
              Una línea en blanco separa párrafos. Una línea que empieza con «- » es una lista.
              Entre dos asteriscos va en **negrita**. Las direcciones web se vuelven enlaces.
            </span>
          </label>
        </section>

        <section className="tarjeta space-y-4 p-5">
          <label className="block text-base font-medium">
            Imagen <span className="font-normal text-muted-foreground">(opcional)</span>
            <input name="imagenUrl" defaultValue={inicial.imagenUrl} className={`${CAMPO} h-11`} placeholder="https://… o /subidas/…" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-base font-medium">
              Botón
              <input name="botonTexto" defaultValue={inicial.botonTexto} maxLength={40} className={`${CAMPO} h-11`} placeholder="Ver la lista" />
            </label>
            <label className="block text-base font-medium">
              Lleva a
              <input name="botonUrl" defaultValue={inicial.botonUrl} className={`${CAMPO} h-11`} placeholder="/catalogo" />
            </label>
          </div>
        </section>

        <section className="tarjeta space-y-4 p-5">
          <h2 className="text-base font-medium">A quién</h2>
          <input type="hidden" name="tipo" value={segmento.tipo} />
          {segmento.rubros.map((r) => (
            <input key={r} type="hidden" name="rubros" value={r} />
          ))}
          <input type="hidden" name="actividad" value={segmento.actividad?.tipo ?? ""} />
          <input type="hidden" name="meses" value={segmento.actividad?.meses ?? ""} />

          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de cliente">
            {(
              [
                ["todos", "Todos"],
                ["profesional", "Profesionales"],
                ["particular", "Particulares"],
              ] as const
            ).map(([valor, texto]) => (
              <button
                key={valor}
                type="button"
                role="radio"
                aria-checked={segmento.tipo === valor}
                onClick={() => cambiarSegmento({ tipo: valor })}
                className={`h-10 rounded-full border px-4 text-base transition-colors ${segmento.tipo === valor ? "border-brand-orange bg-brand-orange/10 font-medium text-brand-orange-dark" : "border-linea hover:bg-muted"}`}
              >
                {texto}
              </button>
            ))}
          </div>

          <fieldset>
            <legend className="text-sm text-muted-foreground">Rubros (ninguno marcado = todos)</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {rubros.map((r) => {
                const marcado = segmento.rubros.includes(r.valor);
                return (
                  <button
                    key={r.valor}
                    type="button"
                    aria-pressed={marcado}
                    onClick={() =>
                      cambiarSegmento({
                        rubros: marcado ? segmento.rubros.filter((x) => x !== r.valor) : [...segmento.rubros, r.valor],
                      })
                    }
                    className={`h-9 rounded-full border px-3 text-sm transition-colors ${marcado ? "border-brand-orange bg-brand-orange/10 font-medium text-brand-orange-dark" : "border-linea hover:bg-muted"}`}
                  >
                    {r.etiqueta}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-2 text-base">
            <select
              value={segmento.actividad?.tipo ?? ""}
              onChange={(e) =>
                cambiarSegmento({
                  actividad: e.target.value
                    ? { tipo: e.target.value as "compraron" | "sinComprar", meses: segmento.actividad?.meses ?? 6 }
                    : null,
                })
              }
              className="h-10 rounded-lg border border-linea bg-background px-2.5"
              aria-label="Por actividad"
            >
              <option value="">Compren o no</option>
              <option value="compraron">Que compraron en los últimos</option>
              <option value="sinComprar">Que no compran hace más de</option>
            </select>
            {segmento.actividad && (
              <>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={segmento.actividad.meses}
                  onChange={(e) =>
                    cambiarSegmento({ actividad: { tipo: segmento.actividad!.tipo, meses: Number(e.target.value) || 1 } })
                  }
                  className="tabular h-10 w-20 rounded-lg border border-linea bg-background px-2.5 text-right"
                  aria-label="Meses"
                />
                <span>meses</span>
              </>
            )}
          </div>

          <p className="flex items-center gap-2 rounded-lg bg-hundida px-3 py-2.5 text-base" aria-live="polite">
            <Users className="h-5 w-5 shrink-0 text-muted-foreground" />
            {alcance ? (
              <span>
                <strong className="tabular">{alcance.cantidad}</strong>{" "}
                {alcance.cantidad === 1 ? "dirección" : "direcciones"} · {alcance.descripcion}
                {alcance.cantidad > 0 && (
                  <span className="block text-sm text-muted-foreground">
                    Sale a {alcance.porMinuto} por minuto: tarda {duracionDelEnvio(alcance.cantidad, alcance.porMinuto)}.
                  </span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">Contando…</span>
            )}
          </p>
        </section>

        {estado.error && (
          <p role="alert" className="estado-problema text-base font-medium">
            {estado.error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={guardando} className="boton-accion inline-flex h-11 items-center gap-1.5 rounded-lg px-4 text-base font-medium disabled:opacity-60">
            {guardando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
            Guardar
          </button>
          <button type="button" onClick={prueba} disabled={pendiente} className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60">
            <TestTube2 className="h-5 w-5" />
            Mandarme una prueba
          </button>
        </div>

        <section className="tarjeta space-y-3 p-5">
          <h2 className="text-base font-medium">Enviar</h2>
          {impedimento ? (
            <p className="estado-espera text-base">{impedimento}</p>
          ) : !listoParaEnviar ? (
            <p className="text-base text-muted-foreground">Guardá los cambios para poder enviarla.</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!listoParaEnviar || Boolean(impedimento) || pendiente || !alcance?.cantidad}
              onClick={() => setConfirmando(true)}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-brand-orange px-4 text-base font-semibold text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-50"
            >
              <Send className="h-5 w-5" />
              Enviar ahora
            </button>
            <span className="text-base text-muted-foreground">o programar para</span>
            <input
              type="datetime-local"
              value={cuando}
              onChange={(e) => setCuando(e.target.value)}
              className="h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
              aria-label="Fecha y hora de envío"
            />
            <button
              type="button"
              disabled={!listoParaEnviar || Boolean(impedimento) || pendiente || !cuando}
              onClick={programar}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg border px-4 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              <CalendarClock className="h-5 w-5" />
              Programar
            </button>
          </div>
        </section>
      </form>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="tarjeta overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm text-muted-foreground">
            <Eye className="h-4 w-4" />
            Así llega, con tu nombre en el saludo
          </div>
          {errorPrevia ? (
            <p className="px-4 py-10 text-center text-base text-muted-foreground">{errorPrevia}</p>
          ) : html ? (
            // `sandbox` sin permisos: el correo no corre scripts ni navega.
            <iframe title="Vista previa del correo" srcDoc={html} sandbox="" className="h-[70vh] w-full bg-white" />
          ) : (
            <p className="px-4 py-10 text-center text-base text-muted-foreground">Armando la vista previa…</p>
          )}
        </div>
      </aside>

      <Confirmar
        abierto={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo="¿Enviar la campaña?"
        detalle={`Sale a ${alcance?.cantidad ?? 0} ${alcance?.cantidad === 1 ? "dirección" : "direcciones"} (${alcance?.descripcion ?? ""}). Tarda ${alcance ? duracionDelEnvio(alcance.cantidad, alcance.porMinuto) : ""}; se puede cancelar a mitad de camino, pero lo que ya salió no se puede deshacer.`}
        confirmar="Enviar"
        pendiente={pendiente}
        alConfirmar={enviar}
      />
    </div>
  );
}
