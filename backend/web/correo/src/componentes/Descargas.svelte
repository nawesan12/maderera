<script lang="ts" module>
  // La descarga en curso, abajo a la izquierda (2g). Una a la vez.
  class Bajada {
    nombre = $state("");
    progreso = $state(0); // 0..1, o -1 si el servidor no dijo el tamaño
    activa = $state(false);
  }
  export const bajada = new Bajada();
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { api, type Adjunto, type Mensaje } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import type { Ficha } from "../lib/clientes.svelte";
  import { tamano, tipoDeAdjunto } from "../lib/formato";
  import Icono from "./Icono.svelte";

  // «Descargar todo» (2g): se eligen cuáles, y se bajan juntos en un .zip.
  // El total se recalcula al marcar y desmarcar (el mock lo dejaba fijo).
  let {
    mensaje,
    archivos,
    ficha,
    oncerrar,
  }: { mensaje: Mensaje; archivos: Adjunto[]; ficha: Ficha | null; oncerrar: () => void } = $props();

  const bajables = $derived(archivos.filter((a) => !a.bloqueado));
  let elegidos = $state(new Set<number>());
  let raiz: HTMLDivElement;

  onMount(() => {
    elegidos = new Set(bajables.map((a) => a.indice));
    const fuera = (e: MouseEvent) => {
      if (!raiz.contains(e.target as Node)) oncerrar();
    };
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && oncerrar();
    const t = setTimeout(() => addEventListener("click", fuera));
    addEventListener("keydown", tecla);
    return () => {
      clearTimeout(t);
      removeEventListener("click", fuera);
      removeEventListener("keydown", tecla);
    };
  });

  const marcados = $derived(bajables.filter((a) => elegidos.has(a.indice)));
  const peso = $derived(marcados.reduce((s, a) => s + a.tamano, 0));

  function alternar(i: number) {
    const s = new Set(elegidos);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    elegidos = s;
  }

  function nombreZip(): string {
    const quien = (mensaje.de[0]?.nombre || mensaje.de[0]?.correo || "correo").toLowerCase();
    const limpio = quien
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    return `adjuntos-${limpio || "correo"}.zip`;
  }

  function guardar(blob: Blob, nombre: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombre;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function descargar() {
    if (!marcados.length) return;
    const uno = marcados.length === 1 ? marcados[0] : null;
    const url = uno ? api.urlAdjunto(bandeja.carpeta, mensaje.uid, uno.indice) : api.urlZip(bandeja.carpeta, mensaje.uid, marcados.map((a) => a.indice));
    const nombre = uno ? uno.nombre : nombreZip();
    oncerrar();
    bajada.nombre = nombre;
    bajada.progreso = 0;
    bajada.activa = true;
    try {
      const r = await fetch(url, { credentials: "same-origin" });
      if (!r.ok || !r.body) throw new Error();
      const total = Number(r.headers.get("Content-Length")) || 0;
      const lector = r.body.getReader();
      const trozos: Uint8Array[] = [];
      let llegado = 0;
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        trozos.push(value);
        llegado += value.length;
        bajada.progreso = total ? llegado / total : -1;
      }
      guardar(new Blob(trozos as BlobPart[]), nombre);
    } catch {
      bandeja.avisar(`No se pudo bajar ${nombre}. Probá de nuevo.`, undefined, true);
    } finally {
      bajada.activa = false;
    }
  }
</script>

<div class="descargas menu-flotante" bind:this={raiz} role="dialog" aria-label="Descargar adjuntos">
  <div class="cabeza">
    <strong>Descargar adjuntos</strong>
    <span>Elegí cuáles. Se bajan juntos en una carpeta comprimida.</span>
  </div>
  {#each bajables as a (a.indice)}
    {@const t = tipoDeAdjunto(a.tipo, a.nombre)}
    <button class="fila" role="checkbox" aria-checked={elegidos.has(a.indice)} onclick={() => alternar(a.indice)}>
      <span class="casilla" class:marcada={elegidos.has(a.indice)}>{#if elegidos.has(a.indice)}<Icono nombre="tilde" tamano={15} />{/if}</span>
      <span style:color={t.color} style:display="inline-flex"><Icono nombre={t.icono} tamano={22} /></span>
      <span class="nombre">{a.nombre}</span>
      <span class="peso">{tamano(a.tamano)}</span>
    </button>
  {/each}
  <div class="pie">
    <button class="boton principal ancho" disabled={!marcados.length} onclick={descargar}>
      <Icono nombre="descargar" tamano={19} />
      {#if marcados.length}
        Descargar {marcados.length === 1 ? "1 archivo" : `${marcados.length} archivos`} · {tamano(peso)}
      {:else}
        Elegí al menos uno
      {/if}
    </button>
    {#if ficha}
      <a class="boton ancho contorno" href={ficha.enlaces.ficha} target="_blank" rel="noopener">
        <Icono nombre="persona" tamano={19} />Abrir la ficha de {ficha.nombre}
      </a>
    {/if}
    <button class="enlace imprimir" onclick={() => (oncerrar(), window.print())}>
      <Icono nombre="bajar-pdf" tamano={17} />Guardar el correo entero como PDF
    </button>
  </div>
</div>

<style>
  .descargas {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    width: 460px;
    max-width: calc(100vw - 32px);
    padding: 0;
    overflow: hidden;
  }
  .cabeza {
    display: grid;
    padding: 18px 20px 10px;
  }
  .cabeza strong {
    font-size: 18px;
    font-weight: 600;
  }
  .cabeza span {
    font-size: 15px;
    color: var(--mut);
  }
  .fila {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 44px;
    padding: 10px 20px;
    border: 0;
    background: transparent;
    text-align: left;
  }
  .fila:hover {
    background: var(--sel);
  }
  .nombre {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .peso {
    font-size: 15px;
    color: var(--mut);
  }
  .pie {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 20px 18px;
    border-top: 1px solid var(--ls);
    margin-top: 6px;
  }
  .ancho {
    width: 100%;
    border-radius: 12px;
    min-height: 50px;
  }
  .contorno {
    min-height: 48px;
  }
  .imprimir {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 500;
    min-height: 40px;
  }
</style>
