"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sucursalPropuesta } from "../sucursal-propuesta";
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
import { formatearMonto, hoyEnArgentina, importeDelCampo, importeIlegible, importeParaElCampo } from "@/lib/formato";
import { Hoja, Interruptor, Opciones, Seccion } from "@/components/admin/formulario";
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

const TIPOS_DE_FACTURA = [
  { valor: "factura_a", texto: "A" },
  { valor: "factura_b", texto: "B" },
  { valor: "factura_c", texto: "C" },
];

const ALICUOTAS = [
  { valor: "21", texto: "21 %" },
  { valor: "10.5", texto: "10,5 %" },
  { valor: "27", texto: "27 %" },
];

/**
 * Anotar un gasto.
 *
 * La sucursal se pide siempre (mes simulado, H200: la luz del Aserradero
 * pagada por banco no quedaba en el Aserradero). En efectivo, además, es de
 * qué cajón salió la plata, y se ve cuánto hay en él.
 *
 * **Con factura** (H200/H359): el comprobante del proveedor, con su IVA,
 * entra al libro IVA compras y da crédito fiscal; el mismo número dos veces
 * se rechaza.
 *
 * Los valores viven en el estado y viajan en la llamada a `cargarGasto`: las
 * fichas de `Opciones` son radios sin formulario, así que sus nombres solo
 * tienen que no chocar con otros grupos de la página.
 */
export function CargarGasto({
  sucursales,
  proveedores,
}: {
  sucursales: { id: string; nombre: string; conTurno: boolean; deLaSesion: boolean; enCaja: number | null; cambioFijo: number }[];
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
  // La caja de quien carga, si se sabe (sucursalPropuesta); si no, se elige.
  const [branchId, setBranchId] = useState(() => sucursalPropuesta(sucursales));
  const [supplierId, setSupplierId] = useState("");
  const [conFactura, setConFactura] = useState(false);
  const [tipo, setTipo] = useState("factura_a");
  const [puntoVenta, setPuntoVenta] = useState("");
  const [numero, setNumero] = useState("");
  const [alicuota, setAlicuota] = useState("21");
  const [iva, setIva] = useState("");

  const enEfectivo = medio === "efectivo";
  const sucursal = sucursales.find((s) => s.id === branchId);
  // El IVA que trae un importe final a esa alícuota: se propone y se corrige.
  const total = importeDelCampo(importe);
  const ivaSugerido = total > 0 && tipo === "factura_a" ? Math.round((total - total / (1 + Number(alicuota) / 100)) * 100) / 100 : 0;
  const ivaFinal = iva === "" ? ivaSugerido : importeDelCampo(iva);
  // Lo que deja el gasto en el cajón: no baja del cambio fijo, y sin cambio
  // fijo no queda en negativo (AlcanzaElCajon en Go).
  const quedaria = enEfectivo && sucursal?.enCaja != null ? Math.round((sucursal.enCaja - total) * 100) / 100 : null;
  const piso = Math.max(0, sucursal?.cambioFijo ?? 0);
  const bajaDelCambio = quedaria !== null && sucursal !== undefined && quedaria < piso;
  // Efectivo de hoy de una caja sin turno: Go lo rechaza (el efectivo no
  // saldría de ningún arqueo). Se dice al elegirla y no después de tocar el
  // botón: el rechazo quedaba abajo y parecía que no pasaba nada (mes
  // simulado, tercera prueba). Para otro día decide Go, que mira los turnos
  // de ese día.
  const sinTurnoHoy = enEfectivo && sucursal !== undefined && !sucursal.conTurno && fecha === hoyEnArgentina();

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
            type="text"
            inputMode="decimal"
            value={importe}
            aria-invalid={importeIlegible(importe) || undefined}
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
          <span className="text-sm font-medium">A quién se le pagó</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            <option value="">{conFactura ? "Elegí el proveedor" : "—"}</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <div className="md:col-span-2">
          <Interruptor etiqueta="Con factura" icono={FileText} marcado={conFactura} alCambiar={setConFactura} />
        </div>
        {conFactura && (
          <div className="grid gap-3 md:col-span-2 sm:grid-cols-[auto_7rem_minmax(0,1fr)]">
            <div className="space-y-1">
              <span className="text-sm font-medium">Tipo</span>
              <Opciones nombre="gasto-factura-tipo" opciones={TIPOS_DE_FACTURA} valor={tipo} alCambiar={setTipo} columnas={3} />
            </div>
            <label className="block">
              <span className="text-sm font-medium">Punto de venta</span>
              <input
                inputMode="numeric"
                value={puntoVenta}
                onChange={(e) => setPuntoVenta(e.target.value.replace(/\D/g, ""))}
                className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Número</span>
              <input
                inputMode="numeric"
                value={numero}
                onChange={(e) => setNumero(e.target.value.replace(/\D/g, ""))}
                className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
              />
            </label>
            {tipo === "factura_a" && (
              <>
                <div className="space-y-1">
                  <span className="text-sm font-medium">Alícuota</span>
                  <Opciones nombre="gasto-factura-alicuota" opciones={ALICUOTAS} valor={alicuota} alCambiar={setAlicuota} columnas={3} />
                </div>
                <label className="block sm:col-span-2">
                  <span className="text-sm font-medium">IVA</span>
                  <input
                    inputMode="decimal"
                    value={iva === "" && ivaSugerido ? importeParaElCampo(ivaSugerido) : iva}
                    aria-invalid={importeIlegible(iva) || undefined}
                    onChange={(e) => setIva(e.target.value)}
                    className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
                  />
                </label>
              </>
            )}
          </div>
        )}
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

        {sucursales.length > 0 && (
          <div className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium">{enEfectivo ? "De qué caja salió" : "Sucursal"}</span>
            {/* Las sucursales son pocas: fichas. Si algún día son muchas,
                vuelve el desplegable. */}
            {sucursales.length <= 6 ? (
              <Opciones
                nombre="gasto-caja"
                opciones={sucursales.map((s) => ({
                  valor: s.id,
                  texto: !enEfectivo
                    ? s.nombre
                    : s.conTurno && s.enCaja !== null
                      ? `${s.nombre} · ${formatearMonto(s.enCaja)}`
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
                    {enEfectivo && (s.conTurno && s.enCaja !== null ? ` · ${formatearMonto(s.enCaja)}` : " · sin turno abierto")}
                  </option>
                ))}
              </select>
            )}
            {sinTurnoHoy && sucursal && (
              <span className="block text-base font-medium text-saldo-debe" role="alert">
                {`No hay caja abierta en ${sucursal.nombre}`}
              </span>
            )}
            {bajaDelCambio && sucursal && (
              <span className="tabular block text-base font-medium text-saldo-debe" role="alert">
                {piso > 0
                  ? `Deja ${formatearMonto(quedaria)} con un cambio fijo de ${formatearMonto(sucursal.cambioFijo)}`
                  : `En el cajón hay ${formatearMonto(sucursal.enCaja)}`}
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
                  importe: importeDelCampo(importe),
                  medio: medio as "efectivo",
                  circuito,
                  branchId: branchId || undefined,
                  supplierId: supplierId || undefined,
                  factura: conFactura
                    ? {
                        tipo,
                        puntoVenta: Number(puntoVenta || 0),
                        numero: Number(numero || 0),
                        iva21: tipo === "factura_a" && alicuota === "21" ? ivaFinal : 0,
                        iva105: tipo === "factura_a" && alicuota === "10.5" ? ivaFinal : 0,
                        iva27: tipo === "factura_a" && alicuota === "27" ? ivaFinal : 0,
                      }
                    : undefined,
                });
                setEstado(r);
                if (r.ok) {
                  setDescripcion("");
                  setImporte("");
                  setNumero("");
                  setIva("");
                  router.refresh();
                }
              })
            }
            disabled={
              enCurso ||
              !descripcion.trim() ||
              importeIlegible(importe) ||
              importeDelCampo(importe) <= 0 ||
              // Sin sucursal, el efectivo no saldría de ninguna caja.
              (enEfectivo && sucursales.length > 0 && !branchId) ||
              bajaDelCambio ||
              sinTurnoHoy ||
              (conFactura && (!supplierId || !numero || importeIlegible(iva)))
            }
            className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-50 sm:w-auto"
          >
            {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
            Anotar el gasto
          </button>
        </div>
      </div>
    </Hoja>
  );
}
