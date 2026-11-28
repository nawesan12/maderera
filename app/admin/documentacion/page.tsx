import type { Metadata } from "next";
import { FileText, FileWarning, Lock, Unlock } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { fechaCorta, formatearPeso } from "@/lib/formato";
import {
  categoriasDeDocumentos,
  listarDocumentos,
} from "@/lib/dal/admin/documentacion";
import { SubirDocumento } from "./subir";
import { AccionesDocumento, RestaurarDocumento, SubirArchivoDocumento } from "./acciones";
import { DestinosDocumento } from "./destinos";
import { listarCategorias } from "@/lib/dal/catalog";

export const metadata: Metadata = { title: "Documentación técnica" };

const peso = formatearPeso;

/**
 * Biblioteca técnica (cláusula 1.7).
 *
 * Se agrupa por quién la puede ver y no por categoría, porque esa es la
 * decisión que se toma acá: qué se publica para posicionar y qué se reserva
 * como parte del acceso profesional.
 */
export default async function DocumentacionAdminPage() {
  const [documentos, categorias, delCatalogo] = await Promise.all([
    listarDocumentos(),
    categoriasDeDocumentos(),
    listarCategorias(),
  ]);
  const todasLasCategorias = delCatalogo.map((c) => ({ id: c.id, nombre: c.name }));

  const activos = documentos.filter((d) => d.activo);
  // Sin archivo el sitio no lo muestra: figuraba entre los públicos mientras
  // /documentacion decía que no había nada (recorrido, M4-052).
  const sinArchivo = activos.filter((d) => !d.tamanoBytes);
  const conArchivo = activos.filter((d) => d.tamanoBytes);
  const reservados = conArchivo.filter((d) => d.soloProfesionales);
  const publicos = conArchivo.filter((d) => !d.soloProfesionales);
  const bajas = documentos.filter((d) => !d.activo);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Documentación técnica"
      />

      <SubirDocumento categorias={categorias} />

      {activos.length === 0 ? (
        <section className="tarjeta px-6 py-16 text-center">
          <FileText className="mx-auto h-10 w-10 text-muted-foreground/60" />
          <h2 className="mt-4 text-lg font-medium">
            Todavía no hay documentos cargados
          </h2>
        </section>
      ) : (
        <>
          {sinArchivo.length > 0 && (
            <Grupo
              titulo="Falta el archivo"
              icono={FileWarning}
              documentos={sinArchivo}
              peso={peso}
              todasLasCategorias={todasLasCategorias}
            />
          )}
          {reservados.length > 0 && (
            <Grupo
              titulo="Solo para profesionales"
              // Parte del valor del acceso.
              icono={Lock}
              documentos={reservados}
              peso={peso}
              todasLasCategorias={todasLasCategorias}
            />
          )}
          {publicos.length > 0 && (
            <Grupo
              titulo="Visibles para cualquiera"
              // Sirven para posicionar el sitio.
              icono={Unlock}
              documentos={publicos}
              peso={peso}
              todasLasCategorias={todasLasCategorias}
            />
          )}
        </>
      )}

      {bajas.length > 0 && (
        <section className="tarjeta">
          <div className="border-b px-5 py-4">
            <h2 className="text-base font-medium">Dados de baja</h2>
          </div>
          <ul className="divide-y">
            {bajas.map((doc) => (
              <li
                key={doc.id}
                className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3 text-base text-muted-foreground"
              >
                <span className="line-through">{doc.titulo}</span>
                <span className="flex items-center gap-3">
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:underline"
                  >
                    Ver archivo
                  </a>
                  <RestaurarDocumento id={doc.id} />
                </span>
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
  icono: Icono,
  documentos,
  peso,
  todasLasCategorias,
}: {
  titulo: string;
  icono: React.ComponentType<{ className?: string }>;
  documentos: Awaited<ReturnType<typeof listarDocumentos>>;
  peso: (bytes: number | null) => string;
  todasLasCategorias: { id: string; nombre: string }[];
}) {
  return (
    <section className="tarjeta">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Icono className="h-5 w-5 text-muted-foreground" />
          {titulo}
        </h2>
      </div>

      <ul className="divide-y">
        {documentos.map((doc) => (
          <li
            key={doc.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
          >
            <div className="min-w-[16rem] flex-1">
              {doc.tamanoBytes ? (
                <a
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-base font-medium hover:text-brand-orange-dark hover:underline"
                >
                  {doc.titulo}
                </a>
              ) : (
                <p className="text-base font-medium">{doc.titulo}</p>
              )}
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

            <DestinosDocumento
              key={`${doc.id}:${doc.productos.map((p) => p.id).join(",")}:${doc.categorias.map((c) => c.id).join(",")}`}
              id={doc.id}
              titulo={doc.titulo}
              productos={doc.productos}
              categorias={doc.categorias}
              todasLasCategorias={todasLasCategorias}
            />
            {!doc.tamanoBytes && <SubirArchivoDocumento id={doc.id} />}
            <AccionesDocumento
              id={doc.id}
              titulo={doc.titulo}
              soloProfesionales={doc.soloProfesionales}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
