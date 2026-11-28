"use client";

import { useActionState, useState, useTransition } from "react";
import { Confirmar } from "@/components/admin/confirmar";
import {
  Download,
  Eye,
  Loader2,
  MessageSquareQuote,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import {
  borrarResenaDelNegocio,
  guardarResenaDelNegocio,
  publicarResena,
  traerDeGoogle,
  type EstadoResena,
} from "./actions";
import {
  Hoja,
  Interruptor,
  Opciones,
  Seccion,
  sinReiniciar,
} from "@/components/admin/formulario";
import { CampoFecha } from "@/components/ui/campo-fecha";

/** `vuelta` cuenta las guardadas: el formulario se arma de nuevo, vacío. */
type EstadoDelEditor = EstadoResena & { vuelta: number };

const inicial: EstadoDelEditor = { vuelta: 0 };

/**
 * Guardar y, si salió, vaciar el formulario: conservaba autor, fecha,
 * estrellas y el interruptor, y la siguiente se cargaba encima de la anterior
 * (mes 23). Si falla, queda todo como estaba.
 */
async function guardarYVaciar(previo: EstadoDelEditor, datos: FormData): Promise<EstadoDelEditor> {
  const r = await guardarResenaDelNegocio(previo, datos);
  return { ...r, vuelta: r.ok ? previo.vuelta + 1 : previo.vuelta };
}

export interface ResenaEditable {
  id: string;
  autor: string;
  estrellas: number;
  texto: string;
  /** «15/03/26», para mostrar. */
  fecha: string;
  /** aaaa-mm-dd, para editarla. */
  fechaIso: string;
  origen: "manual" | "google";
  publicada: boolean;
}

export function EditorDeResenas({
  resenas,
  hayGoogle,
}: {
  resenas: ResenaEditable[];
  hayGoogle: boolean;
}) {
  const [estado, guardar, guardando] = useActionState(guardarYVaciar, inicial);
  const [trayendo, empezarTraida] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      {hayGoogle && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={trayendo}
            onClick={() =>
              empezarTraida(async () => {
                const r = await traerDeGoogle();
                setAviso(r.error ?? r.ok ?? null);
              })
            }
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
          >
            {trayendo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Traer las de Google
          </button>
          {aviso && (
            <span className="text-base text-muted-foreground">{aviso}</span>
          )}
        </div>
      )}

      <ul className="space-y-3">
        {resenas.map((resena) => (
          <Fila key={resena.id} resena={resena} />
        ))}
      </ul>

      <form key={estado.vuelta} {...sinReiniciar(guardar)} className="space-y-4">
        <Hoja>
          <CamposDeResena titulo="Cargar una reseña" />
        </Hoja>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={guardando}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
          >
            {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar
          </button>
          {(estado.error || estado.ok) && (
            <span
              className={`text-base ${estado.error ? "text-destructive" : "text-muted-foreground"}`}
            >
              {estado.error ?? estado.ok}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Fila({ resena }: { resena: ResenaEditable }) {
  const [trabajando, empezar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [editando, setEditando] = useState(false);

  return (
    <li className="tarjeta p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex items-center gap-0.5 text-brand-orange">
          {Array.from({ length: resena.estrellas }, (_, i) => (
            <Star key={i} className="h-4 w-4 fill-current" />
          ))}
        </span>

        <div className="min-w-0 flex-[1_1_14rem]">
          <p className="text-base font-medium">{resena.autor}</p>
          <p className="tabular text-sm text-muted-foreground">
            {resena.fecha}
            {resena.origen === "google" && " · de Google"}
          </p>
          <p className="mt-0.5 text-base text-muted-foreground">
            {resena.texto}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={trabajando}
            onClick={() =>
              empezar(async () => {
                const r = await publicarResena(resena.id, !resena.publicada);
                setAviso(r.error ?? null);
              })
            }
            className={`h-10 rounded-lg px-3.5 text-base font-medium transition-colors ${
              resena.publicada
                ? "border border-linea hover:bg-hundida"
                : "bg-accion text-white hover:bg-brand-orange-dark"
            }`}
          >
            {resena.publicada ? "Sacar del sitio" : "Publicar"}
          </button>

          {/* Las de Google se traen como están: corregirlas sería cambiar lo
              que escribió otro. */}
          {resena.origen === "manual" && (
            <button
              type="button"
              disabled={trabajando}
              onClick={() => setEditando((v) => !v)}
              aria-label={`Corregir la reseña de ${resena.autor}`}
              aria-expanded={editando}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-linea text-muted-foreground transition-colors hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            disabled={trabajando}
            onClick={() => setConfirmarBorrado(true)}
            aria-label={`Borrar la reseña de ${resena.autor}`}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-linea text-muted-foreground transition-colors hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <Confirmar
            abierto={confirmarBorrado}
            alCerrar={() => setConfirmarBorrado(false)}
            titulo={`Borrar la reseña de ${resena.autor}`}
            detalle="Sale del sitio y no se puede recuperar."
            confirmar="Borrar la reseña"
            peligro
            alConfirmar={() => {
              setConfirmarBorrado(false);
              empezar(async () => {
                const r = await borrarResenaDelNegocio(resena.id);
                setAviso(r.error ?? null);
              });
            }}
          />
        </div>
      </div>

      {editando && <EditarResena resena={resena} alTerminar={() => setEditando(false)} />}
      {aviso && <p className="mt-2 text-sm text-destructive">{aviso}</p>}
    </li>
  );
}

/**
 * Los campos de una reseña: vacíos para cargar una, o con lo de la que se
 * corrige. Corregir una letra era borrarla y cargarla de nuevo (M4-054).
 */
function CamposDeResena({ titulo, resena }: { titulo: string; resena?: ResenaEditable }) {
  return (
    <Seccion titulo={titulo} icono={MessageSquareQuote}>
      <label className="block">
        <span className="text-base font-medium">Quién la escribió</span>
        <input
          name="autor"
          required
          defaultValue={resena?.autor}
          className="mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
        />
      </label>
      <label className="block">
        <span className="text-base font-medium">Cuándo</span>
        <CampoFecha
          name="fecha"
          defaultValue={resena?.fechaIso}
          className="tabular mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base"
        />
      </label>
      <div className="md:col-span-2">
        <p className="text-base font-medium">Estrellas</p>
        <div className="mt-1">
          <Opciones
            nombre="estrellas"
            defecto={String(resena?.estrellas ?? 5)}
            opciones={[5, 4, 3, 2, 1].map((n) => ({
              valor: String(n),
              texto: String(n),
              icono: Star,
            }))}
          />
        </div>
      </div>
      <label className="block md:col-span-2">
        <span className="text-base font-medium">La reseña</span>
        <textarea
          name="texto"
          required
          rows={3}
          defaultValue={resena?.texto}
          className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
        />
      </label>
      <div className="md:col-span-2">
        <Interruptor
          nombre="publicada"
          etiqueta="Mostrarla en el sitio"
          icono={Eye}
          defecto={resena?.publicada}
        />
      </div>
    </Seccion>
  );
}

/** La corrección de una reseña cargada a mano, en su renglón. */
function EditarResena({ resena, alTerminar }: { resena: ResenaEditable; alTerminar: () => void }) {
  const [estado, guardar, guardando] = useActionState(async (previo: EstadoResena, datos: FormData) => {
    const r = await guardarResenaDelNegocio(previo, datos);
    if (r.ok) alTerminar();
    return r;
  }, {});

  return (
    <form {...sinReiniciar(guardar)} className="mt-4 space-y-4">
      <input type="hidden" name="id" value={resena.id} />
      <Hoja plana>
        <CamposDeResena titulo="Corregir la reseña" resena={resena} />
      </Hoja>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar
        </button>
        <button
          type="button"
          onClick={alTerminar}
          className="h-10 rounded-lg border border-linea px-3.5 text-base font-medium transition-colors hover:bg-hundida"
        >
          Cancelar
        </button>
        {estado.error && <span className="text-base text-destructive">{estado.error}</span>}
      </div>
    </form>
  );
}
