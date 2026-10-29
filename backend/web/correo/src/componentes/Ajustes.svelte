<script lang="ts">
  import { bandeja } from "../lib/estado.svelte";
  import { preferencias, type Densidad, type Tema } from "../lib/preferencias.svelte";
  import Icono, { type NombreIcono } from "./Icono.svelte";
  import { api, type TiempoRespuesta } from "../lib/api";
  import { equipo } from "../lib/equipo.svelte";
  import { camposVivos } from "../lib/plantillas";

  // Los ajustes (2e), por ahora los que viven en este navegador: cómo se ve
  // y con qué nombre y firma sale la casilla. La respuesta automática, las
  // reglas y las casillas necesitan ManageSieve y el panel de casillas:
  // quedan para después (docs/go/progreso.md).
  let { onatajos }: { onatajos: () => void } = $props();

  type Seccion = "apariencia" | "firma" | "respuestas" | "equipo";
  let seccion = $state<Seccion>("apariencia");
  const casilla = bandeja.correo ?? "";
  const guardado = preferencias.remitente(casilla);
  let nombre = $state(guardado.nombre);
  let firma = $state(guardado.firma);
  let listo = $state(false);

  const nav: [Seccion, string, NombreIcono][] = [
    ["apariencia", "Cómo se ve", "sol"],
    ["firma", "Nombre y firma", "firma"],
    ...(equipo.activo
      ? ([
          ["respuestas", "Respuestas guardadas", "respuestas"],
          ["equipo", "Equipo y tiempos", "persona"],
        ] as [Seccion, string, NombreIcono][])
      : []),
  ];

  // Respuestas guardadas: la que se edita (nueva o existente).
  let editando = $state<{ id?: string; titulo: string; atajo: string; texto: string } | null>(null);
  let errores = $state<Record<string, string>>({});
  async function guardarRespuesta(e: SubmitEvent) {
    e.preventDefault();
    if (!editando) return;
    errores = {};
    try {
      if (editando.id) {
        const viejo = equipo.plantillas.find((p) => p.id === editando!.id);
        // Cambió el nombre: el viejo se borra (la clave es el nombre).
        if (viejo && viejo.titulo !== editando.titulo.trim()) await api.borrarPlantilla(viejo.id);
      }
      await api.guardarPlantilla({ titulo: editando.titulo, atajo: editando.atajo, texto: editando.texto });
      editando = null;
      await equipo.cargarPlantillas();
    } catch (err) {
      const e2 = err as { errores?: Record<string, string>; message?: string };
      errores = e2.errores && Object.keys(e2.errores).length ? e2.errores : { texto: e2.message ?? "No se pudo guardar." };
    }
  }
  async function borrarRespuesta(id: string) {
    equipo.plantillas = equipo.plantillas.filter((p) => p.id !== id);
    await api.borrarPlantilla(id).catch(() => equipo.cargarPlantillas());
  }

  let tiempos = $state<TiempoRespuesta[] | null>(null);
  $effect(() => {
    if (seccion === "equipo" && tiempos === null) void api.tiempos(30).then((t) => (tiempos = t)).catch(() => (tiempos = []));
  });
  function duracion(s: number): string {
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
    if (s < 86400) return `${(s / 3600).toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`;
    return `${(s / 86400).toLocaleString("es-AR", { maximumFractionDigits: 1 })} días`;
  }
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
    {:else if seccion === "respuestas"}
      <section>
        <div class="titulo-accion">
          <div>
            <h2>Respuestas guardadas</h2>
            <p>Textos que se repiten. Se insertan con el botón «Respuestas» o escribiendo el atajo y un espacio. Son de la casilla: las ve todo el que la lea.</p>
          </div>
          {#if !editando}<button class="boton" onclick={() => (editando = { titulo: "", atajo: "", texto: "" })}><Icono nombre="mas_uno" tamano={18} />Nueva</button>{/if}
        </div>
        {#if editando}
          <form class="editor" onsubmit={guardarRespuesta}>
            <div class="dos">
              <label><span>Nombre</span><input class="campo" bind:value={editando.titulo} placeholder="Precio de placas" maxlength="80" /></label>
              <label><span>Atajo</span><input class="campo mono" bind:value={editando.atajo} placeholder=";precios" maxlength="20" /></label>
            </div>
            {#if errores.titulo}<small class="error">{errores.titulo}</small>{/if}
            {#if errores.atajo}<small class="error">{errores.atajo}</small>{/if}
            <label><span>Texto</span><textarea class="campo" rows="6" bind:value={editando.texto} placeholder={"Hola {nombre}, tu pedido {pedido} está {estado}."}></textarea></label>
            {#if errores.texto}<small class="error">{errores.texto}</small>{/if}
            <div class="vivos">
              <span>Datos vivos, se completan con la ficha del cliente:</span>
              {#each camposVivos as [campo, que] (campo)}
                <button type="button" class="chip-vivo" title={que} onclick={() => editando && (editando.texto += campo)}>{campo}</button>
              {/each}
            </div>
            <div class="acciones">
              <button class="boton principal">Guardar</button>
              <button type="button" class="boton" onclick={() => ((editando = null), (errores = {}))}>Cancelar</button>
            </div>
          </form>
        {/if}
        <div class="guardadas">
          {#each equipo.plantillas as p (p.id)}
            <div class="guardada">
              <div class="cabeza-g"><strong>{p.titulo}</strong>{#if p.atajo}<span class="mono atajo">{p.atajo}</span>{/if}
                <button class="icono chico" aria-label="Editar {p.titulo}" onclick={() => (editando = { ...p })}><Icono nombre="lapiz" tamano={17} /></button>
                <button class="icono chico" aria-label="Borrar {p.titulo}" onclick={() => borrarRespuesta(p.id)}><Icono nombre="papelera" tamano={17} /></button>
              </div>
              <span class="texto-g">{p.texto}</span>
            </div>
          {:else}
            {#if !editando}<p class="nada">Todavía no hay ninguna.</p>{/if}
          {/each}
        </div>
      </section>
    {:else if seccion === "equipo"}
      <section>
        <h2>Quién está usando el correo</h2>
        <p>En una casilla compartida, lo que asignás, las notas y las respuestas quedan a tu nombre. Se recuerda en este navegador.</p>
        <div class="opciones" role="radiogroup" aria-label="Quién sos">
          {#each equipo.personas as p (p.id)}
            <button role="radio" aria-checked={equipo.yo === p.id} class="opcion" class:on={equipo.yo === p.id} onclick={() => equipo.elegirYo(p.id)}>{p.nombre}</button>
          {/each}
        </div>
      </section>
      <div class="linea"></div>
      <section>
        <h2>Tiempo de respuesta</h2>
        <p>Cuánto se tarda en contestar desde que llega un correo, en los últimos 30 días. Cuenta lo que se contestó desde acá.</p>
        {#if tiempos === null}
          <div class="esqueleto" style:height="14px" style:width="40%"></div>
        {:else if !tiempos.length}
          <p class="nada">Todavía no hay respuestas para medir.</p>
        {:else}
          <div class="tiempos">
            {#each tiempos as t (t.persona)}
              <div class="tiempo"><strong>{t.persona}</strong><span class="mono">{duracion(t.medianaSegundos)}</span><span class="cuantas">{t.conversaciones === 1 ? "1 conversación" : `${t.conversaciones} conversaciones`}</span></div>
            {/each}
          </div>
          <small class="nota-t">Es la mediana: la mitad de las respuestas salió en menos de ese tiempo.</small>
        {/if}
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
  .titulo-accion {
    display: flex;
    align-items: flex-start;
    gap: 16px;
  }
  .titulo-accion > div {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .editor {
    gap: 12px;
    padding: 16px;
    border-radius: 14px;
    background: var(--hun);
  }
  .dos {
    display: grid;
    grid-template-columns: 1fr 180px;
    gap: 12px;
  }
  .vivos {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 14px;
    color: var(--mut);
  }
  .chip-vivo {
    min-height: 32px;
    padding: 0 10px;
    border: 1px solid var(--ln);
    border-radius: 8px;
    background: var(--card);
    font: 13px var(--mono);
  }
  .guardadas {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .guardada {
    padding: 10px 8px 12px 16px;
    border-radius: 12px;
    background: var(--hun);
    line-height: 1.4;
    min-width: 0;
  }
  .cabeza-g {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cabeza-g strong {
    flex: 1;
    font-size: 16px;
  }
  .atajo {
    font-size: 13px;
    color: var(--mut);
    padding: 2px 8px;
    border-radius: 6px;
    background: var(--card);
  }
  .icono.chico {
    width: 36px;
    height: 36px;
  }
  .texto-g {
    display: block;
    font-size: 15px;
    color: var(--mut);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .nada {
    margin: 0;
  }
  .error {
    color: var(--prT);
    font-size: 15px;
  }
  .tiempos {
    display: grid;
    gap: 8px;
  }
  .tiempo {
    display: grid;
    grid-template-columns: 1fr 120px 160px;
    align-items: center;
    padding: 12px 16px;
    border-radius: 12px;
    background: var(--hun);
    font-size: 16px;
  }
  .tiempo .mono {
    font-size: 18px;
    font-weight: 600;
  }
  .cuantas,
  .nota-t {
    color: var(--mut);
    font-size: 15px;
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
