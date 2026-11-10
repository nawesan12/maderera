"use client";

import { useActionState, useId, useState, useTransition } from "react";
import Image from "next/image";
import {
  BadgePercent,
  CalendarDays,
  ImageIcon,
  ImageOff,
  Landmark,
  Loader2,
  Power,
  Store,
  Trash2,
} from "lucide-react";
import { borrarPromo, guardarPromo, type EstadoPromo } from "./actions";
import {
  Hoja,
  Interruptor,
  Opciones,
  Seccion,
  sinReiniciar,
} from "@/components/admin/formulario";

const inicial: EstadoPromo = {};

export interface PromoEditable {
  id: string;
  medio: string;
  titulo: string;
  detalle: string;
  dias: string;
  quienPaga: "banco" | "nosotros";
  /** "2026-10-22", como lo espera el input de fecha. Vacía es sin vencimiento. */
  vigenciaHasta: string;
  orden: number;
  activo: boolean;
  /** El logo del banco o de la billetera, si tiene. */
  imagenUrl: string | null;
  /** Si hoy está efectivamente publicada, contando la vigencia. */
  alAire: boolean;
}

export function EditorDePromo({ promo }: { promo: PromoEditable | null }) {
  const [estado, guardar, guardando] = useActionState(guardarPromo, inicial);
  const [borrando, empezarBorrado] = useTransition();
  const [avisoBorrado, setAvisoBorrado] = useState<string | null>(null);
  const id = useId();
  const [quienPaga, setQuienPaga] = useState<PromoEditable["quienPaga"]>(
    promo?.quienPaga ?? "banco",
  );

  return (
    <form {...sinReiniciar(guardar)} className="space-y-4">
      {promo && <input type="hidden" name="id" value={promo.id} />}

      <Hoja>
        <Seccion titulo="La promoción" icono={BadgePercent}>
          <Campo
            nombre="medio"
            etiqueta="Con qué se paga"
            valorInicial={promo?.medio ?? ""}
            placeholder="Banco Nación"
            requerido
          />
          <Campo
            nombre="titulo"
            etiqueta="El beneficio, en una línea"
            valorInicial={promo?.titulo ?? ""}
            placeholder="12 cuotas sin interés"
            requerido
          />
          <div className="md:col-span-2">
            <label
              htmlFor={`${id}-detalle`}
              className="block text-base font-medium"
            >
              La letra chica
            </label>
            <textarea
              id={`${id}-detalle`}
              name="detalle"
              rows={2}
              defaultValue={promo?.detalle ?? ""}
              placeholder="Sólo pagando con MODO BNA. Tope de reintegro $15.000."
              className="mt-1 w-full rounded-lg border bg-background px-3 py-2 text-base"
            />
          </div>
        </Seccion>

        {/* El logo del banco. Es lo que hace que la grilla de la portada se lea
            de un vistazo: el cliente reconoce a su banco por la marca antes que
            por el nombre escrito. */}
        <Seccion titulo="Logo" icono={ImageIcon} columnas={1}>
          <div>
            <label
              htmlFor={`${id}-img`}
              className="block text-base font-medium"
            >
              Logo del banco o la billetera
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-4">
              {promo?.imagenUrl && (
                <Image
                  src={promo.imagenUrl}
                  alt=""
                  width={120}
                  height={40}
                  className="h-10 w-auto max-w-[120px] object-contain"
                />
              )}
              <input
                id={`${id}-img`}
                type="file"
                name="imagen"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="block text-base"
              />
            </div>
          </div>
          {promo?.imagenUrl && (
            <Interruptor
              nombre="quitarImagen"
              etiqueta="Sacar el logo al guardar"
              icono={ImageOff}
            />
          )}
        </Seccion>

        {/* Quién pone la plata.
            Es el campo que evita que alguien descuente en el mostrador un
            reintegro que iba a pagar el banco. El aviso de abajo se queda por
            eso: es lo que distingue un reintegro de un descuento en caja. */}
        <Seccion
          titulo="¿Quién pone el descuento?"
          icono={Landmark}
          columnas={1}
        >
          <Opciones
            nombre="quienPaga"
            columnas={2}
            valor={quienPaga}
            alCambiar={(v) => setQuienPaga(v as PromoEditable["quienPaga"])}
            opciones={[
              {
                valor: "banco",
                texto: "El banco o la tarjeta",
                icono: Landmark,
              },
              { valor: "nosotros", texto: "La maderera", icono: Store },
            ]}
          />
          {quienPaga === "banco" ? (
            <p className="text-base text-muted-foreground">
              <strong>En el mostrador no se descuenta:</strong> el cliente paga
              el total y el banco se lo devuelve.
            </p>
          ) : (
            <p className="text-base text-muted-foreground">
              Para que se descuente solo al cobrar, cargá el porcentaje en{" "}
              <a
                href="/admin/precios/formas-de-pago"
                className="underline underline-offset-2"
              >
                Precios → Formas de pago
              </a>
              .
            </p>
          )}
        </Seccion>

        <Seccion titulo="Cuándo" icono={CalendarDays} columnas={3}>
          <Campo
            nombre="dias"
            etiqueta="Qué días corre"
            valorInicial={promo?.dias ?? ""}
            placeholder="Todos los días"
          />
          <Campo
            nombre="vigenciaHasta"
            etiqueta="Vigente hasta"
            tipo="date"
            valorInicial={promo?.vigenciaHasta ?? ""}
          />
          <Campo
            nombre="orden"
            etiqueta="Orden"
            valorInicial={String(promo?.orden ?? 0)}
          />
          <div className="md:col-span-3">
            <Interruptor
              nombre="activo"
              etiqueta="Encendida"
              icono={Power}
              defecto={promo?.activo ?? true}
            />
            {promo && !promo.alAire && promo.activo && (
              <p className="mt-2 text-sm text-muted-foreground">
                Hoy no se ve: la vigencia ya pasó.
              </p>
            )}
          </div>
        </Seccion>
      </Hoja>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          {promo ? "Guardar" : "Crear promoción"}
        </button>

        {promo && (
          <button
            type="button"
            disabled={borrando}
            onClick={() =>
              empezarBorrado(async () => {
                const r = await borrarPromo(promo.id);
                setAvisoBorrado(r.error ?? r.ok ?? null);
              })
            }
            className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium text-destructive transition-colors hover:bg-muted disabled:opacity-60"
          >
            {borrando ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Borrar
          </button>
        )}

        {estado.error && (
          <p className="text-base text-destructive">{estado.error}</p>
        )}
        {estado.ok && (
          <p className="text-base text-muted-foreground">{estado.ok}</p>
        )}
        {avisoBorrado && (
          <p className="text-base text-muted-foreground">{avisoBorrado}</p>
        )}
      </div>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  valorInicial,
  placeholder,
  tipo = "text",
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string;
  placeholder?: string;
  tipo?: string;
  requerido?: boolean;
}) {
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        name={nombre}
        type={tipo}
        required={requerido}
        defaultValue={valorInicial}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
    </div>
  );
}
