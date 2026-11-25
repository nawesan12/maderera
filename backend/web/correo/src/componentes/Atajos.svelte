<script lang="ts">
  let { oncerrar }: { oncerrar: () => void } = $props();

  const grupos: [string, [string, string][]][] = [
    [
      "Moverse",
      [
        ["j / ↓", "Siguiente"],
        ["k / ↑", "Anterior"],
        ["Enter / o", "Abrir"],
        ["u / Esc", "Volver a la lista"],
        ["/", "Buscar"],
      ],
    ],
    [
      "Mensajes",
      [
        ["c", "Redactar"],
        ["r", "Responder"],
        ["a", "Responder a todos"],
        ["f", "Reenviar"],
        ["⌘/Ctrl + Enter", "Enviar"],
      ],
    ],
    [
      "Ordenar",
      [
        ["e", "Archivar"],
        ["#", "A la papelera"],
        ["!", "Es spam"],
        ["s", "Destacar"],
        ["x", "Marcar para elegir varios"],
        ["Shift + i / u", "Leído / sin leer"],
      ],
    ],
  ];
</script>

<div class="fondo" role="presentation" onclick={oncerrar}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="panel" role="dialog" aria-modal="true" aria-label="Atajos de teclado" tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <h2>Atajos de teclado</h2>
    <div class="grupos">
      {#each grupos as [titulo, filas] (titulo)}
        <section>
          <h3>{titulo}</h3>
          <dl>
            {#each filas as [tecla, que] (tecla)}
              <dt><span class="tecla">{tecla}</span></dt>
              <dd>{que}</dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
    <button class="boton" onclick={oncerrar}>Cerrar</button>
  </div>
</div>

<style>
  .fondo {
    position: fixed;
    inset: 0;
    z-index: 45;
    display: grid;
    place-items: center;
    padding: 16px;
    background: oklch(0.12 0.01 60 / 0.55);
  }
  .panel {
    width: min(760px, 100%);
    max-height: 100%;
    overflow-y: auto;
    background: var(--pop);
    border-radius: 16px;
    padding: 22px 24px;
    box-shadow: var(--popsh);
  }
  h2 {
    margin: 0 0 14px;
  }
  .grupos {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 18px;
    margin-bottom: 18px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 0.9rem;
    color: var(--mut);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 12px;
    margin: 0;
    align-items: center;
  }
  dd {
    margin: 0;
  }
</style>
