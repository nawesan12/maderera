# Lo que cuesta tener el sitio prendido, y quién lo gasta

> Documento interno del PRESTADOR. No es una guía del panel: acá no hay nada que
> la clienta tenga que hacer. Escrito el 17/9/2026.

Vercel no cobra por visita: cobra por **tiempo de CPU de las funciones**. Una
página servida desde la red —del CDN, ya armada— cuesta **cero**. La misma
página armada en el momento cuesta cada vez que alguien la pide, y la pide
cualquiera: una persona, un buscador, un robot que copia catálogos.

Por eso las dos mitades de este documento son la misma cosa. Bajar el costo es
servir de la red lo que no depende de quién mira; y evitar que lo gasten los
bots es que nadie pueda pedir trabajo caro de a miles.

## Qué se hizo

### Que el sitio se sirva de la red

La regla que se respetó en todo: **la lista de precios sigue viajando dentro de
la clave del caché** (`lib/dal/catalog.ts`). Nada de esto relajó eso. Lo que
cambió es de dónde sale el precio del profesional: el HTML sale con el de
público —que ya es público— y el navegador lo reemplaza pidiendo
`/api/mis-precios` con su cookie. Ver `lib/precios-propios-context.tsx`.

| Pantalla | Antes | Ahora |
|---|---|---|
| `/moldava` | se armaba en cada visita | estática |
| `/corte` | se armaba en cada visita, con la consulta más cara del sitio | estática, con el precio corregido en el navegador |
| `/catalogo/[slug]` | se armaba en cada visita | se arma la primera vez que alguien la pide y después sale de la caché |
| `/catalogo` y `/stock` | se armaban en cada visita | siguen armándose, pero la red guarda el resultado 5 minutos |
| `/sitemap.xml` | tres consultas por cada rastreador | consultas cacheadas, con la etiqueta del catálogo |
| `/api/estado` | una consulta por cada cambio de pantalla | una por pestaña |
| `/api/asistente/equipaje` | una acción de servidor por cada apertura | un endpoint cacheado una hora |

Dos arreglos que valen tanto como la lista:

- **`revalidatePath("/", "layout")`**, que llamaba cada cambio del carrito y
  vaciaba la caché **del sitio entero**. Cuanto más se usaba el carrito, más
  caro salía para todos los demás. Ahora se invalida lo que cambió.
- **La red de seguridad del caché** estaba en cinco minutos y le pisaba el
  vencimiento a todas las páginas: la portada declaraba treinta días y quedaba
  en cinco minutos igual. Son ~288 rearmados diarios por ruta y por región de
  páginas que nadie tocó. Ahora es un día, y lo que mantiene el sitio al día es
  la invalidación por etiqueta, que ya funcionaba.

### Que no lo gasten los bots

- **Límite de frecuencia propio** (`lib/limites/`), contra Postgres, con una
  sola escritura atómica. Se aplica a ingresar, registrarse, confirmar compra,
  armar un corte, pedir presupuesto, contacto, anotarse a un evento, pedir
  acceso profesional, la lista de precios en PDF y subir comprobantes.
  **Nunca bloquea por su propia falla**: si la consulta del límite falla, deja
  pasar. Un límite roto no puede ser lo que deje a la maderera sin vender.
- **`robots.txt` por robot** (`app/robots.ts`): los de entrenamiento quedan
  afuera —se llevan el catálogo entero y no devuelven nada—, los que citan con
  enlace entran, y el armador de cortes queda afuera para todos.
- **Topes**: piezas totales de un corte, renglones por tanda en el carrito,
  páginas del catálogo en una sola respuesta, y el término de búsqueda
  normalizado, que era una entrada de caché nueva por cada forma de escribirlo.

## Cuando llegue una factura rara

En orden, porque el primero contesta casi siempre:

1. **Panel de Vercel → Usage → Active CPU**, agrupado por ruta. Lo que hay que
   buscar es una ruta que no debería estar ahí: si aparece `/catalogo/[slug]` o
   `/moldava` con CPU, algo volvió a hacerlas dinámicas —normalmente una
   llamada nueva a `getSession()` o a `vistaDePrecio()` adentro de un
   componente—.
2. **`curl -sSI https://<dominio>/catalogo`** y mirar `x-vercel-cache`. Tiene
   que decir `HIT`, `STALE` o `PRERENDER`. Si dice `MISS` seguido, la red no
   está guardando: revisar que la respuesta no traiga `Set-Cookie` ni
   `Cache-Control: private`.
3. **Observability → Bot traffic**, por user-agent. Si un solo agente se lleva
   la mitad de las visitas, es el momento de las reglas de abajo.
4. **La base**: Neon cobra por cómputo. Una ruta cacheada que igual consulta es
   una etiqueta que se invalida demasiado seguido; mirar qué acción del panel la
   está tocando.

Y la advertencia de siempre: **un 200 no prueba que ande**. El error boundary
también responde 200. Hay que mirar el contenido.

## Las reglas de firewall, para el día que esto sea Pro

Hoy el proyecto está en **Hobby**, donde las reglas propias del firewall no
existen; por eso toda la defensa está en el código. Lo que sigue está escrito
para pegar tal cual cuando haya plan Pro. **Vercel no cobra el tráfico que el
firewall bloquea**, así que ese día el ahorro es directo.

El orden de encendido no es negociable, y es el mismo para cada regla:

1. Crearla con `--action log`. No bloquea nada, solo registra.
2. Mirar a quién atrapó, en
   `https://vercel.com/<equipo>/<proyecto>/firewall/traffic?filter=<ruleId>`.
   Lo que se busca es que **no** haya nadie real adentro.
3. Recién entonces cambiarla a `deny`, `challenge` o `rate_limit`.

Cada comando deja el cambio en borrador: se publica con
`vercel firewall publish --yes`.

```bash
# 1. Frenar el login por fuerza bruta. Es la puerta que más barata sale de
#    atacar y la más cara de atender: cada intento es un hash de contraseña.
vercel firewall rules add "Login por fuerza bruta" \
  --condition '{"type":"path","op":"eq","value":"/ingresar"}' \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --action rate_limit \
  --rate-limit-window 300 \
  --rate-limit-requests 20 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes

# 2. El armador de cortes: es el pico de CPU más alto que se puede pedir desde
#    afuera sin tener cuenta.
vercel firewall rules add "Cortes: tope por IP" \
  --condition '{"type":"path","op":"pre","value":"/corte"}' \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --action rate_limit \
  --rate-limit-window 600 \
  --rate-limit-requests 60 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes

# 3. Los PDF: la lista de precios recorre el catálogo entero y los comprobantes
#    suben hasta 16 MB a Blob.
vercel firewall rules add "PDF y comprobantes" \
  --condition '{"type":"path","op":"pre","value":"/mi-lista-de-precios"}' \
  --or \
  --condition '{"type":"path","op":"pre","value":"/api/presupuestos"}' \
  --or \
  --condition '{"type":"path","op":"pre","value":"/api/remitos"}' \
  --action rate_limit \
  --rate-limit-window 3600 \
  --rate-limit-requests 30 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes

# 4. Los robots de entrenamiento que ignoran robots.txt. Los que citan con
#    enlace NO van acá: ésos traen visitas.
vercel firewall rules add "Robots de entrenamiento" \
  --condition '{"type":"user_agent","op":"inc","value":["GPTBot","CCBot","Bytespider","Amazonbot","Diffbot","Omgili","AI2Bot","meta-externalagent"]}' \
  --action log \
  --yes

# 5. Las sondas de siempre: WordPress, .env, .git. Nada de eso existe en este
#    sitio, así que cada pedido es ruido que igual se paga.
vercel firewall rules add "Sondas conocidas" \
  --condition '{"type":"path","op":"inc","value":["/wp-admin","/wp-login.php","/.env","/.git/config","/phpmyadmin","/xmlrpc.php"]}' \
  --action log \
  --yes
```

Dos cosas que conviene no olvidar cuando se pasen a bloquear:

- **Los contadores del limitador son por región.** Con varias regiones, el
  límite real es el configurado multiplicado por la cantidad de regiones.
- **Un user-agent que contiene «bot» no es un bot malo.** El monitor de uptime,
  el que arma la vista previa de un enlace de WhatsApp y el que audita el SEO
  también lo dicen. Por eso ninguna regla de acá matchea por substring suelto.

## Lo que queda afuera a propósito

- **Bot Protection y el firewall administrado**: son de Pro para arriba. El día
  que se pase, se encienden antes que las reglas propias.
- **Verificar el correo al registrarse**: hoy el remitente propio no está
  habilitado, así que pedirla dejaría el registro inutilizable. El límite de
  frecuencia hace el trabajo mientras tanto.
- **BotID de Vercel**: resuelve lo mismo que el límite propio pero atado a la
  plataforma. Si algún día el sitio se muda a un servidor propio —ver la rama
  `servidor-propio`—, el límite en Postgres se muda con él y esto no.
