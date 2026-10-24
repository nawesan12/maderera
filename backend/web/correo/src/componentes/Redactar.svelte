<script lang="ts">
  import { onMount } from "svelte";
  import { api, ErrorApi, type Direccion } from "../lib/api";
  import { bandeja } from "../lib/estado.svelte";
  import { direccionCompleta, fechaLarga, nombreDe, tamano } from "../lib/formato";
  import Icono from "./Icono.svelte";

  const TOPE = 18 * 1024 * 1024;
  const r = bandeja.redaccion!;
  const base = r.base;
  const yo = (bandeja.correo ?? "").toLowerCase();

  // El nombre con que sale y la firma, por casilla, en este navegador.
  const claveAjustes = `correo:ajustes:${yo}`;
  const ajustes: { nombre: string; firma: string } = (() => {
    try {
      return { nombre: "", firma: "", ...JSON.parse(localStorage.getItem(claveAjustes) ?? "{}") };
    } catch {
      return { nombre: "", firma: "" };
    }
  })();

  const lista = (ds: Direccion[]) => ds.map(direccionCompleta).join(", ");
  const sinMi = (ds: Direccion[]) => ds.filter((d) => d.correo.toLowerCase() !== yo);
  const firma = ajustes.firma ? `\n\n-- \n${ajustes.firma}` : "";

  function citar(texto: string) {
    return texto
      .split("\n")
      .map((l) => (l.startsWith(">") ? ">" + l : "> " + l))
      .join("\n");
  }

  function prefijo(asunto: string, p: string) {
    return new RegExp(`^(${p}|re|rv|fwd?):`, "i").test(asunto.trim()) ? asunto : `${p}: ${asunto}`;
  }

  let para = $state("");
  let cc = $state("");
  let cco = $state("");
  let asunto = $state("");
  let texto = $state(firma);
  let verCopias = $state(false);
  let archivos = $state<File[]>([]);
  let enviando = $state(false);
  let errores = $state<Record<string, string>>({});
  let general = $state("");
  let descartar = $state(false);
  let nombre = $state(ajustes.nombre);
  let editarRemitente = $state(false);
  let firmaEditable = $state(ajustes.firma);
  let arrastrando = $state(false);

  if (base) {
    const remitente = base.responderA.length ? base.responderA : base.de;
    const encabezado = `\n\nEl ${fechaLarga(base.fecha)}, ${nombreDe(base.de[0])} escribió:\n`;
    if (r.modo === "responder") {
      para = lista(remitente);
      asunto = prefijo(base.asunto, "Re");
      texto = firma + encabezado + citar(base.texto);
    } else if (r.modo === "responder-todos") {
      para = lista(sinMi([...remitente, ...base.para]));
      const copia = lista(sinMi(base.cc));
      cc = copia;
      verCopias = !!copia;
      asunto = prefijo(base.asunto, "Re");
      texto = firma + encabezado + citar(base.texto);
    } else if (r.modo === "reenviar") {
      asunto = prefijo(base.asunto, "Rv");
      texto =
        firma +
        "\n\n---------- Mensaje reenviado ----------\n" +
        `De: ${lista(base.de)}\nFecha: ${fechaLarga(base.fecha)}\nAsunto: ${base.asunto}\nPara: ${lista(base.para)}\n\n` +
        base.texto;
    }
  }

  const pesoTotal = $derived(archivos.reduce((s, f) => s + f.size, 0));
  const titulo = { nuevo: "Mensaje nuevo", responder: "Responder", "responder-todos": "Responder a todos", reenviar: "Reenviar" }[r.modo];
  const conContenido = $derived(!!(para || asunto || archivos.length || texto.trim() !== firma.trim()));

  let campoTexto: HTMLTextAreaElement;
  let campoPara: HTMLInputElement;

  onMount(() => {
    // Al responder, se escribe arriba de la cita; en uno nuevo, primero el destinatario.
    if (r.modo === "responder" || r.modo === "responder-todos") {
      campoTexto.focus();
      campoTexto.setSelectionRange(0, 0);
      campoTexto.scrollTop = 0;
    } else campoPara.focus();

    // Reenviar lleva los adjuntos del original: se bajan y se vuelven a subir.
    if (r.modo === "reenviar" && base?.adjuntos.length) {
      void Promise.all(
        base.adjuntos.map(async (a) => {
          const resp = await fetch(api.urlAdjunto(r.carpeta ?? bandeja.carpeta, base.uid, a.indice));
          if (!resp.ok) throw new Error();
          return new File([await resp.blob()], a.nombre, { type: a.tipo });
        }),
      )
        .then((fs) => (archivos = [...fs, ...archivos]))
        .catch(() => (general = "No se pudieron traer los adjuntos del original."));
    }
  });

  function sumar(lista: FileList | null) {
    if (!lista) return;
    archivos = [...archivos, ...lista];
  }

  async function enviar() {
    errores = {};
    general = "";
    if (pesoTotal > TOPE) {
      errores = { adjuntos: "Los adjuntos pasan los 18 MB. Mandalos en dos correos." };
      return;
    }
    enviando = true;
    const f = new FormData();
    f.set("nombre", nombre.trim());
    f.set("para", para);
    f.set("cc", cc);
    f.set("cco", cco);
    f.set("asunto", asunto);
    f.set("texto", texto);
    if (base && r.modo !== "reenviar") {
      if (base.messageId) {
        f.set("enRespuestaA", base.messageId);
        f.set("referencias", [...(base.referencias ?? []), base.messageId].join(" "));
      }
      f.set("carpeta", r.carpeta ?? "");
      f.set("uid", String(base.uid));
    }
    for (const a of archivos) f.append("adjuntos", a, a.name);
    try {
      await api.enviar(f);
      bandeja.redaccion = null;
      bandeja.avisar("Enviado");
      void bandeja.refrescar();
    } catch (e) {
      if (e instanceof ErrorApi && Object.keys(e.errores).length) {
        errores = e.errores;
        if (e.errores.cc || e.errores.cco) verCopias = true;
      } else general = e instanceof Error ? e.message : "No se pudo enviar.";
    } finally {
      enviando = false;
    }
  }

  function guardarRemitente() {
    localStorage.setItem(claveAjustes, JSON.stringify({ nombre: nombre.trim(), firma: firmaEditable.trim() }));
    editarRemitente = false;
  }

  function cerrar() {
    if (conContenido && !descartar) {
      descartar = true;
      return;
    }
    bandeja.redaccion = null;
  }

  function tecla(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void enviar();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cerrar();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="redactar"
  role="dialog"
  aria-modal="true"
  aria-label={titulo}
  tabindex="-1"
  onkeydown={tecla}
  ondragover={(e) => {
    e.preventDefault();
    arrastrando = true;
  }}
  ondragleave={() => (arrastrando = false)}
  ondrop={(e) => {
    e.preventDefault();
    arrastrando = false;
    sumar(e.dataTransfer?.files ?? null);
  }}
>
  <form
    class:arrastrando
    onsubmit={(e) => {
      e.preventDefault();
      void enviar();
    }}
  >
    <header>
      <h2>{titulo}</h2>
      <button type="button" class="icono" aria-label="Cerrar" onclick={cerrar}><Icono nombre="cerrar" /></button>
    </header>

    <div class="remitente">
      <span class="etiqueta">De</span>
      {#if editarRemitente}
        <div class="ajustes">
          <input class="campo" placeholder="Nombre con que sale (ej. Ventas · Maderera Juan B. Justo)" bind:value={nombre} />
          <textarea class="campo" rows="3" placeholder="Firma" bind:value={firmaEditable}></textarea>
          <div><button type="button" class="boton" onclick={guardarRemitente}>Guardar</button></div>
        </div>
      {:else}
        <span class="yo">{nombre ? `${nombre} <${yo}>` : yo}</span>
        <button type="button" class="enlace" onclick={() => (editarRemitente = true)}>Nombre y firma</button>
      {/if}
    </div>

    <label class="linea">
      <span class="etiqueta">Para</span>
      <input bind:this={campoPara} bind:value={para} placeholder="jose@ejemplo.com, otra@ejemplo.com" autocomplete="email" aria-invalid={!!errores.para} />
      {#if !verCopias}<button type="button" class="enlace" onclick={() => (verCopias = true)}>Cc Cco</button>{/if}
    </label>
    {#if errores.para}<p class="error">{errores.para}</p>{/if}
    {#if verCopias}
      <label class="linea"><span class="etiqueta">Cc</span><input bind:value={cc} aria-invalid={!!errores.cc} /></label>
      {#if errores.cc}<p class="error">{errores.cc}</p>{/if}
      <label class="linea"><span class="etiqueta">Cco</span><input bind:value={cco} aria-invalid={!!errores.cco} /></label>
      {#if errores.cco}<p class="error">{errores.cco}</p>{/if}
    {/if}
    <label class="linea">
      <span class="etiqueta">Asunto</span>
      <input bind:value={asunto} aria-invalid={!!errores.asunto} />
    </label>
    {#if errores.asunto}<p class="error">{errores.asunto}</p>{/if}

    <textarea bind:this={campoTexto} bind:value={texto} class="texto" aria-label="Mensaje"></textarea>

    {#if archivos.length}
      <ul class="adjuntos">
        {#each archivos as a, i (i)}
          <li>
            <Icono nombre="clip" tamano={14} />
            <span class="nombre">{a.name}</span>
            <span class="peso">{tamano(a.size)}</span>
            <button type="button" class="quitar" aria-label="Quitar {a.name}" onclick={() => (archivos = archivos.filter((_, j) => j !== i))}>
              <Icono nombre="cerrar" tamano={14} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if errores.adjuntos || pesoTotal > TOPE}<p class="error">{errores.adjuntos ?? "Los adjuntos pasan los 18 MB."}</p>{/if}
    {#if general}<p class="error" role="alert">{general}</p>{/if}

    <footer>
      {#if descartar}
        <span class="pregunta">¿Descartar este mensaje?</span>
        <button type="button" class="boton" onclick={() => (descartar = false)}>Seguir escribiendo</button>
        <button type="button" class="boton peligro" onclick={cerrar}>Descartar</button>
      {:else}
        <button class="boton principal" disabled={enviando}>
          <Icono nombre="enviados" />
          {enviando ? "Enviando…" : "Enviar"}
        </button>
        <span class="tecla atajo">⌘/Ctrl + Enter</span>
        <label class="boton adjuntar">
          <Icono nombre="clip" /> Adjuntar
          <input type="file" multiple class="oculto" onchange={(e) => sumar((e.target as HTMLInputElement).files)} />
        </label>
      {/if}
    </footer>
  </form>
</div>

<style>
  .redactar {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: end end;
    padding: 16px;
    pointer-events: none;
  }
  form {
    pointer-events: auto;
    width: min(640px, 100%);
    height: min(640px, calc(100vh - 32px));
    display: flex;
    flex-direction: column;
    background: var(--superficie);
    border: 1px solid var(--borde);
    border-radius: 14px;
    box-shadow: var(--sombra), 0 24px 64px oklch(0.2 0.01 60 / 0.18);
    overflow: hidden;
  }
  form.arrastrando {
    outline: 3px dashed var(--naranja);
    outline-offset: -8px;
  }
  header {
    display: flex;
    align-items: center;
    padding: 8px 8px 8px 18px;
    background: var(--superficie-2);
    border-bottom: 1px solid var(--borde);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 1rem;
  }
  .remitente,
  .linea {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 18px;
    border-bottom: 1px solid var(--borde);
    min-height: 44px;
  }
  .remitente {
    flex-wrap: wrap;
    padding-top: 6px;
    padding-bottom: 6px;
  }
  .etiqueta {
    width: 3.5em;
    flex: none;
    color: var(--texto-3);
    font-size: 0.9rem;
  }
  .yo {
    flex: 1;
    color: var(--texto-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ajustes {
    flex: 1;
    display: grid;
    gap: 8px;
    min-width: 240px;
  }
  .linea input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    padding: 10px 0;
    outline: none;
  }
  .linea input[aria-invalid="true"] {
    color: var(--peligro);
  }
  .enlace {
    border: 0;
    background: transparent;
    color: var(--naranja-fuerte);
    font-size: 0.88rem;
    font-weight: 600;
    padding: 4px;
  }
  .texto {
    flex: 1;
    border: 0;
    resize: none;
    padding: 14px 18px;
    background: transparent;
    outline: none;
    line-height: 1.55;
    font-size: 1rem;
  }
  .error {
    margin: 6px 18px;
    color: var(--peligro);
    font-size: 0.88rem;
  }
  .adjuntos {
    list-style: none;
    margin: 0;
    padding: 8px 18px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    border-top: 1px solid var(--borde);
    max-height: 120px;
    overflow-y: auto;
  }
  .adjuntos li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px 4px 10px;
    background: var(--superficie-2);
    border: 1px solid var(--borde);
    border-radius: 8px;
    font-size: 0.88rem;
    max-width: 100%;
  }
  .adjuntos .nombre {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 24ch;
  }
  .peso {
    color: var(--texto-3);
  }
  .quitar {
    border: 0;
    background: transparent;
    color: var(--texto-3);
    display: grid;
    padding: 4px;
    border-radius: 6px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--borde);
  }
  .adjuntar {
    margin-left: auto;
  }
  .pregunta {
    flex: 1;
    font-weight: 600;
  }
  .peligro {
    color: var(--peligro);
  }
  @media (max-width: 720px) {
    .redactar {
      padding: 0;
    }
    form {
      width: 100%;
      height: 100%;
      border-radius: 0;
      border: 0;
    }
    .atajo {
      display: none;
    }
  }
</style>
