"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Loader2, Plus, Trash2 } from "lucide-react";
import { emitirManual, type EstadoFactura } from "../actions";
import { calcularTotales } from "@/lib/fiscal/impuestos";
import {
  letraQueCorresponde,
  type CondicionIva,
} from "@/lib/fiscal/comprobantes";
import { moneda } from "@/lib/formato";

const inicial: EstadoFactura = {};

const CONDICIONES = [
  { valor: "consumidor_final", texto: "Consumidor final" },
  { valor: "responsable_inscripto", texto: "Responsable inscripto" },
  { valor: "monotributista", texto: "Monotributista" },
  { valor: "exento", texto: "Exento" },
  { valor: "no_categorizado", texto: "No categorizado" },
];

interface Linea {
  descripcion: string;
  cantidad: string;
  precio: string;
  alicuota: string;
}

const LINEA_VACIA: Linea = {
  descripcion: "",
  cantidad: "1",
  precio: "",
  alicuota: "21",
};

/**
 * Alta manual de comprobante, para la venta de mostrador.
 *
 * Los precios se cargan **finales, con IVA incluido**, igual que en el
 * catálogo: es el número que se le dice al cliente y el que se cobra. La
 * desagregación se calcula sola y se muestra abajo, para que quien factura vea
 * el neto antes de emitir.
 *
 * La letra tampoco se elige: se deduce de la condición frente al IVA del
 * receptor y se muestra a la vista, así no hay forma de emitir una A a un
 * consumidor final por descuido.
 */
export function FormularioFacturaManual({
  condicionEmisor,
}: {
  condicionEmisor: CondicionIva;
}) {
  const [estado, accion, pendiente] = useActionState(emitirManual, inicial);

  const [condicion, setCondicion] = useState<CondicionIva>("consumidor_final");
  const [lineas, setLineas] = useState<Linea[]>([{ ...LINEA_VACIA }]);

  const letra = letraQueCorresponde(condicionEmisor, condicion);

  const totales = calcularTotales(
    lineas
      .filter((l) => l.descripcion.trim() && Number(l.precio) > 0)
      .map((l) => ({
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad) || 0,
        precioFinalUnitario: Number(l.precio) || 0,
        alicuota: Number(l.alicuota),
      })),
  );

  function cambiar(indice: number, campo: keyof Linea, valor: string) {
    setLineas((previas) =>
      previas.map((linea, i) =>
        i === indice ? { ...linea, [campo]: valor } : linea,
      ),
    );
  }

  return (
    <form action={accion} className="space-y-4">
      {/* Receptor */}
      <section className="tarjeta p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-medium">A quién se le factura</h2>
          <p className="flex items-center gap-2 text-base">
            <span className="text-muted-foreground">Comprobante</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-foreground text-lg font-bold">
              {letra}
            </span>
          </p>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="receptorNombre" className="mb-1.5 block text-base font-medium">
              Nombre o razón social
            </label>
            <input
              id="receptorNombre"
              name="receptorNombre"
              required
              className="h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div>
            <label htmlFor="receptorCuit" className="mb-1.5 block text-base font-medium">
              CUIT
            </label>
            <input
              id="receptorCuit"
              name="receptorCuit"
              placeholder="30-12345678-9"
              className="tabular h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>

          <div>
            <label
              htmlFor="receptorCondicionIva"
              className="mb-1.5 block text-base font-medium"
            >
              Condición frente al IVA
            </label>
            <select
              id="receptorCondicionIva"
              name="receptorCondicionIva"
              value={condicion}
              onChange={(e) => setCondicion(e.target.value as CondicionIva)}
              className="h-10 w-full rounded-lg border bg-background px-2.5 text-base"
            >
              {CONDICIONES.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.texto}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-muted-foreground">
              Define la letra del comprobante.
            </p>
          </div>

          <div>
            <label
              htmlFor="receptorDomicilio"
              className="mb-1.5 block text-base font-medium"
            >
              Domicilio
            </label>
            <input
              id="receptorDomicilio"
              name="receptorDomicilio"
              className="h-10 w-full rounded-lg border bg-background px-3 text-base"
            />
          </div>
        </div>
      </section>

      {/* Ítems */}
      <section className="tarjeta p-5">
        <h2 className="text-base font-medium">Qué se factura</h2>
        <p className="mt-1 text-base text-muted-foreground">
          Los precios van finales, con IVA incluido, como en el catálogo.
        </p>

        <div className="mt-4 space-y-2">
          {lineas.map((linea, i) => (
            <div
              key={i}
              className="grid gap-2 sm:grid-cols-[1fr_5rem_8rem_6rem_2.5rem]"
            >
              <input
                name="descripcion"
                value={linea.descripcion}
                onChange={(e) => cambiar(i, "descripcion", e.target.value)}
                placeholder="Descripción"
                className="h-10 rounded-lg border bg-background px-3 text-base"
                aria-label={`Descripción del ítem ${i + 1}`}
              />
              <input
                name="cantidad"
                value={linea.cantidad}
                onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                inputMode="decimal"
                className="tabular h-10 rounded-lg border bg-background px-3 text-base"
                aria-label={`Cantidad del ítem ${i + 1}`}
              />
              <input
                name="precio"
                value={linea.precio}
                onChange={(e) => cambiar(i, "precio", e.target.value)}
                inputMode="decimal"
                placeholder="Precio final"
                className="tabular h-10 rounded-lg border bg-background px-3 text-base"
                aria-label={`Precio del ítem ${i + 1}`}
              />
              <select
                name="alicuota"
                value={linea.alicuota}
                onChange={(e) => cambiar(i, "alicuota", e.target.value)}
                className="h-10 rounded-lg border bg-background px-2 text-base"
                aria-label={`IVA del ítem ${i + 1}`}
              >
                <option value="21">21%</option>
                <option value="10.5">10,5%</option>
                <option value="0">Exento</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  setLineas((previas) =>
                    previas.length === 1
                      ? [{ ...LINEA_VACIA }]
                      : previas.filter((_, indice) => indice !== i),
                  )
                }
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                aria-label={`Quitar el ítem ${i + 1}`}
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLineas((previas) => [...previas, { ...LINEA_VACIA }])}
          className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg border border-dashed px-3.5 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-5 w-5" />
          Agregar ítem
        </button>

        {/* Desagregación en vivo */}
        {totales.total > 0 && (
          <dl className="mt-5 space-y-1.5 border-t pt-4 text-base">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Neto gravado</dt>
              <dd className="tabular">{moneda.format(totales.neto)}</dd>
            </div>
            {[...totales.ivaPorAlicuota.entries()].map(([alicuota, valores]) => (
              <div key={alicuota} className="flex justify-between">
                <dt className="text-muted-foreground">
                  IVA {String(alicuota).replace(".", ",")}%
                </dt>
                <dd className="tabular">{moneda.format(valores.importe)}</dd>
              </div>
            ))}
            {totales.exento > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Exento</dt>
                <dd className="tabular">{moneda.format(totales.exento)}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t pt-2">
              <dt className="font-semibold">Total</dt>
              <dd className="tabular text-2xl font-bold">
                {moneda.format(totales.total)}
              </dd>
            </div>
          </dl>
        )}
      </section>

      <section className="tarjeta p-5">
        <label htmlFor="observaciones" className="block text-base font-medium">
          Observaciones
        </label>
        <textarea
          id="observaciones"
          name="observaciones"
          rows={2}
          maxLength={600}
          className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5 text-base"
        />
      </section>

      {estado.error && (
        <p
          role="alert"
          className="estado-problema flex items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base text-[var(--estado-tinta)]"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente || totales.total <= 0}
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-orange px-5 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-50"
      >
        {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
        Emitir {letra === "A" ? "factura A" : letra === "B" ? "factura B" : "factura C"}
      </button>
    </form>
  );
}
