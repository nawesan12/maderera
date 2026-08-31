# Agente del taller

Deja los archivos de corte en la carpeta que vigila el optimizador de la
seccionadora, para que nadie tenga que bajarlos del panel y copiarlos a mano.

## Antes de instalarlo

Hace falta **Node 20 o superior** en la PC del taller y saber dos cosas del
optimizador (Cut Rite, Ardis, Corte Certo, Optimik o el del fabricante):

1. **Qué carpeta vigila** para importar trabajos.
2. **Qué formato espera.** Eso no se configura acá: se configura en
   `/admin/cortes/formato`, desde el navegador. El agente pide el archivo ya
   armado, así que corregir una columna o el separador no requiere tocar la PC
   del taller ni volver a desplegar.

## Del lado del servidor

```
CORTES_AGENTE_TOKEN="<algo largo, generado con: openssl rand -base64 32>"
```

Sin esa variable la integración está apagada y los endpoints responden 404.

## En la PC del taller

```bash
MJBJ_URL=https://mjbj.ar \
MJBJ_TOKEN=<el mismo token> \
MJBJ_CARPETA="C:/CutRite/Entrada" \
node agente.mjs
```

`MJBJ_INTERVALO` cambia cada cuántos segundos pregunta (por omisión, 60).

Para que arranque sola con la máquina: en Windows, Tareas Programadas con
disparador "al iniciar sesión"; en Linux, un servicio de systemd.

## Qué hace y qué no

- Pide cada tanto los cortes **en cola** y baja el de cada uno.
- Escribe con nombre temporal y renombra, para que el optimizador nunca lea un
  archivo a medio escribir.
- Vuelve a escribir un corte si le cambiaron las piezas después de bajarlo: en
  el mostrador se corrigen medidas y el archivo viejo cortaría mal.
- **No marca nada del lado del servidor.** Lleva su registro en `estado.json`,
  al lado del script. Si se reinstala, lo peor que pasa es que reescriba
  archivos que ya estaban; nunca que un corte quede como enviado sin haber
  llegado.
- **No manda nada de vuelta.** No sabe si el corte se hizo: eso lo marca el
  operario desde `/taller`.

## Si algo no anda

| Mensaje | Qué pasa |
|---|---|
| `El token no es válido` | `MJBJ_TOKEN` no coincide con `CORTES_AGENTE_TOKEN` |
| `falta CORTES_AGENTE_TOKEN del lado del servidor` | La integración está apagada en la plataforma |
| Nada en la carpeta | Fijarse que haya cortes **en cola** y con piezas cargadas |

Un error de red no corta el agente: lo registra y vuelve a intentar en la
siguiente vuelta.
