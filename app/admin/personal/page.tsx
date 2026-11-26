import type { Metadata } from "next";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { api, datos } from "@/lib/api/servidor";
import { requireStaff } from "@/lib/dal/session";
import { plural } from "@/components/admin/formato";
import { FilaDePersona, FormularioDeAlta } from "./editor";

export const metadata: Metadata = { title: "Personal" };

/**
 * Quién entra al panel y con qué puesto (mes simulado, H006).
 *
 * La guía de primeros pasos dice que cada uno entra «con el correo y la
 * contraseña que le dio administración», y administración no tenía dónde
 * dársela: el alta se hacía desde la terminal. Es una lista corta —una
 * maderera tiene diez personas, no cien—, así que va en renglones, con el
 * puesto a mano en cada uno, y el alta abajo.
 *
 * El acceso lo da `ACCESO` (solo admin), como cualquier pantalla del panel.
 */
export default async function PersonalPage() {
  const [sesion, personal] = await Promise.all([
    requireStaff(),
    (await api()).GET("/api/v1/admin/personal").then(datos),
  ]);

  return (
    <div className="space-y-6">
      <EncabezadoPanel titulo="Personal" resumen={plural(personal.length, "persona")} />

      <section className="tarjeta overflow-hidden">
        <ul className="divide-y divide-linea-suave">
          {personal.map((p) => (
            <FilaDePersona key={p.id} persona={p} esVos={p.id === sesion.userId} />
          ))}
        </ul>
      </section>

      <section id="alta" className="space-y-3">
        <h2 className="text-[19px] font-bold tracking-tight">Dar de alta</h2>
        <FormularioDeAlta />
      </section>
    </div>
  );
}
