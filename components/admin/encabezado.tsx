/**
 * Encabezado de las pantallas del panel.
 *
 * Un solo lugar donde viven el título y la acción principal, para que todas
 * las secciones se lean igual y el ojo sepa siempre dónde mirar.
 *
 * **Sin bajada** (9/11/2026). Tenía una línea debajo del título que explicaba
 * para qué servía la pantalla; Nahuel: «el panel está lleno de "esto hace tal
 * cosa"». El porqué va en el código, no en la pantalla. Lo que sí queda es
 * `resumen`: los números de la pantalla, que son datos y no una explicación.
 */
export function EncabezadoPanel({
  titulo,
  resumen,
  children,
}: {
  titulo: string;
  /** Datos de la pantalla, no una explicación: «12 clientes · $ 1.200.000 por cobrar». */
  resumen?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {resumen && <p className="tabular mt-0.5 text-base text-muted-foreground">{resumen}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}
