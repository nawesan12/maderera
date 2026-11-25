<script lang="ts">
  import { api, type Mensaje } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import Icono from "./Icono.svelte";

  // Pedido de presupuesto en un clic: los renglones que el texto pide
  // («14 placas de melamina blanca»), con el producto del catálogo y su
  // precio en la lista del cliente. El presupuesto se arma en el panel: el
  // correo lo abre con el cliente elegido y deja copiar los renglones.
  let { mensaje, nombre }: { mensaje: Mensaje; nombre?: string } = $props();

  interface Producto {
    id: string;
    nombre: string;
    unidad: string;
    precio?: string;
    enlace: string;
  }
  interface Renglon {
    texto: string;
    cantidad: number;
    buscado: string;
    producto?: Producto;
    alternativas: Producto[];
  }
  let propuesta = $state<{ renglones: Renglon[]; lista?: string; abrir: string } | null>(null);
  let abierto = $state(false);
  let elegidos = $state<Record<number, number>>({});

  $effect(() => {
    const m = mensaje;
    propuesta = null;
    elegidos = {};
    void api
      .presupuesto(`${m.asunto}\n${m.texto}`, m.de[0]?.correo ?? "")
      .then((p) => {
        if (bandeja.abierto?.uid === m.uid) propuesta = p;
      })
      .catch(() => {});
  });

  const encontrados = $derived((propuesta?.renglones ?? []).filter((r) => r.producto));

  function producto(r: Renglon, i: number): Producto {
    const j = elegidos[i] ?? -1;
    return j < 0 ? r.producto! : r.alternativas[j];
  }

  const pesos = (n: number) => "$ " + n.toLocaleString("es-AR", { maximumFractionDigits: 2 });
  const total = $derived(
    encontrados.reduce((s, r, i) => {
      const p = producto(r, i);
      return s + (p.precio ? Number(p.precio) * r.cantidad : 0);
    }, 0),
  );

  async function copiar() {
    const lineas = encontrados.map((r, i) => {
      const p = producto(r, i);
      return `${r.cantidad}\t${p.nombre}${p.precio ? `\t${pesos(Number(p.precio))}` : ""}`;
    });
    try {
      await navigator.clipboard.writeText(lineas.join("\n"));
      bandeja.avisar("Renglones copiados: pegalos en el presupuesto");
    } catch {
      bandeja.avisar("No se pudo copiar.", undefined, true);
    }
  }
</script>

{#if encontrados.length}
  <section class="pedido" aria-label="Lo que pide">
    <button class="cabeza" aria-expanded={abierto} onclick={() => (abierto = !abierto)}>
      <Icono nombre="presupuesto" tamano={20} />
      <span class="que">
        <strong>Pide {encontrados.length === 1 ? "1 producto" : `${encontrados.length} productos`} del catálogo</strong>
        <span>{encontrados.map((r) => `${r.cantidad} ${r.producto?.nombre.split(" ").slice(0, 2).join(" ").toLowerCase()}`).join(" · ")}</span>
      </span>
      {#if total}<span class="total mono">{pesos(total)}</span>{/if}
      <Icono nombre={abierto ? "flecha-arriba" : "flecha-abajo"} tamano={18} />
    </button>
    {#if abierto}
      <div class="renglones">
        {#each encontrados as r, i (r.buscado)}
          {@const p = producto(r, i)}
          <div class="renglon">
            <span class="cant mono">{r.cantidad}</span>
            <div class="prod">
              <a href={p.enlace} target="_blank" rel="noopener">{p.nombre}</a>
              <small>Pidió «{r.texto}»</small>
              {#if r.alternativas.length}
                <select aria-label="Otro producto para «{r.texto}»" value={elegidos[i] ?? -1} onchange={(e) => (elegidos = { ...elegidos, [i]: Number((e.target as HTMLSelectElement).value) })}>
                  <option value={-1}>{r.producto?.nombre}</option>
                  {#each r.alternativas as a, j (a.id)}<option value={j}>{a.nombre}</option>{/each}
                </select>
              {/if}
            </div>
            <span class="precio mono">{p.precio ? pesos(Number(p.precio) * r.cantidad) : "sin precio"}</span>
          </div>
        {/each}
        <p class="nota">Precios «desde»{propuesta?.lista ? ` de la ${propuesta.lista}` : ""}, con IVA. El presupuesto se arma en el panel.</p>
        <div class="botones">
          <a class="boton principal" href={propuesta?.abrir} target="_blank" rel="noopener"><Icono nombre="presupuesto" tamano={18} />Hacer el presupuesto{nombre ? ` para ${nombre}` : ""}</a>
          <button class="boton" onclick={copiar}><Icono nombre="respuestas" tamano={18} />Copiar renglones</button>
        </div>
      </div>
    {/if}
  </section>
{/if}

<style>
  .pedido {
    max-width: 760px;
    border-radius: 12px;
    box-shadow: inset 0 0 0 1px var(--ls);
    background: var(--cli);
  }
  .cabeza {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 56px;
    padding: 8px 14px;
    border: 0;
    background: transparent;
    text-align: left;
    color: var(--fg);
  }
  .cabeza > :global(svg:first-child) {
    color: var(--marT);
    flex: none;
  }
  .que {
    flex: 1;
    min-width: 0;
    display: grid;
    line-height: 1.35;
  }
  .que strong {
    font-size: 16px;
    font-weight: 600;
  }
  .que span {
    font-size: 14px;
    color: var(--mut);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .total {
    font-size: 16px;
    font-weight: 600;
  }
  .renglones {
    padding: 4px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .renglon {
    display: grid;
    grid-template-columns: 48px 1fr auto;
    gap: 12px;
    align-items: start;
    padding: 10px 0;
    border-top: 1px solid var(--ls);
  }
  .cant {
    font-size: 17px;
    font-weight: 600;
    text-align: right;
  }
  .prod {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .prod a {
    color: var(--fg);
    font-weight: 500;
    text-decoration: none;
  }
  .prod a:hover {
    text-decoration: underline;
  }
  .prod small {
    font-size: 14px;
    color: var(--mut);
  }
  select {
    margin-top: 4px;
    min-height: 36px;
    border: 1px solid var(--ln);
    border-radius: 8px;
    background: var(--card);
    font-size: 14px;
    max-width: 100%;
  }
  .precio {
    font-size: 15px;
  }
  .nota {
    margin: 0;
    font-size: 14px;
    color: var(--mut);
  }
  .botones {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
</style>
