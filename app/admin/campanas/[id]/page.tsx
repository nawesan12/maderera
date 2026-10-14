import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { ArrowLeft } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { obtenerCampana, fallidosDeCampana } from "@/lib/dal/admin/campanas";
import { RUBROS_CLIENTE } from "@/lib/rubros-cliente";
import { describirSegmento } from "@/lib/campanas/segmento";
import { motivoParaNoEnviar } from "@/lib/campanas/disponible";
import { armarCorreoDeCampana } from "@/lib/campanas/correo";
import { EditorDeCampana } from "../editor";
import { AccionesDeCampana, RefrescarMientrasEnvia } from "./acciones";

export const metadata: Metadata = { title: "Campaña" };

const hora = (d: Date) =>
  d.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });

export default async function CampanaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const campana = await obtenerCampana(id);
  if (!campana) notFound();

  const editable = campana.estado === "borrador" || campana.estado === "programada";
  const volver = (
    <Link href="/admin/campanas" className="mb-3 inline-flex items-center gap-1.5 text-base text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Campañas
    </Link>
  );

  if (editable) {
    return (
      <div>
        {volver}
        <EncabezadoPanel
          titulo={campana.asunto}
          detalle={
            campana.estado === "programada" && campana.programadaPara
              ? `Programada para el ${hora(campana.programadaPara)}. Si la editás, sigue programada.`
              : "Borrador: todavía no salió a nadie."
          }
        >
          <EtiquetaEstado estado={campana.estado} />
          <AccionesDeCampana id={campana.id} estado={campana.estado} />
        </EncabezadoPanel>
        <EditorDeCampana
          inicial={{
            id: campana.id,
            asunto: campana.asunto,
            adelanto: campana.adelanto ?? "",
            cuerpo: campana.cuerpo,
            imagenUrl: campana.imagenUrl ?? "",
            botonTexto: campana.botonTexto ?? "",
            botonUrl: campana.botonUrl ?? "",
            segmento: campana.segmento,
          }}
          rubros={RUBROS_CLIENTE.map((r) => ({ valor: r.valor, etiqueta: r.etiqueta }))}
          impedimento={motivoParaNoEnviar()}
        />
      </div>
    );
  }

  // Ya salió (o está saliendo): el resultado y el correo tal cual se mandó.
  const fallidos = campana.fallidos > 0 ? await fallidosDeCampana(id) : [];
  const correo = armarCorreoDeCampana(campana, { email: "cliente@ejemplo.com", nombre: "Cliente" });
  const salieron = campana.enviados + campana.fallidos + campana.omitidos;
  const avance = campana.total > 0 ? Math.round((salieron / campana.total) * 100) : 0;

  return (
    <div>
      {volver}
      {campana.estado === "enviando" && <RefrescarMientrasEnvia />}
      <EncabezadoPanel titulo={campana.asunto} detalle={describirSegmento(campana.segmento)}>
        <EtiquetaEstado estado={campana.estado === "enviada" ? "campana_enviada" : campana.estado} />
        <AccionesDeCampana id={campana.id} estado={campana.estado} />
      </EncabezadoPanel>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <section className="tarjeta p-5">
            <div className="h-3 overflow-hidden rounded-full bg-hundida" aria-hidden="true">
              <div className="h-full rounded-full bg-brand-orange transition-[width]" style={{ width: `${avance}%` }} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  ["Enviados", campana.enviados],
                  ["Por salir", campana.pendientes],
                  ["No salieron", campana.fallidos],
                  ["Omitidos", campana.omitidos],
                ] as const
              ).map(([etiqueta, valor]) => (
                <div key={etiqueta}>
                  <dt className="text-sm text-muted-foreground">{etiqueta}</dt>
                  <dd className="tabular text-2xl font-semibold">{valor}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-muted-foreground">
              {campana.iniciadaAt && `Empezó el ${hora(campana.iniciadaAt)}`}
              {campana.terminadaAt && ` · terminó el ${hora(campana.terminadaAt)}`}
              {campana.creadaPorNombre && ` · armada por ${campana.creadaPorNombre}`}
              {campana.omitidos > 0 && ". Omitidos: se dieron de baja antes de su turno, o se canceló el envío."}
            </p>
          </section>

          {fallidos.length > 0 && (
            <section className="tarjeta">
              <h2 className="border-b px-5 py-3 text-base font-medium">Los que no salieron</h2>
              <ul className="divide-y">
                {fallidos.map((f) => (
                  <li key={f.email} className="px-5 py-3">
                    <p className="text-base">{f.nombre ? `${f.nombre} · ` : ""}{f.email}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{f.error}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside className="tarjeta overflow-hidden lg:self-start">
          <p className="border-b px-4 py-2.5 text-sm text-muted-foreground">El correo que salió</p>
          <iframe title="El correo enviado" srcDoc={correo.html} sandbox="" className="h-[70vh] w-full bg-white" />
        </aside>
      </div>
    </div>
  );
}
