import type { Metadata } from "next";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { api, datos } from "@/lib/api/servidor";
import { requireStaffRole } from "@/lib/dal/session";
import { formatearMonto } from "@/lib/formato";
import { EditorDeZona } from "./editor";

export const metadata: Metadata = { title: "Envíos" };

/**
 * Zonas de envío.
 *
 * Pantalla nueva: las zonas existían en el modelo y en el carrito, pero **no
 * se podían editar desde ningún lado**. Vivían en el script de siembra, así
 * que corregir una tarifa —o marcar que una zona se cotiza aparte— exigía
 * tocar código y volver a desplegar. Para un negocio cuyo flete se mueve con
 * el combustible, eso significa tenerlo mal todo el tiempo.
 *
 * Es de administración: una tarifa de envío es un precio, y quien atiende el
 * mostrador no tiene por qué poder cambiarla.
 */
export default async function AdminEnviosPage() {
  await requireStaffRole("admin");

  // Todas, por orden y nombre (backend/internal/entregas/zonas.go).
  const zonas = datos(await (await api()).GET("/api/v1/admin/envios"));

  const aCotizar = zonas.filter((z) => z.activa && z.aCotizar).length;

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Zonas de envío"
        resumen={`${zonas.filter((z) => z.activa).length} activas${aCotizar > 0 ? ` · ${aCotizar} a cotizar` : ""}`}
      />

      {/* Una lista, y cada zona se abre al tocarla: con todas abiertas eran
          cinco formularios completos uno abajo del otro. */}
      <div className="tarjeta divide-y overflow-hidden">
        {zonas.map((zona) => (
          <details key={zona.id} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 hover:bg-muted/40">
              <span className="text-base font-semibold">
                {zona.nombre}
                {!zona.activa && <span className="ml-2 font-normal text-muted-foreground">· no se ofrece</span>}
              </span>
              <span className="tabular text-base text-muted-foreground">
                {zona.aCotizar ? "a cotizar" : formatearMonto(Number(zona.costo))}
              </span>
            </summary>
            <div className="px-5 pb-5">
            <EditorDeZona
              zona={{
                id: zona.id,
                nombre: zona.nombre,
                cobertura: zona.cobertura,
                demoraEstimada: zona.demoraEstimada,
                aCotizar: zona.aCotizar,
                costo: zona.costo,
                envioGratisDesde: zona.envioGratisDesde,
                orden: zona.orden,
                activa: zona.activa,
              }}
            />
            </div>
          </details>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-base font-semibold">Agregar una zona</h2>
        <EditorDeZona zona={null} />
      </div>
    </div>
  );
}
