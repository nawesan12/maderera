<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { ErrorApi, type Direccion } from "../lib/api";
  import { bandeja, type ModoRedactar, type Redaccion } from "../lib/estado.svelte";
  import { preferencias } from "../lib/preferencias.svelte";
  import { armar, expandirAtajo, iniciar, mencionaAdjunto, traerAdjuntos, TOPE_ADJUNTOS, unir } from "../lib/borrador";
  import { equipo } from "../lib/equipo.svelte";
  import { clientes, type Ficha } from "../lib/clientes.svelte";
  import { rellenar } from "../lib/plantillas";
  import Respuestas from "./Respuestas.svelte";
  import { fechaLarga, nombreDe, tamano, tipoDeAdjunto } from "../lib/formato";
  import Icono from "./Icono.svelte";
  import Destinatarios from "./Destinatarios.svelte";

  // Responder (2k) y reenviar (2l) ahí mismo, debajo del mensaje. El texto
  // anterior va plegado; al reenviar, los adjuntos se mandan solos y se
  // puede sacar el que no haga falta.
  let { redaccion: pedida }: { redaccion: Redaccion } = $props();
  // Se arma una vez: Lector la vuelve a crear si cambia la respuesta.
  const redaccion = untrack(() => pedida);
  const base = redaccion.base!;
  const yo = (bandeja.correo ?? "").toLowerCase();
  const remitente = preferencias.remitente(yo);

  let modo = $state<ModoRedactar>(redaccion.modo);
  const inicio = $derived(iniciar(modo, base, yo));
  let para = $state<Direccion[]>(iniciar(redaccion.modo, base, yo).para);
  let cc = $state<Direccion[]>(iniciar(redaccion.modo, base, yo).cc);
  let texto = $state("");
  let verAnterior = $state(false);
  let menuModo = $state(false);
  let enviando = $state(false);
  let general = $state("");
  let errores = $state<Record<string, string>>({});
  // Reenviar: los del original (con su marca de quitado) y los que se suman.
  let originales = $state<{ archivo: File | null; nombre: string; tipo: string; tamano: number; quitado: boolean }[]>([]);
  let nuevos = $state<File[]>([]);
  let ignorarAviso = $state(false);
  let seguimiento = $state(0);
  let ficha: Ficha | null = null;
  void clientes.ficha(base.de[0]?.correo ?? "").then((f) => (ficha = f));
  const nombreDestino = base.de[0]?.nombre ?? "";

  function insertar(t: string) {
    texto = (texto.trimEnd() ? texto.trimEnd() + "\n\n" : "") + rellenar(t, ficha, nombreDestino);
    campo?.focus();
  }

  function alEscribir() {
    const nuevo = expandirAtajo(texto, equipo.plantillas, (t) => rellenar(t, ficha, nombreDestino));
    if (nuevo !== null) texto = nuevo;
  }
  let campo: HTMLTextAreaElement;
  let destPara = $state<Destinatarios>();
  let elegir: HTMLInputElement;

  const archivos = $derived([...originales.filter((o) => !o.quitado && o.archivo).map((o) => o.archivo!), ...nuevos]);
  const peso = $derived(archivos.reduce((s, f) => s + f.size, 0));
  const palabraAdjunto = $derived(archivos.length || ignorarAviso || modo === "reenviar" ? "" : mencionaAdjunto(texto));

  onMount(() => {
    campo.focus();
    campo.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  $effect(() => {
    if (modo !== "reenviar" || originales.length) return;
    const lista = base.adjuntos.filter((a) => !a.bloqueado && !a.enLinea);
    originales = lista.map((a) => ({ archivo: null, nombre: a.nombre, tipo: a.tipo, tamano: a.tamano, quitado: false }));
    traerAdjuntos(base, redaccion.carpeta ?? bandeja.carpeta)
      .then((fs) => (originales = originales.map((o, i) => ({ ...o, archivo: fs[i] ?? null }))))
      .catch(() => (general = "No se pudieron traer los adjuntos del original."));
  });

  function cambiarModo(m: ModoRedactar) {
    menuModo = false;
    modo = m;
    const i = iniciar(m, base, yo);
    para = i.para;
    cc = i.cc;
  }

  async function enviar() {
    destPara?.confirmar();
    errores = {};
    general = "";
    if (!para.length) {
      errores = { para: modo === "reenviar" ? "¿A quién se lo reenviás?" : "Falta a quién." };
      return;
    }
    if (peso > TOPE_ADJUNTOS) {
      general = "Los adjuntos pasan los 18 MB. Sacá alguno.";
      return;
    }
    enviando = true;
    const firma = remitente.firma ? `\n\n-- \n${remitente.firma}` : "";
    const datos = armar({
      nombre: remitente.nombre,
      para,
      cc,
      cco: [],
      asunto: inicio.asunto,
      texto: texto + firma + `\n\n${inicio.anterior}`,
      archivos,
      modo,
      base,
      carpeta: redaccion.carpeta,
      seguimiento,
      persona: equipo.yo,
    });
    try {
      const como = await bandeja.enviar(datos, inicio.asunto);
      bandeja.enLinea = null;
      if (modo !== "reenviar" && bandeja.abierto) bandeja.abierto.respondido = true;
      bandeja.avisar(como === "enviado" ? (modo === "reenviar" ? "Reenviado" : "Respuesta enviada") : "Sin conexión: sale apenas vuelva");
    } catch (e) {
      if (e instanceof ErrorApi && Object.keys(e.errores).length) errores = e.errores;
      else general = e instanceof Error ? e.message : "No se pudo enviar.";
    } finally {
      enviando = false;
    }
  }

  function agrandar() {
    bandeja.agrandar({ ...redaccion, modo, para: unir(para), texto });
  }

  function tecla(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void enviar();
    } else if (e.key === "Escape" && !texto.trim()) {
      e.stopPropagation();
      bandeja.enLinea = null;
    }
  }

  const nombresModo: Record<ModoRedactar, string> = {
    nuevo: "Nuevo",
    responder: "Responder",
    "responder-todos": "Responder a todos",
    reenviar: "Reenviar",
  };
  const varios = base.para.length + base.cc.length > 1;
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="en-linea" aria-label={nombresModo[modo]} onkeydown={tecla}>
  <div class="cabeza">
    <div class="con-menu">
      <button class="modo" aria-expanded={menuModo} onclick={() => (menuModo = !menuModo)}>
        <Icono nombre={modo === "reenviar" ? "reenviar" : modo === "responder-todos" ? "responder-todos" : "responder"} tamano={18} />
        {nombresModo[modo]}
        <Icono nombre="flecha-abajo" tamano={15} />
      </button>
      {#if menuModo}
        <div class="menu-modo menu-flotante">
          <button class="item-menu" onclick={() => cambiarModo("responder")}><Icono nombre="responder" />Responder</button>
          {#if varios}<button class="item-menu" onclick={() => cambiarModo("responder-todos")}><Icono nombre="responder-todos" />Responder a todos</button>{/if}
          <button class="item-menu" onclick={() => cambiarModo("reenviar")}><Icono nombre="reenviar" />Reenviar</button>
          <button class="item-menu" onclick={agrandar}><Icono nombre="agrandar" />En una ventana aparte</button>
        </div>
      {/if}
    </div>
    <Destinatarios bind:this={destPara} bind:lista={para} id="en-linea-para" placeholder={modo === "reenviar" ? "Agregar a quién…" : "A quién"} invalido={!!errores.para} enfocar={modo === "reenviar"} />
    <button class="icono" aria-label="En una ventana aparte" title="En una ventana aparte" onclick={agrandar}><Icono nombre="agrandar" tamano={17} /></button>
  </div>
  {#if errores.para}<p class="error">{errores.para}</p>{/if}

  <div class="cuerpo">
    <textarea bind:this={campo} bind:value={texto} oninput={alEscribir} aria-label="Tu respuesta" placeholder={modo === "reenviar" ? "Agregá unas líneas, si hace falta" : "Escribí la respuesta"} rows="4"></textarea>
    {#if remitente.firma}<div class="firma">{remitente.firma.split("\n").join(" · ")}</div>{/if}

    {#if modo === "reenviar"}
      {#if originales.length || nuevos.length}
        <div class="archivos">
          {#each originales as o, i (o.nombre + i)}
            {@const t = tipoDeAdjunto(o.tipo, o.nombre)}
            <span class="archivo" class:quitado={o.quitado}>
              <span style:color={o.quitado ? "inherit" : t.color} style:display="inline-flex"><Icono nombre={t.icono} tamano={17} /></span>
              {o.nombre}
              <button aria-label={o.quitado ? `Volver a poner ${o.nombre}` : `Sacar ${o.nombre}`} title={o.quitado ? "Volver a ponerlo" : "No mandarlo"} onclick={() => (originales[i].quitado = !o.quitado)}>
                <Icono nombre={o.quitado ? "mas_uno" : "cerrar"} tamano={14} />
              </button>
            </span>
          {/each}
          {#each nuevos as f, i (f.name + i)}
            <span class="archivo">
              <Icono nombre="clip" tamano={17} />{f.name}
              <button aria-label="Sacar {f.name}" onclick={() => (nuevos = nuevos.filter((_, j) => j !== i))}><Icono nombre="cerrar" tamano={14} /></button>
            </span>
          {/each}
        </div>
      {/if}
      <div class="reenviado">
        <strong>Mensaje reenviado</strong>
        De: {nombreDe(base.de[0])} · {base.de[0]?.correo}<br />
        Fecha: {fechaLarga(base.fecha)}<br />
        Asunto: {base.asunto}
      </div>
    {:else}
      {#if nuevos.length}
        <div class="archivos">
          {#each nuevos as f, i (f.name + i)}
            <span class="archivo"><Icono nombre="clip" tamano={17} />{f.name}<button aria-label="Sacar {f.name}" onclick={() => (nuevos = nuevos.filter((_, j) => j !== i))}><Icono nombre="cerrar" tamano={14} /></button></span>
          {/each}
        </div>
      {/if}
      <button class="plegar" onclick={() => (verAnterior = !verAnterior)}>
        <Icono nombre={verAnterior ? "flecha-arriba" : "flecha-abajo"} tamano={15} />
        {verAnterior ? "Ocultar el mensaje anterior" : "Mostrar el mensaje anterior"}
      </button>
      {#if verAnterior}
        <div class="cita"><div class="encabezado">{inicio.encabezado}</div>{base.texto}</div>
      {/if}
    {/if}

    {#if palabraAdjunto}
      <div class="aviso-adjunto">
        <Icono nombre="clip" tamano={19} />
        <span>Dice «{palabraAdjunto}», pero no agregaste ningún archivo.</span>
        <button class="enlace" onclick={() => elegir.click()}>Adjuntar</button>
        <button class="icono chico" aria-label="No hace falta" onclick={() => (ignorarAviso = true)}><Icono nombre="cerrar" tamano={15} /></button>
      </div>
    {/if}
    {#if general}<p class="error" role="alert">{general}</p>{/if}
  </div>

  <div class="pie">
    <button class="boton principal enviar" disabled={enviando} onclick={enviar} title="Enviar (⌘/Ctrl + Enter)">{enviando ? "Enviando…" : "Enviar"}</button>
    <label class="icono" title="Adjuntar">
      <Icono nombre="clip" tamano={20} />
      <span class="oculto">Adjuntar</span>
      <input bind:this={elegir} type="file" multiple class="oculto" onchange={(e) => (nuevos = [...nuevos, ...((e.target as HTMLInputElement).files ?? [])])} />
    </label>
    <Respuestas oninsertar={insertar} bind:seguimiento compacto />
    <span class="estado">
      {#if archivos.length}{archivos.length === 1 ? "1 adjunto" : `${archivos.length} adjuntos`} · {tamano(peso)}{/if}
    </span>
    <button class="icono" aria-label="Descartar" title="Descartar" onclick={() => (bandeja.enLinea = null)}><Icono nombre="papelera" tamano={19} /></button>
  </div>
</section>

<style>
  .en-linea {
    border-radius: 14px;
    box-shadow:
      0 0 0 1.5px var(--acc),
      0 8px 24px -12px rgb(60 30 10 / 0.3);
    background: var(--card);
    max-width: 760px;
    flex: none;
  }
  .cabeza {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 0 8px 0 14px;
    border-bottom: 1px solid var(--ls);
    font-size: 16px;
  }
  .con-menu {
    position: relative;
  }
  .modo {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 40px;
    padding: 0 6px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    font-weight: 600;
    color: var(--accT);
    white-space: nowrap;
  }
  .modo:hover {
    background: var(--sel);
  }
  .menu-modo {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 260px;
  }
  .cuerpo {
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  textarea {
    border: 0;
    background: transparent;
    resize: vertical;
    outline: none;
    padding: 0;
    font-size: 17px;
    line-height: 1.6;
    min-height: 96px;
  }
  .firma {
    font-size: 15px;
    color: var(--mut);
  }
  .plegar {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: var(--mu);
    font-size: 14px;
    color: var(--mut);
  }
  .cita {
    border-left: 3px solid var(--ls);
    padding: 2px 0 2px 14px;
    font-size: 15px;
    line-height: 1.6;
    color: var(--mut);
    white-space: pre-wrap;
    max-height: 320px;
    overflow-y: auto;
  }
  .encabezado {
    margin-bottom: 4px;
  }
  .archivos {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .archivo {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 4px 0 10px;
    border: 1px solid var(--ls);
    border-radius: 10px;
    font-size: 14px;
  }
  .archivo.quitado {
    border-style: dashed;
    border-color: var(--ln);
    color: var(--mut);
    text-decoration: line-through;
  }
  .archivo button {
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
  .archivo button:hover {
    background: var(--mu);
  }
  .reenviado {
    padding: 12px 14px;
    border-radius: 10px;
    background: var(--hun);
    font-size: 15px;
    line-height: 1.55;
    color: var(--mut);
  }
  .reenviado strong {
    display: block;
    font-weight: 600;
    color: var(--fg);
  }
  .aviso-adjunto {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 6px 6px 14px;
    border-radius: 12px;
    background: var(--espBg);
    color: var(--espT);
    font-size: 15px;
  }
  .aviso-adjunto span {
    flex: 1;
  }
  .aviso-adjunto .enlace {
    color: inherit;
  }
  .icono.chico {
    width: 32px;
    height: 32px;
    color: inherit;
  }
  .pie {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid var(--ls);
  }
  .enviar {
    height: 46px;
    padding: 0 24px;
  }
  .pie label.icono {
    cursor: pointer;
    margin-left: 8px;
  }
  .estado {
    margin-left: auto;
    font-size: 14px;
    color: var(--mut);
  }
  .error {
    margin: 4px 16px 0;
    color: var(--prT);
    font-size: 15px;
  }
</style>
