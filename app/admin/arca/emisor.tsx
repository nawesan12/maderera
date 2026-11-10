"use client";

import { useActionState } from "react";
import {
  AlertCircle,
  Building2,
  Check,
  CircleHelp,
  IdCard,
  Landmark,
  Loader2,
  MapIcon,
  MapPin,
  Receipt,
  ScrollText,
  ShieldCheck,
  User,
} from "lucide-react";
import {
  Hoja,
  Interruptor,
  Opciones,
  Seccion,
} from "@/components/admin/formulario";
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
  {
    valor: "responsable_inscripto",
    texto: "Responsable inscripto",
    icono: Building2,
  },
  { valor: "monotributista", texto: "Monotributista", icono: User },
  { valor: "exento", texto: "Exento", icono: ShieldCheck },
  { valor: "no_categorizado", texto: "No categorizado", icono: CircleHelp },
];

const REGIMENES = [
  { valor: "local", texto: "Local (una sola provincia)", icono: MapPin },
  {
    valor: "convenio_multilateral",
    texto: "Convenio Multilateral",
    icono: MapIcon,
  },
  { valor: "exento", texto: "Exento", icono: ShieldCheck },
  { valor: "no_inscripto", texto: "No inscripto", icono: CircleHelp },
];

export function FormularioEmisor({ emisor }: { emisor: DatosEmisor }) {
  const [estado, accion, pendiente] = useActionState(
    guardarDatosEmisor,
    inicial,
  );

  return (
    <form action={accion} className="space-y-4">
      <Hoja>
        <Seccion titulo="Identificación" icono={IdCard}>
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
          <Campo
            id="inicioActividades"
            etiqueta="Inicio de actividades"
            defaultValue={emisor.inicioActividades}
            type="date"
          />
          <div className="md:col-span-2">
            <p className="mb-1.5 block text-base font-medium">
              Condición frente al IVA
            </p>
            <Opciones
              nombre="condicionIva"
              defecto={emisor.condicionIva}
              opciones={CONDICIONES}
            />
            {/* Se queda: elegir mal la condición cambia la letra de todo lo
                que se emite ante ARCA. */}
            <p className="mt-1.5 text-sm text-muted-foreground">
              Define la letra de los comprobantes: un responsable inscripto
              emite A y B.
            </p>
          </div>
        </Seccion>

        <Seccion titulo="Domicilio y contacto" icono={MapPin}>
          <Campo
            id="domicilio"
            etiqueta="Domicilio fiscal"
            defaultValue={emisor.domicilio}
          />
          <Campo
            id="localidad"
            etiqueta="Localidad"
            defaultValue={emisor.localidad}
          />
          <Campo
            id="codigoPostal"
            etiqueta="Código postal"
            defaultValue={emisor.codigoPostal}
            tabular
          />
          <Campo
            id="telefono"
            etiqueta="Teléfono"
            defaultValue={emisor.telefono}
            tabular
          />
          <Campo id="email" etiqueta="Correo" defaultValue={emisor.email} />
        </Seccion>

        <Seccion titulo="Ingresos Brutos" icono={Landmark}>
          <Campo
            id="ingresosBrutos"
            etiqueta="Número de inscripción"
            defaultValue={emisor.ingresosBrutos}
            tabular
          />
          <Campo
            id="alicuotaPercepcionIibb"
            etiqueta="Alícuota de percepción (%)"
            defaultValue={emisor.alicuotaPercepcionIibb}
            tabular
          />
          <div className="md:col-span-2">
            <p className="mb-1.5 block text-base font-medium">Régimen</p>
            <Opciones
              nombre="regimenIibb"
              defecto={emisor.regimenIibb}
              opciones={REGIMENES}
            />
          </div>
          <div className="md:col-span-2">
            <Interruptor
              nombre="percibeIibb"
              etiqueta="Actuar como agente de percepción"
              icono={Receipt}
              defecto={emisor.percibeIibb}
            />
          </div>
        </Seccion>

        <Seccion titulo="Leyenda" icono={ScrollText} columnas={1}>
          <div>
            <label
              htmlFor="leyenda"
              className="mb-1.5 block text-base font-medium"
            >
              Leyenda al pie del comprobante
            </label>
            <textarea
              id="leyenda"
              name="leyenda"
              rows={2}
              maxLength={500}
              defaultValue={emisor.leyenda}
              className="w-full rounded-lg border bg-background px-3 py-2.5 text-base"
            />
          </div>
        </Seccion>
      </Hoja>

      {estado.error && (
        <p
          role="alert"
          className="estado-problema flex items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base text-[var(--estado-tinta)]"
        >
          <AlertCircle className="h-5 w-5 shrink-0" />
          {estado.error}
        </p>
      )}
      {estado.ok && (
        <p
          role="status"
          className="estado-ok flex items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base text-[var(--estado-tinta)]"
        >
          <Check className="h-5 w-5 shrink-0" />
          {estado.ok}
        </p>
      )}

      <button
        type="submit"
        disabled={pendiente}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
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
