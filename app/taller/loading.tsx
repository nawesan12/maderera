/**
 * La cola del taller es la del momento.
 *
 * Con Cache Components, una pantalla que se arma por pedido necesita decir qué
 * se ve mientras tanto: sin este límite, el build se niega a compilarla.
 */
export default function Cargando() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8" aria-busy="true">
      <span className="text-base text-muted-foreground">Cargando la cola del taller…</span>
    </div>
  );
}
