<script lang="ts">
  import { bandeja } from "../lib/estado.svelte";
  import { preferencias, type Densidad, type Tema } from "../lib/preferencias.svelte";
  import Icono, { type NombreIcono } from "./Icono.svelte";

  // Los ajustes (2e), por ahora los que viven en este navegador: cómo se ve
  // y con qué nombre y firma sale la casilla. La respuesta automática, las
  // reglas y las casillas necesitan ManageSieve y el panel de casillas:
  // quedan para después (docs/go/progreso.md).
  let { onatajos }: { onatajos: () => void } = $props();

  type Seccion = "apariencia" | "firma";
  let seccion = $state<Seccion>("apariencia");
  const casilla = bandeja.correo ?? "";
  const guardado = preferencias.remitente(casilla);
  let nombre = $state(guardado.nombre);
  let firma = $state(guardado.firma);
  let listo = $state(false);

  const nav: [Seccion, string, NombreIcono][] = [
    ["apariencia", "Cómo se ve", "sol"],
    ["firma", "Nombre y firma", "firma"],
  ];
  const temas: [Tema, string][] = [
    ["sistema", "Como el sistema"],
    ["claro", "Claro"],
    ["oscuro", "Oscuro"],
  ];
  const densidades: [Densidad, string, string][] = [
    ["comoda", "Cómoda", "Más aire entre filas"],
    ["media", "Media", ""],
    ["compacta", "Compacta", "Entran más correos"],
  ];

  function guardar(e: SubmitEvent) {
    e.preventDefault();
    preferencias.guardarRemitente(casilla, { nombre, firma });
    listo = true;
    setTimeout(() => (listo = false), 2500);
  }
</script>

<div class="ajustes">
  <nav aria-label="Ajustes">
    <button class="volver" onclick={() => (bandeja.ajustesAbiertos = false)}><Icono nombre="atras" tamano={20} />Volver al correo</button>
    <h1>Ajustes</h1>
    {#each nav as [id, nombre, icono] (id)}
      <button class="item" class:actual={seccion === id} onclick={() => (seccion = id)}><Icono nombre={icono} tamano={20} />{nombre}</button>
    {/each}
    <button class="item" onclick={onatajos}><Icono nombre="teclado" tamano={20} />Atajos de teclado</button>
  </nav>

  <div class="contenido">
    {#if seccion === "apariencia"}
      <section>
        <h2>Tema</h2>
        <p>Claro, oscuro o el mismo que tiene la computadora o el teléfono.</p>
        <div class="opciones" role="radiogroup" aria-label="Tema">
          {#each temas as [id, n] (id)}
            <button role="radio" aria-checked={preferencias.tema === id} class="opcion" class:on={preferencias.tema === id} onclick={() => preferencias.ponerTema(id)}>{n}</button>
          {/each}
        </div>
      </section>
      <div class="linea"></div>
      <section>
        <h2>Densidad de la lista</h2>
        <p>Cuánto espacio hay entre un correo y otro.</p>
        <div class="opciones" role="radiogroup" aria-label="Densidad">
          {#each densidades as [id, n, d] (id)}
            <button role="radio" aria-checked={preferencias.densidad === id} class="opcion" class:on={preferencias.densidad === id} onclick={() => preferencias.ponerDensidad(id)}>
              {n}{#if d}<small>{d}</small>{/if}
            </button>
          {/each}
        </div>
      </section>
    {:else}
      <form onsubmit={guardar}>
        <section>
          <h2>Nombre y firma</h2>
          <p>Con qué nombre llegan tus correos y qué va al final de cada uno. Es de esta casilla ({casilla}) y de este navegador.</p>
          <label>
            <span>Nombre con que sale</span>
            <input class="campo" bind:value={nombre} placeholder="Diego Ramírez · Ventas" maxlength="80" />
          </label>
          <label>
            <span>Firma</span>
            <textarea class="campo" rows="5" bind:value={firma} placeholder={"Diego Ramírez · Ventas\nMaderera Juan B. Justo · Casa Central\nAv. Juan B. Justo 4153, Mar del Plata · (0223) 474-3328"}></textarea>
          </label>
        </section>
        {#if firma.trim()}
          <section>
            <h3>Así la recibe el cliente</h3>
            <div class="vista">
              <img src="/logo.png" alt="" width="64" height="64" />
              <div>{#each firma.trim().split("\n") as l, i (i)}<div class:primera={i === 0}>{l}</div>{/each}</div>
            </div>
          </section>
        {/if}
        <div class="acciones">
          <button class="boton principal">Guardar</button>
          {#if listo}<span class="ok" role="status"><Icono nombre="tilde" tamano={18} />Guardado</span>{/if}
        </div>
      </form>
    {/if}
  </div>
</div>

<style>
  .ajustes {
    flex: 1;
    min-width: 0;
    display: flex;
    margin: 0 16px 16px 0;
  }
  nav {
    width: 256px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 12px 16px 0;
  }
  .volver {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    height: 44px;
    padding: 0 16px 0 10px;
    border: 0;
    border-radius: 10px;
    background: var(--side-act);
    font-size: 17px;
    font-weight: 500;
    align-self: flex-start;
    margin-bottom: 8px;
  }
  h1 {
    margin: 0;
    padding: 6px 14px 10px;
    font-size: 24px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 46px;
    padding: 0 14px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    font-size: 16px;
    text-align: left;
  }
  .item:hover {
    background: var(--sel);
  }
  .item.actual {
    background: var(--side-act);
    color: var(--accT);
    font-weight: 600;
  }
  .contenido {
    flex: 1;
    min-width: 0;
    background-color: var(--card);
    background-image: var(--texC);
    background-size: 180px 180px;
    border-radius: 14px;
    box-shadow: var(--sh);
    overflow-y: auto;
    padding: 36px 48px;
  }
  section,
  form {
    max-width: 820px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  form {
    gap: 28px;
  }
  h2 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
  }
  h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
  }
  p {
    margin: -10px 0 0;
    font-size: 16px;
    color: var(--mut);
  }
  .linea {
    height: 1px;
    background: var(--ls);
    max-width: 820px;
    margin: 28px 0;
  }
  .opciones {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .opcion {
    display: inline-flex;
    flex-direction: column;
    justify-content: center;
    min-height: 44px;
    padding: 6px 18px;
    border: 1px solid var(--ln);
    border-radius: 999px;
    background: transparent;
    font-size: 16px;
    font-weight: 500;
    line-height: 1.25;
  }
  .opcion small {
    font-size: 13px;
    font-weight: 400;
    color: var(--mut);
  }
  .opcion.on {
    background: var(--acc);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }
  .opcion.on small {
    color: oklch(1 0 0 / 0.8);
  }
  label {
    display: grid;
    gap: 6px;
  }
  label span {
    font-size: 15px;
    color: var(--mut);
  }
  .vista {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    padding: 20px 22px;
    border: 1px solid var(--ln);
    border-radius: 14px;
    font-size: 16px;
    line-height: 1.55;
    color: var(--mut);
  }
  .vista img {
    border-radius: 12px;
    flex: none;
  }
  .vista .primera {
    font-size: 18px;
    font-weight: 600;
    color: var(--fg);
  }
  .acciones {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .acciones .boton {
    min-height: 48px;
    padding: 0 26px;
  }
  .ok {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--okT);
    font-weight: 600;
  }
  @media (max-width: 1080px) {
    .ajustes {
      margin-left: 16px;
    }
  }
  @media (max-width: 720px) {
    .ajustes {
      margin: 0;
      flex-direction: column;
      overflow-y: auto;
    }
    nav {
      width: auto;
      padding: 0 16px 8px;
    }
    .contenido {
      border-radius: 0;
      box-shadow: none;
      padding: 20px 16px 40px;
      overflow: visible;
    }
  }
</style>
