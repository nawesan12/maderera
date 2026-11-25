<script lang="ts">
  import { api, type EstadoHilo, type Mensaje, type Nota } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import { equipo, familiaEstado, nombresEstado } from "../lib/equipo.svelte";
  import Icono from "./Icono.svelte";

  // La conversación en la casilla compartida: quién la tiene, en qué está y
  // las notas internas (el cliente nunca las ve: no salen en ningún correo).
  let { mensaje }: { mensaje: Mensaje } = $props();

  const hilo = $derived(mensaje.hilo || mensaje.messageId || "");
  const estado = $derived(equipo.hilos[hilo]);
  const datos = $derived({ hilo, asunto: mensaje.asunto, remitente: mensaje.de[0]?.correo ?? "", recibido: mensaje.fecha });

  let verNotas = $state(false);
  let notas = $state<Nota[] | null>(null);
  let texto = $state("");
  let guardando = $state(false);
  let menuDueno = $state(false);

  $effect(() => {
    if (hilo) void equipo.conocer([hilo]);
    notas = null;
    verNotas = false;
  });

  $effect(() => {
    if (verNotas && notas === null && hilo) {
      void api
        .notas(hilo)
        .then((n) => (notas = n))
        .catch(() => (notas = []));
    }
  });

  const estados: EstadoHilo["estado"][] = ["nuevo", "en-curso", "esperando", "resuelto"];

  function asignar(id: string) {
    menuDueno = false;
    void equipo.guardar(id ? { ...datos, asignadoA: id, estado: estado?.estado === "nuevo" || !estado ? "en-curso" : undefined } : { ...datos, soltar: true });
  }

  async function anotar(e: SubmitEvent) {
    e.preventDefault();
    if (!texto.trim()) return;
    guardando = true;
    try {
      const n = await api.crearNota({ ...datos, autorId: equipo.yo, texto });
      notas = [...(notas ?? []), n];
      texto = "";
      const h = equipo.hilos[hilo];
      equipo.hilos = { ...equipo.hilos, [hilo]: { ...(h ?? { hilo, estado: "nuevo", asignadoA: "", asignadoNombre: "" }), notas: (h?.notas ?? 0) + 1 } };
    } catch (err) {
      bandeja.avisar(err instanceof Error ? err.message : "No se pudo guardar la nota.", undefined, true);
    } finally {
      guardando = false;
    }
  }

  async function borrar(id: string) {
    notas = (notas ?? []).filter((n) => n.id !== id);
    const h = equipo.hilos[hilo];
    if (h) equipo.hilos = { ...equipo.hilos, [hilo]: { ...h, notas: Math.max(0, h.notas - 1) } };
    await api.borrarNota(id).catch(() => {});
  }

  const cuando = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
</script>

{#if hilo}
  <section class="conversacion" aria-label="La conversación en el equipo">
    <div class="fila">
      <div class="con-menu">
        <button class="dueno" aria-expanded={menuDueno} onclick={() => (menuDueno = !menuDueno)}>
          <Icono nombre="persona" tamano={17} />
          {#if estado?.asignadoA}
            <span>Lo tiene <strong>{estado.asignadoA === equipo.yo ? "vos" : estado.asignadoNombre}</strong></span>
          {:else}
            <span>Sin dueño</span>
          {/if}
          <Icono nombre="flecha-abajo" tamano={15} />
        </button>
        {#if menuDueno}
          <div class="menu-dueno menu-flotante">
            {#if equipo.yo && estado?.asignadoA !== equipo.yo}
              <button class="item-menu fuerte" onclick={() => asignar(equipo.yo)}><Icono nombre="tilde" />Me lo quedo</button>
            {/if}
            {#each equipo.personas.filter((p) => p.id !== equipo.yo) as p (p.id)}
              <button class="item-menu" onclick={() => asignar(p.id)}><Icono nombre="persona" />Pasárselo a {p.nombre}</button>
            {/each}
            {#if estado?.asignadoA}
              <button class="item-menu" onclick={() => asignar("")}><Icono nombre="cerrar" />Dejarlo sin dueño</button>
            {/if}
          </div>
        {/if}
      </div>
      <div class="estados" role="radiogroup" aria-label="Estado de la conversación">
        {#each estados as e (e)}
          <button
            role="radio"
            aria-checked={(estado?.estado ?? "nuevo") === e}
            class="estado chip {(estado?.estado ?? 'nuevo') === e ? familiaEstado[e] : 'apagado'}"
            onclick={() => equipo.guardar({ ...datos, estado: e })}>{nombresEstado[e]}</button
          >
        {/each}
      </div>
      <button class="notas-b" class:abierto={verNotas} aria-expanded={verNotas} onclick={() => (verNotas = !verNotas)}>
        <Icono nombre="respuestas" tamano={17} />Notas{#if estado?.notas}<span class="contador">{estado.notas}</span>{/if}
      </button>
    </div>

    {#if verNotas}
      <div class="notas">
        <p class="aclara"><Icono nombre="candado" tamano={14} />Solo las ve el equipo. No salen en ningún correo.</p>
        {#if notas === null}
          <div class="esqueleto" style:height="14px" style:width="60%"></div>
        {:else}
          {#each notas as n (n.id)}
            <div class="nota">
              <div class="quien"><strong>{n.autor}</strong><span>{cuando.format(new Date(n.createdAt)).replace(".", "")}</span>
                <button class="icono chico" aria-label="Borrar la nota" title="Borrar" onclick={() => borrar(n.id)}><Icono nombre="cerrar" tamano={14} /></button>
              </div>
              <p>{n.texto}</p>
            </div>
          {/each}
        {/if}
        <form onsubmit={anotar}>
          <textarea class="campo" rows="2" placeholder="Dejá una nota para el equipo (por ejemplo: «ya le pasé el precio por WhatsApp»)" bind:value={texto}
            onkeydown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit()}></textarea>
          <button class="boton" disabled={guardando || !texto.trim()}>Guardar nota</button>
        </form>
      </div>
    {/if}
  </section>
{/if}

<style>
  .conversacion {
    border-radius: 12px;
    background: var(--hun);
    padding: 6px 8px;
  }
  .fila {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px 10px;
  }
  .con-menu {
    position: relative;
  }
  .dueno,
  .notas-b {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 10px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    font-size: 15px;
    color: var(--fg);
  }
  .dueno :global(svg),
  .notas-b :global(svg) {
    color: var(--mut);
  }
  .dueno:hover,
  .notas-b:hover,
  .notas-b.abierto {
    background: var(--card);
  }
  .menu-dueno {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 280px;
  }
  .fuerte {
    font-weight: 600;
  }
  .estados {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .estado {
    border: 0;
    min-height: 32px;
    line-height: 32px;
    padding: 0 12px;
    cursor: pointer;
  }
  .estado.apagado {
    background: transparent;
    color: var(--mut);
    box-shadow: inset 0 0 0 1px var(--ls);
  }
  .estado.apagado:hover {
    color: var(--fg);
    box-shadow: inset 0 0 0 1px var(--ln);
  }
  .notas-b {
    margin-left: auto;
  }
  .notas {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 10px 6px 6px;
  }
  .aclara {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    font-size: 14px;
    color: var(--mut);
  }
  .nota {
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--card);
    box-shadow: inset 3px 0 0 var(--espT);
  }
  .nota .quien {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    color: var(--mut);
  }
  .nota strong {
    color: var(--fg);
    font-weight: 600;
  }
  .nota p {
    margin: 2px 0 0;
    font-size: 16px;
    white-space: pre-wrap;
  }
  .icono.chico {
    width: 30px;
    height: 30px;
    margin-left: auto;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  form .campo {
    min-height: 0;
    font-size: 16px;
  }
</style>
