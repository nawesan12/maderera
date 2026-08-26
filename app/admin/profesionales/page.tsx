import type { Metadata } from "next";
import Link from "next/link";
import { HardHat, Percent, Tags } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import {
  AcentoEstado,
  EtiquetaEstado,
} from "@/components/admin/etiqueta-estado";
import { fechaHora, plural } from "@/lib/formato";
import { formatearCuitLargo } from "@/lib/cuit";
import {
  listarEscalas,
  listarSolicitudes,
  listasAsignables,
  resumenProfesionales,
  type SolicitudListada,
} from "@/lib/dal/admin/profesionales";
import { ResolverSolicitud } from "./resolver";
import { Escalas } from "./escalas";

export const metadata: Metadata = { title: "Profesionales" };

const RUBROS: Record<string, string> = {
  arquitecto: "Arquitectura",
  constructora: "Constructora",
  carpintero: "Carpintería",
  disenador: "Diseño de interiores",
  instalador: "Instalación",
  otro: "Otro",
};

/**
 * Solicitudes de acceso profesional y política de descuentos.
 *
 * Las pendientes van arriba y con todo lo que hace falta para decidir a la
 * vista —rubro, volumen estimado, si ya es cliente del mostrador—: mandar a
 * alguien a buscar esos datos a otra pantalla es lo que hace que las solicitudes
 * se acumulen sin responder.
 */
export default async function ProfesionalesAdminPage() {
  const [solicitudes, listas, escalas, resumen] = await Promise.all([
    listarSolicitudes(),
    listasAsignables(),
    listarEscalas(),
    resumenProfesionales(),
  ]);

  const pendientes = solicitudes.filter((s) => s.estado === "pendiente");
  const resueltas = solicitudes.filter((s) => s.estado !== "pendiente");

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Profesionales"
        detalle="Quién pide acceso, quién ya lo tiene y con qué precios compra."
      >
        <Link
          href="/admin/precios"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <Tags className="h-5 w-5" />
          Precios
        </Link>
      </EncabezadoPanel>

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          titulo="Esperando respuesta"
          valor={String(resumen.pendientes)}
          detalle={
            resumen.pendientes > 0
              ? "El compromiso es contestar en 24 h"
              : "Todo contestado"
          }
          atencion={resumen.pendientes > 0}
        />
        <Indicador
          titulo="Habilitados este mes"
          valor={String(resumen.aprobadosMes)}
          detalle="Altas nuevas"
        />
        <Indicador
          titulo="Clientes profesionales"
          valor={String(resumen.clientesProfesionales)}
          detalle="Con precios diferenciados"
        />
      </div>

      {pendientes.length > 0 && (
        <section className="tarjeta-atencion">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
            <h2 className="text-base font-medium">Esperando respuesta</h2>
            <p className="text-base text-muted-foreground">
              {plural(pendientes.length, "solicitud", "solicitudes")}
            </p>
          </div>

          <ul className="divide-y">
            {pendientes.map((solicitud) => (
              <Fila
                key={solicitud.id}
                solicitud={solicitud}
                listas={listas}
                resoluble
              />
            ))}
          </ul>
        </section>
      )}

      {solicitudes.length === 0 && (
        <section className="tarjeta px-6 py-16 text-center">
          <HardHat className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <h2 className="mt-4 text-lg font-medium">
            Todavía no pidió acceso nadie
          </h2>
          <p className="mx-auto mt-1 max-w-md text-base text-muted-foreground">
            Las solicitudes entran desde{" "}
            <Link href="/profesionales" className="underline">
              la página de profesionales
            </Link>
            . También se puede marcar a un cliente como profesional desde su
            ficha.
          </p>
        </section>
      )}

      {resueltas.length > 0 && (
        <section className="tarjeta">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-medium">Resueltas</h2>
          </div>
          <ul className="divide-y">
            {resueltas.map((solicitud) => (
              <Fila key={solicitud.id} solicitud={solicitud} listas={listas} />
            ))}
          </ul>
        </section>
      )}

      <Escalas escalas={escalas} listas={listas} />
    </div>
  );
}

function Fila({
  solicitud,
  listas,
  resoluble = false,
}: {
  solicitud: SolicitudListada;
  listas: Awaited<ReturnType<typeof listasAsignables>>;
  resoluble?: boolean;
}) {
  return (
    <li className="relative overflow-hidden px-5 py-4">
      <AcentoEstado
        estado={
          solicitud.estado === "pendiente"
            ? "pendiente"
            : solicitud.estado === "aprobada"
              ? "aceptado"
              : "rechazado"
        }
      />

      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 pl-2">
        <div className="min-w-[16rem] flex-1">
          <p className="text-base font-medium">
            {solicitud.razonSocial || solicitud.nombre}
            {solicitud.razonSocial && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {solicitud.nombre}
              </span>
            )}
          </p>
          <p className="tabular text-base text-muted-foreground">
            {formatearCuitLargo(solicitud.cuit)} ·{" "}
            {RUBROS[solicitud.rubro] ?? solicitud.rubro}
            {solicitud.localidad ? ` · ${solicitud.localidad}` : ""}
          </p>
          <p className="text-base text-muted-foreground">
            {solicitud.email} · {solicitud.telefono}
            {solicitud.matricula ? ` · matrícula ${solicitud.matricula}` : ""}
          </p>

          {solicitud.volumenEstimado && (
            <p className="mt-1 text-base">
              <span className="text-muted-foreground">Compra: </span>
              {solicitud.volumenEstimado}
            </p>
          )}

          {solicitud.mensaje && (
            <p className="mt-1 text-base text-muted-foreground">
              “{solicitud.mensaje}”
            </p>
          )}

          {solicitud.clienteExistente && solicitud.estado === "pendiente" && (
            <p className="mt-1 text-base text-brand-orange-dark">
              Ya es cliente: {solicitud.clienteExistente.nombre}
            </p>
          )}

          {solicitud.motivoRechazo && (
            <p className="mt-1 text-base text-muted-foreground">
              Motivo del rechazo: {solicitud.motivoRechazo}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <EtiquetaEstado
            estado={
              solicitud.estado === "pendiente"
                ? "pendiente"
                : solicitud.estado === "aprobada"
                  ? "aceptado"
                  : "rechazado"
            }
          />
          <span className="tabular text-base text-muted-foreground">
            {fechaHora.format(solicitud.resueltoAt ?? solicitud.createdAt)}
          </span>
          {solicitud.customerId && (
            <Link
              href={`/admin/clientes/${solicitud.customerId}`}
              className="text-base font-medium text-brand-orange-dark hover:underline"
            >
              Ver ficha
            </Link>
          )}
        </div>
      </div>

      {resoluble && (
        <div className="mt-3 pl-2">
          <ResolverSolicitud
            id={solicitud.id}
            nombre={solicitud.razonSocial || solicitud.nombre}
            listas={listas}
            clienteExistente={solicitud.clienteExistente}
          />
        </div>
      )}
    </li>
  );
}

function Indicador({
  titulo,
  valor,
  detalle,
  atencion = false,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  atencion?: boolean;
}) {
  return (
    <div className={atencion ? "tarjeta-atencion p-5" : "tarjeta p-5"}>
      <p className="text-base text-muted-foreground">{titulo}</p>
      <p className="tabular mt-1 text-3xl font-semibold tracking-tight">
        {valor}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-base text-muted-foreground">
        {atencion && <Percent className="h-4 w-4 text-brand-orange" />}
        {detalle}
      </p>
    </div>
  );
}
