"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRightLeft,
  Banknote,
  Building2,
  CreditCard,
  Ellipsis,
  FileText,
  Fuel,
  Landmark,
  Loader2,
  Megaphone,
  PenLine,
  Receipt,
  Store,
  Truck,
  Users,
  Wallet,
  WalletCards,
  Wrench,
  Zap,
} from "lucide-react";
import { CIRCUITOS, ETIQUETA_CIRCUITO } from "@/lib/circuito";
import { hoyEnArgentina } from "@/lib/formato";
import { Hoja, Opciones, Seccion } from "@/components/admin/formulario";
import { cargarGasto, type EstadoGasto } from "./actions";

const CATEGORIAS = {
  flete: "Fletes",
  combustible: "Combustible",
  servicios: "Servicios",
  alquiler: "Alquiler",
  sueldos: "Sueldos",
  mantenimiento: "Mantenimiento",
  impuestos: "Impuestos",
  librería: "Librería",
  publicidad: "Publicidad",
  otros: "Otros",
};

const ICONO_CATEGORIA: Record<keyof typeof CATEGORIAS, typeof Truck> = {
  flete: Truck,
  combustible: Fuel,
  servicios: Zap,
  alquiler: Building2,
  sueldos: Users,
  mantenimiento: Wrench,
  impuestos: Landmark,
  librería: PenLine,
  publicidad: Megaphone,
  otros: Ellipsis,
};

const OPCIONES_CATEGORIA = (
  Object.keys(CATEGORIAS) as (keyof typeof CATEGORIAS)[]
).map((valor) => ({
  valor,
  texto: CATEGORIAS[valor],
  icono: ICONO_CATEGORIA[valor],
}));

const MEDIOS = [
  { valor: "efectivo", texto: "Efectivo", icono: Banknote },
  { valor: "transferencia", texto: "Transferencia", icono: ArrowRightLeft },
  { valor: "debito", texto: "Débito", icono: CreditCard },
  { valor: "credito", texto: "Crédito", icono: WalletCards },
  { valor: "cheque", texto: "Cheque", icono: FileText },
];

const OPCIONES_CIRCUITO = CIRCUITOS.map((c) => ({
  valor: c,
  texto: ETIQUETA_CIRCUITO[c],
}));

/**
 * Anotar un gasto.
 *
 * La sucursal solo hace falta cuando se paga en efectivo, porque es lo que
 * decide **de qué cajón salió la plata**. Con transferencia el gasto sale del
 * banco y pedir la sucursal sería pedir un dato que después no significa nada.
 *
 * Los valores viven en el estado y viajan en la llamada a `cargarGasto`: las
 * fichas de `Opciones` son radios sin formulario, así que sus nombres solo
 * tienen que no chocar con otros grupos de la página.
 */
export function CargarGasto({
  sucursales,
  proveedores,
}: {
  sucursales: { id: string; nombre: string; conTurno: boolean }[];
  proveedores: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoGasto>({});
  const [enCurso, empezar] = useTransition();

  const [fecha, setFecha] = useState(hoyEnArgentina);
  const [categoria, setCategoria] = useState<keyof typeof CATEGORIAS>("flete");
  const [descripcion, setDescripcion] = useState("");
  const [importe, setImporte] = useState("");
  const [medio, setMedio] = useState("efectivo");
  const [circuito, setCircuito] = useState<"blanco" | "negro">("blanco");
  const [branchId, setBranchId] = useState(sucursales[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState("");

  const enEfectivo = medio === "efectivo";
  const sucursal = sucursales.find((s) => s.id === branchId);

  return (
    <Hoja>
      <Seccion titulo="Gasto" icono={Receipt}>
        <label className="block">
          <span className="text-sm font-medium">Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Importe</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
          />
        </label>

        <div className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Categoría</span>
          <Opciones
            nombre="gasto-categoria"
            opciones={OPCIONES_CATEGORIA}
            valor={categoria}
            alCambiar={(v) => setCategoria(v as keyof typeof CATEGORIAS)}
          />
        </div>

        <label className="block md:col-span-2">
          <span className="text-sm font-medium">En qué se gastó</span>
          <input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Flete a la obra de Alem"
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="text-sm font-medium">Proveedor (opcional)</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            <option value="">—</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
      </Seccion>

      <Seccion titulo="Pago" icono={Wallet}>
        <div className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Forma de pago</span>
          <Opciones
            nombre="gasto-medio"
            opciones={MEDIOS}
            valor={medio}
            alCambiar={setMedio}
            columnas={3}
          />
        </div>

        {enEfectivo && (
          <div className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium">De qué caja salió</span>
            {/* Las sucursales son pocas: fichas. Si algún día son muchas,
                vuelve el desplegable. */}
            {sucursales.length <= 6 ? (
              <Opciones
                nombre="gasto-caja"
                opciones={sucursales.map((s) => ({
                  valor: s.id,
                  texto: s.conTurno
                    ? s.nombre
                    : `${s.nombre} · sin turno abierto`,
                  icono: Store,
                }))}
                valor={branchId}
                alCambiar={setBranchId}
                columnas={sucursales.length <= 2 ? 2 : 3}
              />
            ) : (
              <select
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
              >
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                    {s.conTurno ? "" : " · sin turno abierto"}
                  </option>
                ))}
              </select>
            )}
            {sucursal && !sucursal.conTurno && (
              <span className="block text-sm text-muted-foreground">
                El gasto se anota igual, pero no va a salir de ningún turno.
              </span>
            )}
          </div>
        )}

        {/*
          Por qué circuito sale el gasto.

          Va como fichas y no como desplegable: son dos opciones, se elige
          en todos los gastos, y hay que poder ver cuál quedó puesta sin abrir
          nada. Las palabras son las que usa el equipo.
        */}
        <div className="space-y-1 md:col-span-2">
          <span className="text-sm font-medium">Circuito de facturación</span>
          <Opciones
            nombre="gasto-circuito"
            opciones={OPCIONES_CIRCUITO}
            valor={circuito}
            alCambiar={(v) => setCircuito(v as "blanco" | "negro")}
            columnas={2}
          />
        </div>
      </Seccion>

      <div className="space-y-3 py-6">
        {(estado.error || estado.ok) && (
          <p
            className={`text-base ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
          >
            {estado.error ?? estado.ok}
          </p>
        )}
        {estado.aviso && (
          <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-sm">
            {estado.aviso}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() =>
              empezar(async () => {
                const r = await cargarGasto({
                  fecha,
                  categoria,
                  descripcion,
                  importe: Number(importe || 0),
                  medio: medio as "efectivo",
                  circuito,
                  branchId: enEfectivo ? branchId : undefined,
                  supplierId: supplierId || undefined,
                });
                setEstado(r);
                if (r.ok) {
                  setDescripcion("");
                  setImporte("");
                  router.refresh();
                }
              })
            }
            disabled={
              enCurso || !descripcion.trim() || Number(importe || 0) <= 0
            }
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
            Anotar el gasto
          </button>
        </div>
      </div>
    </Hoja>
  );
}
