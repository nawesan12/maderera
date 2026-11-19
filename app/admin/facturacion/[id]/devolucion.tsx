"use client";

import { useId, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import { leerCantidad } from "@/lib/unidades";
import { Switch } from "@/components/ui/switch";
import { Opciones } from "@/components/admin/opciones";
import { Confirmar } from "@/components/admin/confirmar";
import type { DatosDeDevolucion } from "@/lib/dal/admin/facturacion";
import { devolver, type EstadoFactura } from "../actions";

type Destino = "caja" | "cuenta";
type SinStock = "rota" | "otro";

/**
 * La devolución de una venta: la nota, el stock y la plata en una sola
 * operación (Go, facturacion.DevolucionParcial).
 *
 * Las opciones que no corresponden se ven deshabilitadas y no se explican:
 * la caja cuando la venta no entró en efectivo (o no alcanza), la cuenta
 * cuando no hay cliente o no se le cargó. «Al stock» viene encendido en todo
 * lo que tiene producto detrás; apagarlo pide el motivo de una lista, porque
 * «se rompió» es la excusa del que se lleva plata sin devolver nada.
 */
export function Devolucion({
  invoiceId,
  datos,
  alCancelar,
}: {
  invoiceId: string;
  datos: DatosDeDevolucion;
  alCancelar: () => void;
}) {
  const id = useId();
  // Una clave por intento: el doble clic y el reintento devuelven la misma.
  const [clave] = useState(() => crypto.randomUUID());
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [alStock, setAlStock] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(datos.renglones.map((r) => [r.itemId, r.alStock])),
  );
  const [sinStock, setSinStock] = useState<SinStock | null>(null);
  const [sucursal, setSucursal] = useState<string | null>(datos.sucursal ?? datos.sucursales[0]?.id ?? null);
  const [motivo, setMotivo] = useState("");
  const [elegido, setElegido] = useState<Destino | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [estado, setEstado] = useState<EstadoFactura>({});
  const [enCurso, empezar] = useTransition();

  const pedidos = datos.renglones
    .map((r) => ({ r, cantidad: leerCantidad(cantidades[r.itemId] ?? "") }))
    .filter((x) => x.cantidad > 0);
  const pasado = pedidos.find((x) => x.cantidad > x.r.queda + 1e-9);
  const importe = Math.round(pedidos.reduce((s, x) => s + x.cantidad * x.r.unitario, 0) * 100) / 100;
  const alStockCuantos = pedidos.filter((x) => alStock[x.r.itemId]).reduce((s, x) => s + x.cantidad, 0);
  const hayFueraDeStock = pedidos.some((x) => !alStock[x.r.itemId]);
  const cajaAbierta = datos.sucursales.find((s) => s.id === sucursal)?.cajaAbierta ?? false;

  const cajaPosible = datos.caja > 0.005 && cajaAbierta && importe <= datos.caja + 0.005;
  const cuentaPosible = datos.conCliente && datos.cuenta > 0.005 && importe <= datos.cuenta + 0.005;
  // Lo elegido, mientras siga valiendo; si no, el primero que vale.
  const destino: Destino | null =
    elegido === "caja" && cajaPosible ? "caja" : elegido === "cuenta" && cuentaPosible ? "cuenta" : cajaPosible ? "caja" : cuentaPosible ? "cuenta" : null;

  const listo =
    pedidos.length > 0 &&
    !pasado &&
    destino !== null &&
    motivo.trim().length >= 4 &&
    (!hayFueraDeStock || sinStock !== null) &&
    (alStockCuantos === 0 || sucursal !== null);

  const resumen = [
    `Nota ${formatearMonto(importe)}`,
    alStockCuantos > 0 ? `${alStockCuantos.toLocaleString("es-AR")} al stock` : null,
    destino === "caja" ? `${formatearMonto(importe)} de la caja` : destino === "cuenta" ? `${formatearMonto(importe)} a la cuenta` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (listo && !enCurso) setConfirmando(true);
      }}
    >
      <h3 className="text-base font-semibold">Devolución · {datos.pedido}</h3>

      <ul className="divide-y divide-linea rounded-lg bg-hundida">
        {datos.renglones.map((r) => {
          const valor = cantidades[r.itemId] ?? "";
          const cantidad = leerCantidad(valor);
          const mal = valor !== "" && (!(cantidad >= 0) || cantidad > r.queda + 1e-9);
          return (
            <li key={r.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block text-base">{r.descripcion}</span>
                <span className="tabular block text-sm text-muted-foreground">
                  {r.queda.toLocaleString("es-AR")} × {formatearMonto(r.unitario)}
                </span>
              </span>
              <input
                aria-label={`Cuánto devuelve de ${r.descripcion}`}
                aria-invalid={mal || undefined}
                inputMode="decimal"
                autoComplete="off"
                disabled={r.queda <= 0}
                value={valor}
                onChange={(e) => setCantidades((prev) => ({ ...prev, [r.itemId]: e.target.value }))}
                placeholder="0"
                className={`tabular h-11 w-24 shrink-0 rounded-lg bg-background px-2 text-right text-base disabled:opacity-40 ${
                  mal ? "ring-2 ring-saldo-debe" : ""
                }`}
              />
              <label className="flex shrink-0 items-center gap-2 text-sm">
                <Switch
                  checked={alStock[r.itemId] ?? false}
                  disabled={!r.alStock}
                  onCheckedChange={(v) => setAlStock((prev) => ({ ...prev, [r.itemId]: v }))}
                />
                Al stock
              </label>
            </li>
          );
        })}
      </ul>

      {hayFueraDeStock && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">No vuelve al stock</span>
          <Opciones<SinStock>
            etiqueta="Por qué no vuelve al stock"
            valor={sinStock}
            alCambiar={setSinStock}
            opciones={[
              { valor: "rota", texto: "Rota" },
              { valor: "otro", texto: "Otro" },
            ]}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {datos.sucursales.length > 1 && (
          <label className="block">
            <span className="text-sm font-medium">Entra a</span>
            <select
              value={sucursal ?? ""}
              onChange={(e) => setSucursal(e.target.value || null)}
              className="mt-1 h-11 w-full rounded-lg bg-hundida px-3 text-base"
            >
              {datos.sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">La plata</span>
          <Opciones<Destino>
            etiqueta="Por dónde vuelve la plata"
            valor={destino}
            alCambiar={setElegido}
            opciones={[
              { valor: "caja", texto: "Caja", deshabilitada: !cajaPosible },
              { valor: "cuenta", texto: "Cuenta", deshabilitada: !cuentaPosible },
            ]}
          />
        </div>
      </div>

      <label className="block" htmlFor={`${id}-motivo`}>
        <span className="text-sm font-medium">Motivo</span>
        <input
          id={`${id}-motivo`}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Le sobraron dos placas"
          className="mt-1 h-11 w-full rounded-lg bg-hundida px-3 text-base"
        />
      </label>

      {importe > 0 && <p className="tabular text-base font-medium">{resumen}</p>}
      {estado.error && (
        <p role="alert" className="text-base text-saldo-debe">
          {estado.error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Confirmar
          abierto={confirmando}
          alCerrar={() => setConfirmando(false)}
          titulo={`Devolución de ${datos.pedido} por ${formatearMonto(importe)}`}
          detalle={`${resumen}. La nota va a ARCA y no se borra.`}
          confirmar="Devolver"
          pendiente={enCurso}
          alConfirmar={() => {
            setConfirmando(false);
            empezar(async () => {
              const r = await devolver(invoiceId, {
                clave,
                destino: destino!,
                motivo,
                sinStock: hayFueraDeStock ? sinStock : null,
                sucursalId: sucursal,
                renglones: pedidos.map((x) => ({
                  itemId: x.r.itemId,
                  cantidad: x.cantidad,
                  alStock: alStock[x.r.itemId] ?? false,
                })),
              });
              // Si sale bien, la acción lleva a la nota emitida.
              setEstado(r ?? {});
            });
          }}
        />
        <button
          type="submit"
          disabled={enCurso || !listo}
          className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-semibold disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Devolver
        </button>
        <button type="button" onClick={alCancelar} className="h-11 rounded-lg bg-hundida px-4 text-base">
          Cancelar
        </button>
      </div>
    </form>
  );
}
