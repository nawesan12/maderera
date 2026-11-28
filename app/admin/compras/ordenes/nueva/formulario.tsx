"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sucursalPropuesta } from "../../sucursal-propuesta";
import { ClipboardList, Loader2, Search, Store, Trash2 } from "lucide-react";
import {
  BarraGuardar,
  Hoja,
  Opciones,
  Seccion,
} from "@/components/admin/formulario";
import {
  formatearMonto,
  hoyEnArgentina,
  importeDelCampo,
  importeIlegible,
} from "@/lib/formato";
import { CampoImporte } from "@/components/admin/campo-importe";
import { costoLejos, costoPropuesto } from "../costos";
import {
  buscarParaPedir,
  crearOrdenDeCompra,
  editarOrdenDeCompra,
  type EstadoOrden,
} from "../actions";
import { CampoFecha } from "@/components/ui/campo-fecha";

interface Hallazgo {
  variantId: string;
  producto: string | null;
  variante: string | null;
  sku: string | null;
  alicuotaIva: string;
  costoActual: string | null;
}

export interface Linea {
  variantId: string;
  descripcion: string;
  cantidad: string;
  costoUnitario: string;
  alicuotaIva: string;
  /** El último costo conocido: el campo se marca si se aleja mucho. */
  ultimo?: number | null;
}

/**
 * La carga de una orden.
 *
 * El costo arranca en el último conocido: una orden se hace casi siempre a los
 * precios de la vez anterior, y lo que se corrige es la excepción. Tipear todo
 * de cero invita a equivocarse en lo que ya se sabía.
 */
export function FormularioOrden({
  proveedores,
  sucursales,
  renglonesIniciales,
  proveedorInicial,
  sucursalInicial,
  editar,
}: {
  proveedores: { id: string; nombre: string }[];
  sucursales: { id: string; nombre: string; deLaSesion?: boolean }[];
  /**
   * Con qué arranca la orden, cuando se llega desde el reporte de reposición.
   *
   * Vienen resueltos del servidor —descripción, costo y alícuota incluidos— y
   * no como ids sueltos: el formulario no tiene por qué saber consultarlos, y
   * así la orden ya nace cargada en el primer pintado.
   */
  renglonesIniciales?: Linea[];
  /** El proveedor y la sucursal que trae el reporte de reposición. */
  proveedorInicial?: string;
  sucursalInicial?: string;
  /** La orden en borrador que se corrige: arranca con lo que tenía. */
  editar?: { id: string; supplierId: string; branchId: string; fechaPrometida: string; notas: string };
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoOrden>({});
  const [enCurso, empezar] = useTransition();

  // Ningún proveedor de entrada (el primero alfabético casi nunca es el que
  // se quiere) y la sucursal de quien carga, si se sabe (sucursalPropuesta).
  const [supplierId, setSupplierId] = useState(editar?.supplierId ?? proveedorInicial ?? "");
  const [branchId, setBranchId] = useState(() => editar?.branchId ?? sucursalInicial ?? sucursalPropuesta(sucursales));
  const [fechaPrometida, setFecha] = useState(editar?.fechaPrometida ?? "");
  const [notas, setNotas] = useState(editar?.notas ?? "");
  const [lineas, setLineas] = useState<Linea[]>(renglonesIniciales ?? []);

  const [texto, setTexto] = useState("");
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (texto.trim().length < 2) {
        setHallazgos([]);
        return;
      }
      void buscarParaPedir(texto, supplierId || undefined).then(setHallazgos);
    }, 250);
    return () => clearTimeout(t);
  }, [texto, supplierId]);

  function agregar(h: Hallazgo) {
    setLineas((prev) =>
      prev.some((l) => l.variantId === h.variantId)
        ? prev
        : [
            ...prev,
            {
              variantId: h.variantId,
              descripcion: [h.producto, h.variante].filter(Boolean).join(" "),
              cantidad: "1",
              costoUnitario: costoPropuesto(h.costoActual),
              alicuotaIva: h.alicuotaIva,
              ultimo: h.costoActual ? Number(h.costoActual) : null,
            },
          ],
    );
    setTexto("");
    setHallazgos([]);
  }

  function cambiar(i: number, campo: keyof Linea, valor: string) {
    setLineas((prev) =>
      prev.map((l, j) => (i === j ? { ...l, [campo]: valor } : l)),
    );
  }

  const neto = lineas.reduce(
    (t, l) => t + Number(l.cantidad || 0) * importeDelCampo(l.costoUnitario),
    0,
  );

  /*
   * Lo que falta, en el orden de la pantalla. El botón no se apaga: con el
   * botón gris no se sabía por qué no andaba (mes simulado: «Entrega en»
   * viene sin elegir a propósito, ver sucursalPropuesta). Al tocarlo se
   * marca lo que falta y se dice en la barra.
   */
  const [intentado, setIntentado] = useState(false);
  // Una fecha a medio escribir («20/2») no deja crear la orden: se creaba
  // sin fecha y, enviada, ya no se podía cargar (M3S4-020).
  const [fechaIncompleta, setFechaIncompleta] = useState(false);
  const fechaVieja = fechaPrometida !== "" && fechaPrometida < hoyEnArgentina();
  const lineasMal = lineas.some(
    (l) => !(Number(l.cantidad) > 0) || l.costoUnitario === "" || importeIlegible(l.costoUnitario),
  );
  const falta: { campo: string; texto: string } | null =
    supplierId === ""
      ? { campo: "orden-proveedor", texto: "Elegí el proveedor." }
      : branchId === ""
        ? { campo: "orden-sucursal", texto: "Elegí dónde se entrega." }
        : fechaIncompleta
          ? { campo: "orden-fecha", texto: "Revisá la fecha prometida: dd/mm/aaaa, de hoy en adelante." }
          : fechaVieja
          ? { campo: "orden-fecha", texto: "La fecha prometida ya pasó." }
          : lineas.length === 0
            ? { campo: "orden-buscar", texto: "Agregá qué se pide." }
            : lineasMal
              ? { campo: "orden-renglones", texto: "Revisá cantidades y costos." }
              : null;
  const marcar = (campo: string) => intentado && falta?.campo === campo;

  return (
    <div className="space-y-4">
      <Hoja>
        <Seccion titulo="Orden" icono={ClipboardList}>
          <label className="block md:col-span-2">
            <span className="text-sm font-medium">Proveedor</span>
            <select
              id="orden-proveedor"
              value={supplierId}
              aria-invalid={marcar("orden-proveedor") || undefined}
              onChange={(e) => setSupplierId(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            >
              <option value="" disabled>
                Elegí el proveedor
              </option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>

          <div
            id="orden-sucursal"
            tabIndex={-1}
            className={`space-y-1 rounded-xl outline-none md:col-span-2 ${
              marcar("orden-sucursal") ? "ring-2 ring-saldo-debe ring-offset-4 ring-offset-card" : ""
            }`}
          >
            <span className="text-sm font-medium">Entrega en</span>
            {/* Las sucursales son pocas: fichas. Si algún día son muchas,
              vuelve el desplegable. */}
            {sucursales.length <= 6 ? (
              <Opciones
                nombre="orden-sucursal"
                opciones={sucursales.map((s) => ({
                  valor: s.id,
                  texto: s.nombre,
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
                <option value="" disabled>
                  Elegí la sucursal
                </option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            )}
          </div>

          <label className="block">
            <span className="text-sm font-medium">Fecha prometida</span>
            <CampoFecha
              id="orden-fecha"
              value={fechaPrometida}
              min={hoyEnArgentina()}
              aria-invalid={(fechaPrometida !== "" && fechaPrometida < hoyEnArgentina()) || marcar("orden-fecha") || undefined}
              onChange={(e) => setFecha(e.target.value)}
              onValidez={(v) => setFechaIncompleta(!v)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Notas</span>
            <input
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>
        </Seccion>
      </Hoja>

      <section className="tarjeta overflow-hidden">
        <div className="border-b border-linea p-4">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              id="orden-buscar"
              value={texto}
              aria-invalid={marcar("orden-buscar") || undefined}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Buscar qué pedir…"
              className="h-12 w-full rounded-lg border border-linea bg-background pl-9 pr-3 text-base"
            />
          </label>

          {hallazgos.length > 0 && (
            <ul className="mt-2 divide-y divide-linea rounded-lg border border-linea">
              {hallazgos.map((h) => (
                <li key={h.variantId}>
                  <button
                    type="button"
                    onClick={() => agregar(h)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-hundida"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-base">
                        {h.producto} {h.variante}
                      </span>
                      <span className="tabular block text-sm text-muted-foreground">
                        {h.sku}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-sm text-muted-foreground">
                      {/* En pesos, como lo carga el renglón (costoPropuesto):
                          decía $ 57.037,55 y el renglón 57.038 (M2S4-035). */}
                      {h.costoActual
                        ? formatearMonto(Math.round(Number(h.costoActual)))
                        : "sin costo"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {lineas.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-muted-foreground">
            Buscá arriba qué pedirle al proveedor.
          </p>
        ) : (
          <div id="orden-renglones" tabIndex={-1} className="overflow-x-auto outline-none">
            <table className="w-full min-w-[680px] text-base">
              <thead>
                <tr className="border-b border-linea text-left text-sm uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5 font-semibold">Mercadería</th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Cantidad
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Costo neto
                  </th>
                  <th className="px-4 py-2.5 text-right font-semibold">
                    Subtotal
                  </th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-linea">
                {lineas.map((l, i) => (
                  <tr key={l.variantId}>
                    <td className="px-4 py-2.5">{l.descripcion}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.cantidad}
                        onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                        aria-label={`Cantidad de ${l.descripcion}`}
                        className="tabular h-10 w-24 rounded-lg border border-linea bg-background px-2 text-right text-base"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <CampoImporte
                        valor={l.costoUnitario}
                        alCambiar={(v) => cambiar(i, "costoUnitario", v)}
                        aria-label={`Costo de ${l.descripcion}`}
                        aria-invalid={costoLejos(importeDelCampo(l.costoUnitario), l.ultimo) || undefined}
                        className={`tabular h-10 w-32 rounded-lg border border-linea bg-background px-2 text-right text-base ${
                          costoLejos(importeDelCampo(l.costoUnitario), l.ultimo) ? "ring-2 ring-saldo-debe" : ""
                        }`}
                      />
                    </td>
                    <td className="tabular px-4 py-2.5 text-right font-semibold">
                      {formatearMonto(
                        Number(l.cantidad || 0) * importeDelCampo(l.costoUnitario),
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          setLineas((prev) => prev.filter((_, j) => j !== i))
                        }
                        className="rounded-lg p-2 text-muted-foreground hover:bg-hundida hover:text-foreground"
                        aria-label="Sacar el renglón"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <BarraGuardar error={estado.error ?? (intentado ? falta?.texto : null)}>
        <div className="mr-auto">
          <p className="text-sm text-muted-foreground">Neto de la orden</p>
          <p className="tabular text-2xl font-bold">{formatearMonto(neto)}</p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (falta) {
              setIntentado(true);
              const el = document.getElementById(falta.campo);
              el?.scrollIntoView({ block: "center", behavior: "smooth" });
              el?.focus({ preventScroll: true });
              return;
            }
            empezar(async () => {
              const datos = {
                supplierId,
                branchId,
                fechaPrometida: fechaPrometida || undefined,
                notas,
                lineas: lineas.map((l) => ({
                  variantId: l.variantId,
                  descripcion: l.descripcion,
                  cantidad: Number(l.cantidad),
                  costoUnitario: importeDelCampo(l.costoUnitario),
                  alicuotaIva: Number(l.alicuotaIva),
                })),
              };
              const r = editar ? await editarOrdenDeCompra(editar.id, datos) : await crearOrdenDeCompra(datos);
              setEstado(r);
              if (r.id) router.push(`/admin/compras/ordenes/${r.id}`);
            });
          }}
          disabled={enCurso}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          {editar ? "Guardar los cambios" : "Crear la orden"}
        </button>
      </BarraGuardar>
    </div>
  );
}
