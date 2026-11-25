<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { ErrorApi, type Direccion } from "../lib/api";
  import { bandeja, type Redaccion } from "../lib/estado.svelte";
  import { preferencias } from "../lib/preferencias.svelte";
  import { armar, expandirAtajo, iniciar, mencionaAdjunto, separar, traerAdjuntos, TOPE_ADJUNTOS } from "../lib/borrador";
  import { equipo } from "../lib/equipo.svelte";
  import { clientes, type Ficha } from "../lib/clientes.svelte";
  import { rellenar } from "../lib/plantillas";
  import Respuestas from "./Respuestas.svelte";
  import { tamano } from "../lib/formato";
  import Icono from "./Icono.svelte";
  import Destinatarios from "./Destinatarios.svelte";

  // Una ventana de redactar (2b): abajo a la derecha, se minimiza a una
  // pestaña y puede haber varias. En el teléfono ocupa toda la pantalla.
  let { ventana }: { ventana: Redaccion } = $props();

  // La ventana se arma una vez con lo que trae; después manda lo escrito.
  const r = untrack(() => ventana);
  const yo = (bandeja.correo ?? "").toLowerCase();
  const remitente = preferencias.remitente(yo);
  const inicio = iniciar(r.modo, r.base, yo);
  const firma = remitente.firma ? `\n\n-- \n${remitente.firma}` : "";

  let para = $state<Direccion[]>(r.para ? separar(r.para) : inicio.para);
  let cc = $state<Direccion[]>(inicio.cc);
  let cco = $state<Direccion[]>([]);
  let asunto = $state(inicio.asunto);
  let texto = $state(r.texto ?? "");
  let verCopias = $state(inicio.cc.length > 0);
  let archivos = $state<File[]>([]);
  let enviando = $state(false);
  let errores = $state<Record<string, string>>({});
  let general = $state("");
  let descartar = $state(false);
  let arrastrando = $state(false);
  let grande = $state(false);
  let ignorarAviso = $state(false);
  let seguimiento = $state(0);
  let insertada = $state("");
  // La ficha del primer destinatario, para los datos vivos de las respuestas.
  let ficha: Ficha | null = null;
  $effect(() => {
    const c = para[0]?.correo ?? r.base?.de[0]?.correo ?? "";
    if (c) void clientes.ficha(c).then((f) => (ficha = f));
  });
  const nombreDestino = $derived(para[0]?.nombre ?? "");

  function insertar(t: string, titulo: string) {
    texto = (texto.trimEnd() ? texto.trimEnd() + "\n\n" : "") + rellenar(t, ficha, nombreDestino);
    insertada = titulo;
    campoTexto?.focus();
  }

  function alEscribir() {
    const nuevo = expandirAtajo(texto, equipo.plantillas, (t) => rellenar(t, ficha, nombreDestino));
    if (nuevo !== null) texto = nuevo;
  }

  let campoTexto: HTMLTextAreaElement;
  let campoAsunto: HTMLInputElement;
  let elegirArchivos = $state<HTMLInputElement>();
  let destPara: Destinatarios;
  let destCc = $state<Destinatarios>();
  let destCco = $state<Destinatarios>();

  const titulo = $derived(asunto.trim() || { nuevo: "Mensaje nuevo", responder: "Responder", "responder-todos": "Responder a todos", reenviar: "Reenviar" }[r.modo]);
  $effect(() => bandeja.titularVentana(r.id, titulo));

  const minimizada = $derived(!!bandeja.ventanas.find((v) => v.id === r.id)?.minimizada);
  const pesoTotal = $derived(archivos.reduce((s, f) => s + f.size, 0));
  const palabraAdjunto = $derived(archivos.length || ignorarAviso ? "" : mencionaAdjunto(texto));
  const conContenido = $derived(!!(para.length || asunto.trim() || archivos.length || texto.trim()));

  onMount(() => {
    if (r.modo === "responder" || r.modo === "responder-todos" || (r.para && !asunto)) {
      (r.para ? campoAsunto : campoTexto).focus();
    }
    // Reenviar lleva los adjuntos del original: se bajan y se vuelven a subir.
    if (r.modo === "reenviar" && r.base?.adjuntos.length) {
      traerAdjuntos(r.base, r.carpeta ?? bandeja.carpeta)
        .then((fs) => (archivos = [...fs, ...archivos]))
        .catch(() => (general = "No se pudieron traer los adjuntos del original."));
    }
  });

  function sumar(lista: FileList | null) {
    if (lista) archivos = [...archivos, ...lista];
  }

  async function enviar() {
    destPara.confirmar();
    destCc?.confirmar();
    destCco?.confirmar();
    errores = {};
    general = "";
    if (destPara.pendiente()) {
      errores = { para: `«${destPara.pendiente()}» no es una dirección de correo.` };
      return;
    }
    if (pesoTotal > TOPE_ADJUNTOS) {
      errores = { adjuntos: "Los adjuntos pasan los 18 MB. Mandalos en dos correos." };
      return;
    }
    enviando = true;
    const completo = texto + firma + (inicio.anterior ? `\n\n${inicio.anterior}` : "");
    const datos = armar({
      nombre: remitente.nombre, para, cc, cco, asunto, texto: completo, archivos, modo: r.modo, base: r.base, carpeta: r.carpeta,
      seguimiento, persona: equipo.yo,
    });
    try {
      const como = await bandeja.enviar(datos, asunto);
      bandeja.cerrarVentana(r.id);
      bandeja.avisar(como === "enviado" ? "Enviado" : "Sin conexión: sale apenas vuelva");
    } catch (e) {
      if (e instanceof ErrorApi && Object.keys(e.errores).length) {
        errores = e.errores;
        if (e.errores.cc || e.errores.cco) verCopias = true;
      } else general = e instanceof Error ? e.message : "No se pudo enviar.";
    } finally {
      enviando = false;
    }
  }

  function cerrar() {
    if (conContenido && !descartar) {
      descartar = true;
      return;
    }
    bandeja.cerrarVentana(r.id);
  }

  function tecla(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void enviar();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (descartar) descartar = false;
      else bandeja.alternarVentana(r.id);
    }
  }

  // El aviso de adjunto con la palabra resaltada en el texto, como en el
  // diseño: se arma un espejo del textarea con la palabra marcada.
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="redactar"
  class:minimizada
  class:grande
  role="dialog"
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
      <button type="button" class="icono" aria-label="Minimizar" title="Minimizar (Esc)" onclick={() => bandeja.alternarVentana(r.id)}><Icono nombre="minimizar" tamano={20} /></button>
      <button type="button" class="icono agrandar" aria-label={grande ? "Achicar" : "Agrandar"} onclick={() => (grande = !grande)}><Icono nombre="agrandar" tamano={18} /></button>
      <button type="button" class="icono" aria-label="Cerrar" onclick={cerrar}><Icono nombre="cerrar" tamano={20} /></button>
    </header>

    <div class="linea">
      <span class="etiqueta">De</span>
      <span class="yo"><span class="punto"></span>{remitente.nombre ? `${remitente.nombre} — ${yo}` : yo}</span>
    </div>

    <div class="linea">
      <label class="etiqueta" for="para-{r.id}">Para</label>
      <Destinatarios bind:this={destPara} bind:lista={para} id="para-{r.id}" invalido={!!errores.para} enfocar={r.modo === "nuevo" && !r.para} />
      {#if !verCopias}<button type="button" class="enlace copias" onclick={() => (verCopias = true)}>Cc  Cco</button>{/if}
    </div>
    {#if errores.para}<p class="error">{errores.para}</p>{/if}
    {#if verCopias}
      <div class="linea">
        <label class="etiqueta" for="cc-{r.id}">Cc</label>
        <Destinatarios bind:this={destCc} bind:lista={cc} id="cc-{r.id}" invalido={!!errores.cc} />
      </div>
      {#if errores.cc}<p class="error">{errores.cc}</p>{/if}
      <div class="linea">
        <label class="etiqueta" for="cco-{r.id}">Cco</label>
        <Destinatarios bind:this={destCco} bind:lista={cco} id="cco-{r.id}" invalido={!!errores.cco} />
      </div>
      {#if errores.cco}<p class="error">{errores.cco}</p>{/if}
    {/if}
    <div class="linea">
      <label class="etiqueta" for="asunto-{r.id}">Asunto</label>
      <input id="asunto-{r.id}" class="asunto" bind:this={campoAsunto} bind:value={asunto} aria-invalid={!!errores.asunto} />
    </div>
    {#if errores.asunto}<p class="error">{errores.asunto}</p>{/if}

    <div class="cuerpo">
      <textarea bind:this={campoTexto} bind:value={texto} oninput={alEscribir} aria-label="Mensaje" placeholder="Escribí el mensaje"></textarea>
      {#if insertada}
        <div class="insertada" role="status"><Icono nombre="respuestas" tamano={18} />Se insertó la respuesta guardada «{insertada}»</div>
      {/if}
      {#if remitente.firma}
        <div class="firma">
          <img src="/logo.png" alt="" width="44" height="44" />
          <div>{#each remitente.firma.split("\n") as l, i (i)}<div class:primera={i === 0}>{l}</div>{/each}</div>
        </div>
      {/if}
      {#if inicio.anterior}
        <div class="anterior">{inicio.encabezado}</div>
      {/if}
    </div>

    {#if archivos.length}
      <ul class="adjuntos">
        {#each archivos as a, i (i)}
          <li>
            <Icono nombre="clip" tamano={15} />
            <span class="nombre">{a.name}</span>
            <span class="peso">{tamano(a.size)}</span>
            <button type="button" class="quitar" aria-label="Quitar {a.name}" onclick={() => (archivos = archivos.filter((_, j) => j !== i))}><Icono nombre="cerrar" tamano={14} /></button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if palabraAdjunto}
      <div class="aviso-adjunto" role="status">
        <Icono nombre="clip" tamano={20} />
        <span>Dice «{palabraAdjunto}», pero no agregaste ningún archivo.</span>
        <button type="button" class="enlace" onclick={() => elegirArchivos?.click()}>Adjuntar</button>
        <button type="button" class="icono chico" aria-label="No hace falta" title="No hace falta" onclick={() => (ignorarAviso = true)}><Icono nombre="cerrar" tamano={16} /></button>
      </div>
    {/if}
    {#if errores.adjuntos || pesoTotal > TOPE_ADJUNTOS}<p class="error">{errores.adjuntos ?? "Los adjuntos pasan los 18 MB."}</p>{/if}
    {#if general}<p class="error" role="alert">{general}</p>{/if}

    <footer>
      {#if descartar}
        <span class="pregunta">¿Descartar este mensaje?</span>
        <button type="button" class="boton" onclick={() => (descartar = false)}>Seguir escribiendo</button>
        <button type="button" class="boton peligro" onclick={cerrar}>Descartar</button>
      {:else}
        <button class="boton principal enviar" disabled={enviando} title="Enviar (⌘/Ctrl + Enter)">
          {enviando ? "Enviando…" : "Enviar"}
        </button>
        <label class="herramienta">
          <Icono nombre="clip" tamano={20} /><span>Adjuntar</span>
          <input bind:this={elegirArchivos} type="file" multiple class="oculto" onchange={(e) => sumar((e.target as HTMLInputElement).files)} />
        </label>
        <Respuestas oninsertar={insertar} bind:seguimiento compacto />
        <span class="atajo"><span class="tecla">⌘ Enter</span></span>
        <button type="button" class="icono tacho" aria-label="Descartar" title="Descartar" onclick={cerrar}><Icono nombre="papelera" tamano={20} /></button>
      {/if}
    </footer>
  </form>
</div>

<style>
  .redactar {
    position: fixed;
    right: 24px;
    bottom: 0;
    z-index: 40;
    width: 664px;
    height: min(760px, calc(100vh - 24px));
    max-width: calc(100vw - 48px);
  }
  .redactar.minimizada {
    display: none;
  }
  .redactar.grande {
    right: 50%;
    bottom: 50%;
    transform: translate(50%, 50%);
    width: min(1040px, calc(100vw - 64px));
    height: min(860px, calc(100vh - 64px));
  }
  .redactar.grande form {
    border-radius: 14px;
  }
  .redactar.grande header {
    border-radius: 14px 14px 0 0;
  }
  form {
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: var(--card);
    background-image: var(--texC);
    background-size: 180px 180px;
    border-radius: 14px 14px 0 0;
    box-shadow:
      var(--popsh),
      0 0 0 1px var(--ls);
    overflow: hidden;
  }
  form.arrastrando {
    outline: 3px dashed var(--acc);
    outline-offset: -8px;
  }
  header {
    height: 52px;
    flex: none;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 6px 0 20px;
    background: var(--toast);
    color: var(--toastT);
  }
  h2 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  header .icono {
    color: inherit;
    width: 40px;
    height: 40px;
  }
  header .icono:hover {
    background: oklch(1 0 0 / 0.12);
    color: inherit;
  }
  .linea {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 54px;
    padding: 0 20px;
    border-bottom: 1px solid var(--ls);
    font-size: 16px;
  }
  .etiqueta {
    width: 56px;
    flex: none;
    color: var(--mut);
  }
  .yo {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-weight: 500;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .punto {
    width: 10px;
    height: 10px;
    flex: none;
    border-radius: 50%;
    background: var(--avatar);
  }
  .copias {
    font-size: 15px;
    color: var(--mut);
    font-weight: 500;
    white-space: pre;
    min-height: 40px;
  }
  .asunto {
    flex: 1;
    min-width: 0;
    height: 52px;
    border: 0;
    background: transparent;
    outline: none;
    font-size: 16px;
  }
  .cuerpo {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 18px 20px 10px;
    overflow-y: auto;
  }
  textarea {
    flex: 1;
    min-height: 140px;
    border: 0;
    resize: none;
    padding: 0;
    background: transparent;
    outline: none;
    font-size: 17px;
    line-height: 1.65;
  }
  .firma {
    display: flex;
    gap: 14px;
    align-items: center;
    margin-top: 8px;
    font-size: 15px;
    line-height: 1.45;
    color: var(--mut);
  }
  .firma img {
    border-radius: 8px;
    flex: none;
  }
  .firma .primera {
    color: var(--fg);
    font-weight: 600;
    font-size: 16px;
  }
  .insertada {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 6px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--hun);
    font-size: 15px;
    color: var(--mut);
  }
  .anterior {
    margin-top: 12px;
    padding: 8px 12px;
    border-left: 3px solid var(--ls);
    font-size: 14px;
    color: var(--mut);
  }
  .adjuntos {
    list-style: none;
    margin: 0;
    padding: 8px 20px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    max-height: 120px;
    overflow-y: auto;
  }
  .adjuntos li {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 4px 0 10px;
    border: 1px solid var(--ls);
    border-radius: 10px;
    font-size: 14px;
    max-width: 100%;
  }
  .adjuntos .nombre {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 24ch;
  }
  .peso {
    color: var(--mut);
  }
  .quitar {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--mut);
    padding: 0;
  }
  .aviso-adjunto {
    margin: 0 20px 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 8px 8px 16px;
    min-height: 48px;
    border-radius: 12px;
    background: var(--espBg);
    color: var(--espT);
    font-size: 16px;
  }
  .aviso-adjunto span {
    flex: 1;
  }
  .aviso-adjunto .enlace {
    color: inherit;
    font-size: 16px;
  }
  .icono.chico {
    width: 34px;
    height: 34px;
    color: inherit;
  }
  .error {
    margin: 6px 20px;
    color: var(--prT);
    font-size: 15px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 12px 16px calc(16px + env(safe-area-inset-bottom));
    flex: none;
  }
  .enviar {
    height: 48px;
    padding: 0 26px;
    font-size: 17px;
  }
  .herramienta {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 12px;
    margin-left: 8px;
    border-radius: 10px;
    font-size: 15px;
    cursor: pointer;
  }
  .herramienta :global(svg) {
    color: var(--mut);
  }
  .herramienta:hover {
    background: var(--sel);
  }
  .atajo {
    margin-left: 4px;
  }
  .tacho {
    margin-left: auto;
  }
  .pregunta {
    flex: 1;
    font-weight: 600;
  }
  .peligro {
    color: var(--prT);
  }
  @media (max-width: 1080px) {
    .agrandar,
    .atajo {
      display: none;
    }
  }
  @media (max-width: 720px) {
    .redactar,
    .redactar.grande {
      inset: 0;
      transform: none;
      width: 100%;
      height: 100%;
      max-width: none;
    }
    form {
      border-radius: 0;
    }
    header {
      padding-top: env(safe-area-inset-top);
      height: calc(56px + env(safe-area-inset-top));
    }
  }
</style>
