import { EncabezadoPanel } from "@/components/admin/encabezado";
import { parametrosDeCalculo } from "@/lib/dal/calculadora-parametros";
import { requireStaff } from "@/lib/dal/session";
import { FormularioParametros } from "./formulario";

export const metadata = { title: "Calculadoras" };

/**
 * Los parámetros de las calculadoras de materiales.
 *
 * Eran constantes en el código. Tres de ellas el brief no las contestó y
 * quedaron anotadas como insumo pendiente esperando que la clienta las diera;
 * traerlas acá cierra ese pendiente sin depender de un despliegue.
 *
 * Las fórmulas siguen siendo funciones puras con tests: lo que cambia es de
 * dónde salen los números que reciben.
 */
export default async function CalculadorasPage() {
  // La página está detrás del panel, pero la sesión se pide igual: el DAL de
  // parámetros es público —lo usa la calculadora del sitio— y no la exige.
  await requireStaff();

  const parametros = await parametrosDeCalculo();

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Calculadoras"
        detalle="Con qué números calculan las cuatro calculadoras del sitio."
      />

      <FormularioParametros parametros={parametros} />
    </div>
  );
}
