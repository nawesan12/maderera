import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleAlert,
  Landmark,
} from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { formatearCuit } from "@/lib/formato";
import {
  configuracionFiscalActual,
  estadoArca,
  listarPuntosVenta,
  padronIibb,
} from "@/lib/dal/admin/facturacion";
import { listarSucursales } from "@/lib/dal/admin/inventory";
import { FormularioEmisor } from "../emisor";
import { PuntosDeVenta } from "../puntos-venta";
import { PadronIibb } from "../padron";

export const metadata: Metadata = { title: "Configuración de ARCA" };

/**
 * La configuración fiscal: la conexión con ARCA, los datos del emisor y los
 * puntos de venta.
 *
 * Estaba en la misma pantalla que los impuestos del mes, arriba de todo, y
 * eso es lo que se toca una vez por año (cuando cambia el CUIT, un punto de
 * venta, el régimen de Ingresos Brutos). Los impuestos son lo de todos los
 * meses: quedaron en /admin/arca y esto, detrás de un botón.
 *
 * Los pasos para conectar no nombran variables de entorno, rutas de archivos
 * ni «Webservices»: quien los lee es la administración. El detalle técnico
 * —el certificado y la clave van en ARCA_CERTIFICADO y ARCA_CLAVE_PRIVADA, o
 * en secretos/arca/arca.crt y arca.key del servidor propio; el punto de
 * venta se da de alta en ARCA con la modalidad «RECE para aplicativo y web
 * services»— está en la guía de despliegue.
 *
 * El ambiente de homologación se dice «de prueba».
 */
export default async function ConfiguracionArcaPage() {
  const [emisor, estado, puntos, sucursales, padron] = await Promise.all([
    configuracionFiscalActual(),
    estadoArca(),
    listarPuntosVenta(),
    listarSucursales(),
    padronIibb(),
  ]);

  return (
    <div className="space-y-8">
      <Link
        href="/admin/arca"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Impuestos del mes
      </Link>

      <EncabezadoPanel titulo="Configuración de ARCA" />

      <section
        className={estado.operativo ? "tarjeta p-5" : "tarjeta-atencion p-5"}
      >
        <div className="flex gap-3">
          {estado.operativo ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-saldo-favor" />
          ) : (
            <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          )}
          <div>
            <h2 className="text-base font-medium">
              {estado.operativo
                ? `Conectado a ARCA${estado.ambiente === "produccion" ? "" : " de prueba"}`
                : "Sin conexión con ARCA"}
            </h2>
            {estado.detalle && (
              <p className="mt-1 max-w-2xl text-base text-muted-foreground">
                {estado.detalle}
              </p>
            )}
          </div>
        </div>

        {!estado.operativo && (
          <ol className="mt-4 space-y-2 pt-2">
            {/* Hecho con todo lo que va impreso en el comprobante (RG 1415):
                se tildaba con el CUIT solo, con el N° de Ingresos Brutos y el
                inicio de actividades vacíos (M2S1-051). Sin ellos ARCA no se
                pide (Go lo frena al autorizar). */}
            <Paso
              hecho={Boolean(
                emisor.cuit && emisor.razonSocial && emisor.domicilio && emisor.ingresosBrutos && emisor.inicioActividades,
              )}
              titulo="Cargar el CUIT y los datos fiscales de la empresa"
            />
            <Paso
              hecho={puntos.length > 0}
              titulo="Dar de alta en ARCA el punto de venta para facturar desde el sistema"
            />
            <Paso
              hecho={estado.hayCertificado}
              titulo="Tramitar el certificado digital con clave fiscal"
            />
            <Paso
              hecho={estado.hayClave}
              titulo="Entregar el certificado y su clave a quien mantiene el sistema"
            />
          </ol>
        )}
      </section>

      <section>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Landmark className="h-5 w-5 text-muted-foreground" />
          Datos del emisor
        </h2>
        <div className="mt-4">
          <FormularioEmisor
            emisor={{
              razonSocial: emisor.razonSocial,
              nombreFantasia: emisor.nombreFantasia ?? "",
              cuit: emisor.cuit ? formatearCuit(emisor.cuit) : "",
              condicionIva: emisor.condicionIva,
              domicilio: emisor.domicilio ?? "",
              localidad: emisor.localidad,
              codigoPostal: emisor.codigoPostal ?? "",
              telefono: emisor.telefono ?? "",
              email: emisor.email ?? "",
              ingresosBrutos: emisor.ingresosBrutos ?? "",
              regimenIibb: emisor.regimenIibb,
              alicuotaIibbSinPadron:
                emisor.alicuotaIibbSinPadron == null ? "" : String(Number(emisor.alicuotaIibbSinPadron)),
              percibeIibb: emisor.percibeIibb,
              inicioActividades: emisor.inicioActividades
                ? emisor.inicioActividades.toISOString().slice(0, 10)
                : "",
              leyenda: emisor.leyenda ?? "",
              ivaDesde: emisor.ivaDesde ?? "",
              ivaSaldoTecnico: emisor.ivaDesde ? String(Number(emisor.ivaSaldoTecnico)) : "",
              ivaSaldoLibre: emisor.ivaDesde ? String(Number(emisor.ivaSaldoLibre)) : "",
            }}
          />
        </div>
      </section>

      <section>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Landmark className="h-5 w-5 text-muted-foreground" />
          Padrón IIBB
        </h2>
        <div className="mt-4">
          <PadronIibb filas={padron} />
        </div>
      </section>

      <section>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          Puntos de venta
        </h2>
        <div className="mt-4">
          <PuntosDeVenta
            puntos={puntos.map((p) => ({
              id: p.id,
              numero: p.numero,
              nombre: p.nombre,
              activo: p.activo,
              numeroInicial: p.numeroInicial,
              branchId: p.branchId,
              sucursal: p.sucursal,
            }))}
            sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.name }))}
          />
        </div>
      </section>
    </div>
  );
}

function Paso({ hecho, titulo }: { hecho: boolean; titulo: string }) {
  return (
    <li className="flex items-center gap-3">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
          hecho
            ? "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
            : "bg-chip text-texto-2"
        }`}
      >
        {hecho ? "✓" : "·"}
      </span>
      <span className="text-base font-medium">{titulo}</span>
    </li>
  );
}
