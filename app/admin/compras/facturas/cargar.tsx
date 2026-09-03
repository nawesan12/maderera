"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import { COMPROBANTES_DE_COMPRA, daCreditoFiscal } from "@/lib/fiscal/comprobantes-compra";
import { cargarFacturaDeCompra, type EstadoFacturaCompra } from "./actions";

/**
 * La carga de una factura de proveedor.
 *
 * **El total no se pide: se suma.** Un total tipeado a mano que no coincide con
 * sus partes es la clase de dato que nadie revisa hasta que el libro IVA no
 * cierra contra el mayor, y para entonces hay treinta facturas por revisar.
 *
 * El neto no se calcula desde el total, tampoco: el proveedor factura neto y
 * después IVA, al revés que el catálogo de venta, y desagregar un total sería
 * inventar el reparto entre alícuotas.
 */
export function CargarFactura({
  proveedores,
}: {
  proveedores: { id: string; nombre: string; condicionIva: string }[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState<EstadoFacturaCompra>({});
  const [enCurso, empezar] = useTransition();

  const [supplierId, setSupplierId] = useState(proveedores[0]?.id ?? "");
  const [tipo, setTipo] = useState<keyof typeof COMPROBANTES_DE_COMPRA>("factura_a");
  const [puntoVenta, setPuntoVenta] = useState("");
  const [numero, setNumero] = useState("");
  const [fechaEmision, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [cae, setCae] = useState("");
  const [neto, setNeto] = useState("");
  const [iva21, setIva21] = useState("");
  const [iva105, setIva105] = useState("");
  const [iva27, setIva27] = useState("");
  const [exento, setExento] = useState("");
  const [percepciones, setPercepciones] = useState("");

  const n = (v: string) => Number(v || 0);
  const total =
    n(neto) + n(iva21) + n(iva105) + n(iva27) + n(exento) + n(percepciones);

  /*
   * El IVA sugerido: el 21 % del neto. Es lo que trae el 90 % de las facturas,
   * y tipear el mismo número que ya está calculado es donde se cuela el error
   * de un dígito.
   */
  const sugerido = Math.round(n(neto) * 0.21 * 100) / 100;

  function guardar() {
    empezar(async () => {
      const resultado = await cargarFacturaDeCompra({
        supplierId,
        tipo,
        puntoVenta: Number(puntoVenta || 0),
        numero: Number(numero || 0),
        fechaEmision,
        cae,
        neto: n(neto),
        iva21: n(iva21),
        iva105: n(iva105),
        iva27: n(iva27),
        exento: n(exento),
        percepciones: n(percepciones),
      });
      setEstado(resultado);
      if (resultado.ok) {
        setPuntoVenta("");
        setNumero("");
        setCae("");
        setNeto("");
        setIva21("");
        setIva105("");
        setIva27("");
        setExento("");
        setPercepciones("");
        router.refresh();
      }
    });
  }

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-11 items-center gap-1.5 rounded-lg boton-accion px-4 text-base font-medium transition-colors"
      >
        <Plus className="h-4 w-4" />
        Cargar una factura
      </button>
    );
  }

  return (
    <section className="tarjeta space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-sm font-medium">Proveedor</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Tipo</span>
          <select
            value={tipo}
            onChange={(e) =>
              setTipo(e.target.value as keyof typeof COMPROBANTES_DE_COMPRA)
            }
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            {Object.entries(COMPROBANTES_DE_COMPRA).map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
          {!daCreditoFiscal(tipo) && (
            <span className="text-sm text-muted-foreground">
              No discrimina IVA: no da crédito fiscal.
            </span>
          )}
        </label>

        <Campo etiqueta="Punto de venta" valor={puntoVenta} onCambio={setPuntoVenta} numerico />
        <Campo etiqueta="Número" valor={numero} onCambio={setNumero} numerico />

        <label className="block">
          <span className="text-sm font-medium">Fecha</span>
          <input
            type="date"
            value={fechaEmision}
            onChange={(e) => setFecha(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        <Campo etiqueta="CAE" valor={cae} onCambio={setCae} />
      </div>

      <div className="grid gap-4 border-t border-linea pt-4 sm:grid-cols-3 lg:grid-cols-6">
        <label className="block">
          <span className="text-sm font-medium">Neto</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={neto}
            onChange={(e) => setNeto(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
          />
          {sugerido > 0 && n(iva21) === 0 && (
            <button
              type="button"
              onClick={() => setIva21(String(sugerido))}
              className="mt-1 text-sm text-muted-foreground underline"
            >
              IVA 21% = {formatearMonto(sugerido)}
            </button>
          )}
        </label>

        <Campo etiqueta="IVA 21%" valor={iva21} onCambio={setIva21} numerico />
        <Campo etiqueta="IVA 10,5%" valor={iva105} onCambio={setIva105} numerico />
        <Campo etiqueta="IVA 27%" valor={iva27} onCambio={setIva27} numerico />
        <Campo etiqueta="Exento" valor={exento} onCambio={setExento} numerico />
        <Campo
          etiqueta="Percepciones"
          valor={percepciones}
          onCambio={setPercepciones}
          numerico
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linea pt-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Total (suma de las partes)
          </p>
          <p className="tabular text-2xl font-bold">{formatearMonto(total)}</p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setAbierto(false)}
            className="h-12 rounded-xl border border-linea px-4 text-base"
          >
            Cerrar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={enCurso || total <= 0 || !supplierId}
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
            Cargar
          </button>
        </div>
      </div>

      {(estado.error || estado.ok) && (
        <p
          className={`text-base ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {estado.error ?? estado.ok}
        </p>
      )}
    </section>
  );
}

function Campo({
  etiqueta,
  valor,
  onCambio,
  numerico,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  numerico?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{etiqueta}</span>
      <input
        type={numerico ? "number" : "text"}
        min={numerico ? "0" : undefined}
        step={numerico ? "0.01" : undefined}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className={`mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base ${
          numerico ? "tabular text-right" : ""
        }`}
      />
    </label>
  );
}
