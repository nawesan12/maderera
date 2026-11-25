"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Calculator, FileText, Loader2, Plus } from "lucide-react";
import { BarraGuardar, Hoja, Seccion } from "@/components/admin/formulario";
import { fechaCorta, formatearMonto, hoyEnArgentina, importeDelCampo, importeParaElCampo } from "@/lib/formato";
import { COMPROBANTES_DE_COMPRA } from "@/lib/fiscal/comprobantes-compra";
import {
  cargarFacturaDeCompra,
  corregirFacturaDeCompra,
  type DatosFacturaCompra,
  type EstadoFacturaCompra,
} from "./actions";

type Tipo = keyof typeof COMPROBANTES_DE_COMPRA;

export interface ProveedorDeFactura {
  id: string;
  nombre: string;
  condicionIva: string;
  diasPago: number;
}

/** Lo que trae una factura ya cargada, para corregirla. */
export interface FacturaParaCorregir {
  id: string;
  supplierId: string;
  tipo: string;
  puntoVenta: number;
  numero: number;
  fechaEmision: string;
  fechaVencimiento: string | null;
  cae: string | null;
  neto: number;
  iva21: number;
  iva105: number;
  iva27: number;
  exento: number;
  percepciones: number;
  percepcionIva: number;
  percepcionIibb: number;
  observaciones: string | null;
}

/**
 * La letra que se espera según quién factura: un responsable inscripto nos
 * hace una A; un monotributista o un exento, una C. Se propone y se puede
 * cambiar (un proveedor puede haber cambiado de categoría y la ficha estar
 * atrasada); lo que no tiene sentido es arrancar siempre en la A.
 */
function tipoSegunCondicion(condicion: string | undefined): Tipo {
  return condicion === "responsable_inscripto" ? "factura_a" : "factura_c";
}

/** aaaa-mm-dd más n días, como lo hace Go con la emisión y los días de pago. */
function sumarDias(dia: string, dias: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const texto = (n: number) => (n ? importeParaElCampo(n) : "");

/**
 * La carga de una factura de proveedor, y su corrección.
 *
 * **El total no se pide: se suma.** Un total tipeado a mano que no coincide con
 * sus partes es la clase de dato que nadie revisa hasta que el libro IVA no
 * cierra contra el mayor. Lo que sí se puede tipear es el «total del papel»:
 * no se guarda, solo se compara con la suma, y si no coincide se ve antes de
 * cargar (el error de un dígito en el IVA aparece ahí).
 *
 * El neto no se calcula desde el total, tampoco: el proveedor factura neto y
 * después IVA, al revés que el catálogo de venta, y desagregar un total sería
 * inventar el reparto entre alícuotas.
 *
 * **Sin proveedor elegido de entrada.** Antes arrancaba en el primero de la
 * lista (alfabético), y una factura de otro quedaba cargada al que estaba
 * puesto. Al elegirlo se propone la letra (por su condición de IVA) y el
 * vencimiento (la fecha más sus días de pago), que se ve y se puede cambiar.
 *
 * **Las percepciones, por impuesto.** El libro IVA digital pide la de IVA
 * aparte de la de Ingresos Brutos; la factura suma las dos.
 *
 * **La recepción que cubre.** La recepción ya cargó la deuda con el
 * proveedor; si la factura se vincula a ella, carga solo la diferencia. Sin
 * vincular, la misma mercadería quedaba debida dos veces.
 *
 * Con `corregir`, el mismo formulario corrige una factura ya cargada: el
 * proveedor y la recepción no se cambian (eso es otra factura: se anula y se
 * carga de nuevo) y pide el motivo.
 */
export function CargarFactura({
  proveedores,
  recepciones,
  corregir,
  alTerminar,
}: {
  proveedores: ProveedorDeFactura[];
  recepciones: {
    id: string;
    supplierId: string;
    numeroRemito: string | null;
    fecha: Date;
    neto: number;
  }[];
  corregir?: FacturaParaCorregir;
  alTerminar?: () => void;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(Boolean(corregir));
  const [estado, setEstado] = useState<EstadoFacturaCompra>({});
  const [enCurso, empezar] = useTransition();

  const [supplierId, setSupplierId] = useState(corregir?.supplierId ?? "");
  const [tipo, setTipo] = useState<Tipo>((corregir?.tipo as Tipo) ?? "factura_a");
  const [puntoVenta, setPuntoVenta] = useState(corregir ? String(corregir.puntoVenta) : "");
  const [numero, setNumero] = useState(corregir ? String(corregir.numero) : "");
  const [fechaEmision, setFecha] = useState(corregir?.fechaEmision ?? hoyEnArgentina());
  // null: el que sale de la fecha y los días de pago; si se toca, el tipeado.
  const [venceTocado, setVence] = useState<string | null>(corregir?.fechaVencimiento ?? null);
  const [receiptId, setReceiptId] = useState("");
  const [cae, setCae] = useState(corregir?.cae ?? "");
  const [neto, setNeto] = useState(texto(corregir?.neto ?? 0));
  const [iva21, setIva21] = useState(texto(corregir?.iva21 ?? 0));
  const [iva105, setIva105] = useState(texto(corregir?.iva105 ?? 0));
  const [iva27, setIva27] = useState(texto(corregir?.iva27 ?? 0));
  const [exento, setExento] = useState(texto(corregir?.exento ?? 0));
  /*
   * Las de antes de separarlas (la 00101) tienen el total y las dos en cero:
   * al corregirlas, lo que había va a IIBB, que es la percepción que más se
   * ve en compras, y se corrige a mano si era de IVA.
   */
  const sinSeparar =
    corregir && corregir.percepciones > 0 && corregir.percepcionIva + corregir.percepcionIibb === 0;
  const [percepcionIva, setPercepcionIva] = useState(texto(corregir?.percepcionIva ?? 0));
  const [percepcionIibb, setPercepcionIibb] = useState(
    texto(sinSeparar ? corregir.percepciones : (corregir?.percepcionIibb ?? 0)),
  );
  const [totalPapel, setTotalPapel] = useState("");
  const [motivo, setMotivo] = useState("");

  const proveedor = proveedores.find((p) => p.id === supplierId);
  const delProveedor = corregir ? [] : recepciones.filter((r) => r.supplierId === supplierId);
  const vence = venceTocado ?? sumarDias(fechaEmision, proveedor?.diasPago ?? 0);

  const n = importeDelCampo;
  const percepciones = Math.round((n(percepcionIva) + n(percepcionIibb)) * 100) / 100;
  const total =
    Math.round((n(neto) + n(iva21) + n(iva105) + n(iva27) + n(exento) + percepciones) * 100) / 100;
  const diferencia = totalPapel === "" ? 0 : Math.round((n(totalPapel) - total) * 100) / 100;

  /*
   * El IVA sugerido: el 21 % del neto. Es lo que trae el 90 % de las facturas,
   * y tipear el mismo número que ya está calculado es donde se cuela el error
   * de un dígito.
   */
  const sugerido = Math.round(n(neto) * 0.21 * 100) / 100;

  function elegirProveedor(id: string) {
    setSupplierId(id);
    setReceiptId("");
    setTipo(tipoSegunCondicion(proveedores.find((p) => p.id === id)?.condicionIva));
  }

  function limpiar() {
    setPuntoVenta("");
    setNumero("");
    setCae("");
    setNeto("");
    setIva21("");
    setIva105("");
    setIva27("");
    setExento("");
    setPercepcionIva("");
    setPercepcionIibb("");
    setTotalPapel("");
    setReceiptId("");
    setVence(null);
  }

  function guardar() {
    empezar(async () => {
      const datos: DatosFacturaCompra = {
        supplierId,
        tipo,
        puntoVenta: Number(puntoVenta || 0),
        numero: Number(numero || 0),
        fechaEmision,
        fechaVencimiento: vence || undefined,
        cae,
        neto: n(neto),
        iva21: n(iva21),
        iva105: n(iva105),
        iva27: n(iva27),
        exento: n(exento),
        percepciones,
        percepcionIva: n(percepcionIva),
        percepcionIibb: n(percepcionIibb),
        receiptId: receiptId || undefined,
      };
      const resultado = corregir
        ? await corregirFacturaDeCompra(corregir.id, { ...datos, motivo })
        : await cargarFacturaDeCompra(datos);
      setEstado(resultado);
      if (resultado.ok) {
        if (!corregir) limpiar();
        router.refresh();
        alTerminar?.();
      }
    });
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="boton-accion inline-flex h-12 items-center gap-2 rounded-xl px-5 text-base font-semibold"
      >
        <Plus className="h-5 w-5" />
        Cargar una factura
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <Hoja>
        <Seccion titulo="Comprobante" icono={FileText}>
          <label className="block md:col-span-2">
            <span className="text-base font-medium">Proveedor</span>
            <select
              value={supplierId}
              disabled={Boolean(corregir)}
              onChange={(e) => elegirProveedor(e.target.value)}
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

          <label className="block">
            <span className="text-base font-medium">Tipo</span>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as Tipo)}
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            >
              {Object.entries(COMPROBANTES_DE_COMPRA).map(([valor, nombre]) => (
                <option key={valor} value={valor}>
                  {nombre}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
            <Campo etiqueta="Punto de venta" valor={puntoVenta} onCambio={setPuntoVenta} numerico entero />
            <Campo etiqueta="Número" valor={numero} onCambio={setNumero} numerico entero />
          </div>

          <label className="block">
            <span className="text-base font-medium">Fecha</span>
            <input
              type="date"
              value={fechaEmision}
              onChange={(e) => setFecha(e.target.value)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>

          <label className="block">
            <span className="text-base font-medium">Vence</span>
            <input
              type="date"
              value={vence}
              min={fechaEmision}
              onChange={(e) => setVence(e.target.value || null)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>

          <Campo etiqueta="CAE" valor={cae} onCambio={setCae} />

          {delProveedor.length > 0 && (
            <label className="block">
              <span className="text-base font-medium">Recepción que cubre</span>
              <select
                value={receiptId}
                onChange={(e) => setReceiptId(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
              >
                <option value="">Ninguna</option>
                {delProveedor.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.numeroRemito ? `Remito ${r.numeroRemito}` : "Sin remito"} ·{" "}
                    {fechaCorta.format(r.fecha)} · {formatearMonto(r.neto)} neto
                  </option>
                ))}
              </select>
            </label>
          )}
        </Seccion>

        <Seccion titulo="Importes" icono={Calculator} columnas={3}>
          <label className="block">
            <span className="text-base font-medium">Neto gravado</span>
            <input
              type="text"
              inputMode="decimal"
              value={neto}
              onChange={(e) => setNeto(e.target.value)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
            />
            {sugerido > 0 && n(iva21) === 0 && (
              <button
                type="button"
                onClick={() => setIva21(importeParaElCampo(sugerido))}
                className="mt-1 text-base text-muted-foreground underline"
              >
                IVA 21% = {formatearMonto(sugerido)}
              </button>
            )}
          </label>
          <Campo etiqueta="IVA 21%" valor={iva21} onCambio={setIva21} numerico />
          <Campo etiqueta="IVA 10,5%" valor={iva105} onCambio={setIva105} numerico />
          <Campo etiqueta="IVA 27%" valor={iva27} onCambio={setIva27} numerico />
          <Campo etiqueta="Exento o no gravado" valor={exento} onCambio={setExento} numerico />
          <div className="hidden md:block" />
          <Campo etiqueta="Percepción de IVA" valor={percepcionIva} onCambio={setPercepcionIva} numerico />
          <Campo etiqueta="Percepción de IIBB" valor={percepcionIibb} onCambio={setPercepcionIibb} numerico />
        </Seccion>

        <div className="grid gap-5 py-8 md:grid-cols-2">
          <div>
            <p className="text-base text-muted-foreground">Total</p>
            <p className="tabular text-3xl font-bold">{formatearMonto(total)}</p>
          </div>
          <label className="block">
            <span className="text-base font-medium">Total del papel</span>
            <input
              type="text"
              inputMode="decimal"
              value={totalPapel}
              onChange={(e) => setTotalPapel(e.target.value)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
            />
            {totalPapel !== "" && Math.abs(diferencia) > 0.01 && (
              <span className="mt-1 block text-base font-medium text-saldo-debe" role="alert">
                No coincide con la suma: {diferencia > 0 ? "faltan" : "sobran"} {formatearMonto(Math.abs(diferencia))}
              </span>
            )}
          </label>
          {corregir && (
            <label className="block md:col-span-2">
              <span className="text-base font-medium">Motivo de la corrección</span>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
              />
            </label>
          )}
        </div>
      </Hoja>

      <BarraGuardar error={estado.error}>
        <button
          type="button"
          onClick={guardar}
          disabled={
            enCurso ||
            total <= 0 ||
            !supplierId ||
            (corregir !== undefined && motivo.trim() === "")
          }
          className="boton-accion inline-flex h-12 items-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          {corregir ? "Guardar la corrección" : "Cargar la factura"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            alTerminar?.();
          }}
          className="tarjeta-hundida h-12 rounded-xl px-4 text-base font-medium"
        >
          Cerrar
        </button>
        {estado.ok && <p className="text-base text-saldo-favor">{estado.ok}</p>}
      </BarraGuardar>
    </div>
  );
}

function Campo({
  etiqueta,
  valor,
  onCambio,
  numerico,
  entero,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  numerico?: boolean;
  entero?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-base font-medium">{etiqueta}</span>
      <input
        // La plata va en texto y se lee con importeDelCampo («15.000» son
        // quince mil); los números enteros (punto de venta, número), no.
        type={numerico && entero ? "number" : "text"}
        inputMode={numerico ? (entero ? "numeric" : "decimal") : undefined}
        min={numerico && entero ? "0" : undefined}
        step={numerico && entero ? "1" : undefined}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className={`mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base ${
          numerico ? "tabular text-right" : ""
        }`}
      />
    </label>
  );
}
