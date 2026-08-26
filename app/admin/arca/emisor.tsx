"use client";

import { useActionState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { guardarDatosEmisor, type EstadoFactura } from "../facturacion/actions";

const inicial: EstadoFactura = {};

export interface DatosEmisor {
  razonSocial: string;
  nombreFantasia: string;
  cuit: string;
  condicionIva: string;
  domicilio: string;
  localidad: string;
  codigoPostal: string;
  telefono: string;
  email: string;
  ingresosBrutos: string;
  regimenIibb: string;
  alicuotaPercepcionIibb: string;
  percibeIibb: boolean;
  inicioActividades: string;
  leyenda: string;
}

const CONDICIONES = [
  { valor: "responsable_inscripto", texto: "Responsable inscripto" },
  { valor: "monotributista", texto: "Monotributista" },
  { valor: "exento", texto: "Exento" },
  { valor: "no_categorizado", texto: "No categorizado" },
];

const REGIMENES = [
  { valor: "local", texto: "Local (una sola provincia)" },
  { valor: "convenio_multilateral", texto: "Convenio Multilateral" },
  { valor: "exento", texto: "Exento" },
  { valor: "no_inscripto", texto: "No inscripto" },
];

export function FormularioEmisor({ emisor }: { emisor: DatosEmisor }) {
  const [estado, accion, pendiente] = useActionState(
    guardarDatosEmisor,
    inicial,
  );

  return (
    <form action={accion} className="space-y-4">
      <section className="tarjeta p-5">
        <h3 className="mb-4 text-base font-medium">Identificación</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            id="razonSocial"
            etiqueta="Razón social"
            defaultValue={emisor.razonSocial}
            required
          />
          <Campo
            id="nombreFantasia"
            etiqueta="Nombre de fantasía"
            defaultValue={emisor.nombreFantasia}
          />
          <Campo
            id="cuit"
            etiqueta="CUIT"
            defaultValue={emisor.cuit}
            placeholder="30-12345678-9"
            required
            tabular
          />
          <div>
            <label
              htmlFor="condicionIva"
              className="mb-1.5 block text-base font-medium"
            >
              Condición frente al IVA
            </label>
            <select
              id="condicionIva"
              name="condicionIva"
              defaultValue={emisor.condicionIva}
              className="h-10 w-full rounded-lg border bg-background px-2.5 text-base"
            >
              {CONDICIONES.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.texto}
                </option>
              ))}
            </select>
            <p className="mt-1 text-sm text-muted-foreground">
              Define la letra de los comprobantes: un responsable inscripto
              emite A y B.
            </p>
          </div>
          <Campo
            id="inicioActividades"
            etiqueta="Inicio de actividades"
            defaultValue={emisor.inicioActividades}
            type="date"
          />
        </div>
      </section>

      <section className="tarjeta p-5">
        <h3 className="mb-4 text-base font-medium">Domicilio y contacto</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo id="domicilio" etiqueta="Domicilio fiscal" defaultValue={emisor.domicilio} />
          <Campo id="localidad" etiqueta="Localidad" defaultValue={emisor.localidad} />
          <Campo id="codigoPostal" etiqueta="Código postal" defaultValue={emisor.codigoPostal} tabular />
          <Campo id="telefono" etiqueta="Teléfono" defaultValue={emisor.telefono} tabular />
          <Campo id="email" etiqueta="Correo" defaultValue={emisor.email} />
        </div>
      </section>

      <section className="tarjeta p-5">
        <h3 className="text-base font-medium">Ingresos Brutos</h3>
        <p className="mt-1 text-base text-muted-foreground">
          Si la empresa es agente de percepción, el importe se suma al
          comprobante como un tributo aparte del IVA.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Campo
            id="ingresosBrutos"
            etiqueta="Número de inscripción"
            defaultValue={emisor.ingresosBrutos}
            tabular
          />
          <div>
            <label
              htmlFor="regimenIibb"
              className="mb-1.5 block text-base font-medium"
            >
              Régimen
            </label>
            <select
              id="regimenIibb"
              name="regimenIibb"
              defaultValue={emisor.regimenIibb}
              className="h-10 w-full rounded-lg border bg-background px-2.5 text-base"
            >
              {REGIMENES.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.texto}
                </option>
              ))}
            </select>
          </div>
          <Campo
            id="alicuotaPercepcionIibb"
            etiqueta="Alícuota de percepción (%)"
            defaultValue={emisor.alicuotaPercepcionIibb}
            tabular
          />
          <label className="flex items-end gap-2.5 pb-2 text-base">
            <input
              type="checkbox"
              name="percibeIibb"
              defaultChecked={emisor.percibeIibb}
              className="h-4 w-4 accent-[var(--brand-orange,#e2711d)]"
            />
            Actuar como agente de percepción
          </label>
        </div>
      </section>

      <section className="tarjeta p-5">
        <label htmlFor="leyenda" className="block text-base font-medium">
          Leyenda al pie del comprobante
        </label>
        <p className="mt-1 text-base text-muted-foreground">
          Condiciones de venta, aclaraciones sobre garantías o devoluciones.
        </p>
        <textarea
          id="leyenda"
          name="leyenda"
          rows={2}
          maxLength={500}
          defaultValue={emisor.leyenda}
          className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5 text-base"
        />
      </section>

      {estado.error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg bg-red-50 px-3.5 py-2.5 text-base text-red-800"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg bg-green-50 px-3.5 py-2.5 text-base text-green-900"
        >
          <Check className="h-5 w-5 shrink-0" />
          {estado.ok}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
      >
        {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
        Guardar datos fiscales
      </button>
    </form>
  );
}

function Campo({
  id,
  etiqueta,
  defaultValue,
  placeholder,
  type = "text",
  required = false,
  tabular = false,
}: {
  id: string;
  etiqueta: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  tabular?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-base font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className={`h-10 w-full rounded-lg border bg-background px-3 text-base ${
          tabular ? "tabular" : ""
        }`}
      />
    </div>
  );
}
