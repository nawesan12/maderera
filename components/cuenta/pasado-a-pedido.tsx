/**
 * El estado de un presupuesto que ya se pasó a pedido. Decía «Aceptado»
 * aunque lo hubiera pasado el vendedor sin respuesta del cliente (mes
 * simulado, M3S1-045). La misma familia que «Aceptado».
 */
export function PasadoAPedido() {
  return (
    <span className="estado-ok inline-flex shrink-0 items-center rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium text-[var(--estado-tinta)]">
      Pasado a pedido
    </span>
  );
}
