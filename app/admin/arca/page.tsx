import type { Metadata } from "next";
import Link from "next/link";
import {
  BookOpen,
  Building2,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Landmark,
  Percent,
} from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { formatearCuit, moneda } from "@/lib/formato";
import {
  configuracionFiscalActual,
  estadoArca,
  listarPuntosVenta,
  libroIvaVentas,
  resumenFacturacion,
} from "@/lib/dal/admin/facturacion";
import { listarSucursales } from "@/lib/dal/admin/inventory";
import { FormularioEmisor } from "./emisor";
import { PuntosDeVenta } from "./puntos-venta";

export const metadata: Metadata = { title: "ARCA" };

const CONDICIONES: Record<string, string> = {
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
  consumidor_final: "Consumidor final",
  no_categorizado: "No categorizado",
};

const REGIMENES: Record<string, string> = {
  local: "Local (una sola provincia)",
  convenio_multilateral: "Convenio Multilateral",
  exento: "Exento",
  no_inscripto: "No inscripto",
};

/**
 * Todo lo tributario en un solo lugar.
 *
 * Está separado de Facturación a propósito: facturar es la operación de todos
 * los días, y esto se toca cuando cambia algo de fondo —el CUIT, un punto de
 * venta, una alícuota— o cuando el contador pide el libro IVA. Mezclarlos hacía
 * que la pantalla de todos los días estuviera llena de cosas que se miran una
 * vez por año.
 */
export default async function ArcaPage() {
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);

  const finMes = new Date(inicioMes);
  finMes.setMonth(finMes.getMonth() + 1);
  finMes.setDate(0);
  finMes.setHours(23, 59, 59, 999);

  const [emisor, estado, puntos, sucursales, resumen, libro] =
    await Promise.all([
      configuracionFiscalActual(),
      estadoArca(),
      listarPuntosVenta(),
      listarSucursales(),
      resumenFacturacion(),
      libroIvaVentas(inicioMes, finMes),
    ]);

  const listoParaFacturar = Boolean(emisor.cuit) && puntos.length > 0;

  return (
    <div className="space-y-8">
      <EncabezadoPanel
        titulo="ARCA"
        detalle="Datos fiscales, puntos de venta, impuestos y el libro de IVA ventas."
      />

      {/* Estado de la conexión */}
      <section
        className={estado.operativo ? "tarjeta p-5" : "tarjeta-atencion p-5"}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            {estado.operativo ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
            ) : (
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
            )}
            <div>
              <h2 className="text-base font-medium">
                {estado.operativo
                  ? `Conectado a ARCA · ${estado.ambiente === "produccion" ? "producción" : "homologación"}`
                  : "Sin conexión con ARCA"}
              </h2>
              <p className="mt-1 max-w-2xl text-base text-muted-foreground">
                {estado.detalle ??
                  "Los comprobantes se emiten y reciben CAE normalmente."}
              </p>
            </div>
          </div>

          <a
            href="https://www.afip.gob.ar/ws/documentacion/ws-factura-electronica.asp"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-lg border bg-card px-3.5 text-base font-medium transition-colors hover:bg-muted"
          >
            Documentación
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>

        {!estado.operativo && (
          <ol className="mt-4 space-y-2 border-t pt-4">
            <Paso
              hecho={Boolean(emisor.cuit)}
              titulo="Cargar el CUIT y los datos fiscales de la empresa"
              detalle="Se completa acá abajo. Sin CUIT no se puede emitir nada."
            />
            <Paso
              hecho={puntos.length > 0}
              titulo="Dar de alta el punto de venta"
              detalle="Se habilita en ARCA con modalidad Webservices y después se carga acá con el mismo número."
            />
            <Paso
              hecho={Boolean(process.env.ARCA_CERTIFICADO)}
              titulo="Generar el certificado digital"
              detalle="Se tramita con clave fiscal. Para probar alcanza con uno de homologación, que es gratis y sale online."
            />
            <Paso
              hecho={Boolean(process.env.ARCA_CLAVE_PRIVADA)}
              titulo="Cargar certificado y clave en el servidor"
              detalle="Variables ARCA_CERTIFICADO y ARCA_CLAVE_PRIVADA, en formato PEM o base64."
            />
          </ol>
        )}
      </section>

      {/* Datos del emisor */}
      <section>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Landmark className="h-5 w-5 text-muted-foreground" />
          Datos del emisor
        </h2>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          Es lo que se imprime en cada comprobante y lo que se declara ante
          ARCA. Tiene que coincidir exactamente con la constancia de
          inscripción.
        </p>

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
              alicuotaPercepcionIibb: String(
                Number(emisor.alicuotaPercepcionIibb),
              ),
              percibeIibb: emisor.percibeIibb,
              inicioActividades: emisor.inicioActividades
                ? emisor.inicioActividades.toISOString().slice(0, 10)
                : "",
              leyenda: emisor.leyenda ?? "",
            }}
          />
        </div>
      </section>

      {/* Puntos de venta */}
      <section>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Building2 className="h-5 w-5 text-muted-foreground" />
          Puntos de venta
        </h2>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          Cada punto de venta lleva su propia numeración correlativa. Se pueden
          usar uno para toda la empresa o uno por sucursal —lo que se decida
          queda fijo, porque la numeración fiscal no se puede reordenar después.
        </p>

        <div className="mt-4">
          <PuntosDeVenta
            puntos={puntos.map((p) => ({
              id: p.id,
              numero: p.numero,
              nombre: p.nombre,
              activo: p.activo,
              branchId: p.branchId,
              sucursal: p.sucursal,
            }))}
            sucursales={sucursales.map((s) => ({ id: s.id, nombre: s.name }))}
          />
        </div>
      </section>

      {/* Impuestos */}
      <section>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <Percent className="h-5 w-5 text-muted-foreground" />
          Impuestos
        </h2>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="tarjeta p-5">
            <h3 className="text-base font-medium">IVA</h3>
            <p className="mt-1 text-base text-muted-foreground">
              Los precios del catálogo son finales, con IVA incluido: al
              facturar se desagrega. La alícuota se carga en cada producto —la
              madera va al 21 %— y desde ahí llega a la factura.
            </p>

            <p className="mt-3 text-base">
              <span className="text-muted-foreground">Condición del emisor: </span>
              {CONDICIONES[emisor.condicionIva] ?? emisor.condicionIva}
            </p>

            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="border-b text-sm uppercase tracking-[0.06em] text-muted-foreground">
                  <th scope="col" className="py-2 font-semibold">Alícuota</th>
                  <th scope="col" className="py-2 font-semibold">Uso habitual</th>
                  <th scope="col" className="py-2 text-right font-semibold">
                    Este mes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y text-base">
                <tr>
                  <td className="tabular py-2.5">21%</td>
                  <td className="py-2.5 text-muted-foreground">General</td>
                  <td className="tabular py-2.5 text-right">
                    {moneda.format(libro.totales.iva21)}
                  </td>
                </tr>
                <tr>
                  <td className="tabular py-2.5">10,5%</td>
                  <td className="py-2.5 text-muted-foreground">Reducida</td>
                  <td className="tabular py-2.5 text-right">
                    {moneda.format(libro.totales.iva105)}
                  </td>
                </tr>
                <tr>
                  <td className="tabular py-2.5">0%</td>
                  <td className="py-2.5 text-muted-foreground">Exento</td>
                  <td className="tabular py-2.5 text-right">
                    {moneda.format(libro.totales.exento)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="tarjeta p-5">
            <h3 className="text-base font-medium">Ingresos Brutos</h3>
            <p className="mt-1 text-base text-muted-foreground">
              Impuesto provincial. Si la empresa es agente de percepción, se
              agrega al comprobante como un tributo aparte del IVA.
            </p>

            <dl className="mt-3 space-y-2 text-base">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Régimen</dt>
                <dd>{REGIMENES[emisor.regimenIibb] ?? emisor.regimenIibb}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Inscripción</dt>
                <dd className="tabular">{emisor.ingresosBrutos ?? "—"}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Percibe a clientes</dt>
                <dd>
                  {emisor.percibeIibb
                    ? `Sí, ${Number(emisor.alicuotaPercepcionIibb)}%`
                    : "No"}
                </dd>
              </div>
              <div className="flex justify-between gap-3 border-t pt-2">
                <dt className="text-muted-foreground">Percibido este mes</dt>
                <dd className="tabular">
                  {moneda.format(libro.totales.tributos)}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Libro IVA ventas */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-medium">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
              Libro IVA ventas
            </h2>
            <p className="mt-1 text-base text-muted-foreground">
              {libro.filas.length > 0
                ? `${libro.filas.length} comprobantes este mes. Las notas de crédito ya restan.`
                : "Todavía no hay comprobantes este mes."}
            </p>
          </div>

          {libro.filas.length > 0 && (
            <Link
              href="/admin/arca/libro-iva"
              className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
            >
              Ver el libro completo
            </Link>
          )}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Total titulo="Neto gravado" valor={libro.totales.neto} />
          <Total titulo="IVA débito fiscal" valor={libro.totales.iva21 + libro.totales.iva105} />
          <Total titulo="Percepciones" valor={libro.totales.tributos} />
          <Total titulo="Total facturado" valor={libro.totales.total} destacado />
        </div>
      </section>

      {!listoParaFacturar && (
        <p className="text-base text-muted-foreground">
          Cuando estén cargados el CUIT y un punto de venta ya se puede empezar a
          facturar, aunque todavía no haya certificado: los comprobantes salen
          numerados y marcados como sin valor fiscal hasta que se los autorice.
        </p>
      )}

      {resumen.pendientesDeAutorizar > 0 && estado.operativo && (
        <p className="text-base text-brand-orange-dark">
          Hay {resumen.pendientesDeAutorizar} comprobantes esperando
          autorización.{" "}
          <Link href="/admin/facturacion" className="font-medium underline">
            Ir a facturación
          </Link>
        </p>
      )}
    </div>
  );
}

function Paso({
  hecho,
  titulo,
  detalle,
}: {
  hecho: boolean;
  titulo: string;
  detalle: string;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
          hecho
              ? "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
              : "bg-chip text-texto-2"
        }`}
      >
        {hecho ? "✓" : "·"}
      </span>
      <span>
        <span className="block text-base font-medium">{titulo}</span>
        <span className="block text-base text-muted-foreground">{detalle}</span>
      </span>
    </li>
  );
}

function Total({
  titulo,
  valor,
  destacado = false,
}: {
  titulo: string;
  valor: number;
  destacado?: boolean;
}) {
  return (
    <div className={destacado ? "tarjeta p-4" : "tarjeta-hundida p-4"}>
      <p className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {titulo}
      </p>
      <p className="tabular mt-1 text-2xl font-semibold">
        {moneda.format(valor)}
      </p>
    </div>
  );
}
