import type { Metadata } from "next";
import { FileText, Lock, Unlock } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { fechaCorta } from "@/lib/formato";
import {
  categoriasDeDocumentos,
  listarDocumentos,
} from "@/lib/dal/admin/documentacion";
import { SubirDocumento } from "./subir";
import { AccionesDocumento } from "./acciones";

export const metadata: Metadata = { title: "Documentación técnica" };

function peso(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Biblioteca técnica (cláusula 1.7).
 *
 * Se agrupa por quién la puede ver y no por categoría, porque esa es la
 * decisión que se toma acá: qué se publica para posicionar y qué se reserva
 * como parte del acceso profesional.
 */
export default async function DocumentacionAdminPage() {
  const [documentos, categorias] = await Promise.all([
    listarDocumentos(),
    categoriasDeDocumentos(),
  ]);

  const activos = documentos.filter((d) => d.activo);
  const reservados = activos.filter((d) => d.soloProfesionales);
  const publicos = activos.filter((d) => !d.soloProfesionales);
  const bajas = documentos.filter((d) => !d.activo);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Documentación técnica"
        detalle="Fichas, tablas de carga e instructivos. Lo que más piden los profesionales."
      />

      <SubirDocumento categorias={categorias} />

      {activos.length === 0 ? (
        <section className="tarjeta px-6 py-16 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <h2 className="mt-4 text-lg font-medium">
            Todavía no hay documentos cargados
          </h2>
          <p className="mx-auto mt-1 max-w-md text-base text-muted-foreground">
            Los que el cliente entregue en digital se suben acá y quedan
            disponibles en el portal.
          </p>
        </section>
      ) : (
        <>
          {reservados.length > 0 && (
            <Grupo
              titulo="Solo para profesionales"
              detalle="Parte del valor del acceso"
              icono={Lock}
              documentos={reservados}
              peso={peso}
            />
          )}
          {publicos.length > 0 && (
            <Grupo
              titulo="Visibles para cualquiera"
              detalle="Sirven para posicionar el sitio"
              icono={Unlock}
              documentos={publicos}
              peso={peso}
            />
          )}
        </>
      )}

      {bajas.length > 0 && (
        <section className="tarjeta">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-medium">Dados de baja</h2>
            <p className="text-base text-muted-foreground">
              El archivo sigue existiendo: un enlace roto en el pliego de otro es
              peor que un documento viejo.
            </p>
          </div>
          <ul className="divide-y">
            {bajas.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3 text-base text-muted-foreground"
              >
                <span className="line-through">{doc.titulo}</span>
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  Ver archivo
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Grupo({
  titulo,
  detalle,
  icono: Icono,
  documentos,
  peso,
}: {
  titulo: string;
  detalle: string;
  icono: React.ComponentType<{ className?: string }>;
  documentos: Awaited<ReturnType<typeof listarDocumentos>>;
  peso: (bytes: number | null) => string;
}) {
  return (
    <section className="tarjeta">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Icono className="h-5 w-5 text-muted-foreground" />
          {titulo}
        </h2>
        <p className="text-base text-muted-foreground">{detalle}</p>
      </div>

      <ul className="divide-y">
        {documentos.map((doc) => (
          <li
            key={doc.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
          >
            <div className="min-w-[16rem] flex-1">
              <a
                href={doc.url}
                target="_blank"
                rel="noreferrer"
                className="text-base font-medium hover:text-brand-orange-dark hover:underline"
              >
                {doc.titulo}
              </a>
              {doc.descripcion && (
                <p className="text-base text-muted-foreground">
                  {doc.descripcion}
                </p>
              )}
              <p className="text-base uppercase text-muted-foreground">
                {doc.categoria} · {doc.formato}
                {doc.tamanoBytes ? ` · ${peso(doc.tamanoBytes)}` : ""} ·{" "}
                {fechaCorta.format(doc.createdAt)}
              </p>
            </div>

            <AccionesDocumento
              id={doc.id}
              soloProfesionales={doc.soloProfesionales}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
