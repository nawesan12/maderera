# Mudar la plataforma a un servidor propio (Hostinger)

> Documento interno del PRESTADOR. Rama `vps-hostinger`, preparada el
> 1/10/2026 y **sin aplicar**: hoy el sitio sigue en Vercel con la base en Neon
> y las fotos en Vercel Blob. Esto es el camino para mudarlo entero a una VPS
> de Hostinger (KVM, Ubuntu 24.04, Docker), paso por paso y en orden.

## Qué cambia

Hoy son tres servicios: **Vercel** arma y sirve el sitio, **Neon** guarda la
base y **Vercel Blob** guarda lo que se sube desde el panel. En el servidor
propio todo eso corre en una sola máquina, en cinco contenedores:

| Contenedor | Qué hace | Reemplaza a |
|---|---|---|
| `db` | Postgres 17 | Neon |
| `app` | La aplicación (Next, empaquetado `standalone`) | Vercel |
| `web` | Caddy: HTTPS con certificado automático, comprime, sirve las fotos | El CDN de Vercel |
| `respaldo` | Un volcado diario de la base, con copia fuera de la máquina opcional | Los respaldos de Neon |
| `cron` | Llama a las tareas programadas a horario (`servidor/cron/crontab`) | Nada: en Vercel no había |

Y un sexto que no queda corriendo: `migrador`, que aplica las migraciones en
cada despliegue y corre los scripts de mudanza.

**Lo que se paga a cambio no es plata, es trabajo.** Vercel y Neon se encargan
solos de las actualizaciones, del certificado, de que el disco no se llene y de
los respaldos. Acá el certificado y los respaldos están automatizados, pero
alguien tiene que mirar de vez en cuando que sigan andando (ver
[Mantenimiento](#mantenimiento)).

## Qué hay en el repositorio

| Archivo | Para qué |
|---|---|
| `Dockerfile` | La imagen de la aplicación y la del migrador |
| `docker-compose.prod.yml` | Los seis servicios, los volúmenes y la red |
| `Caddyfile` | HTTPS, compresión, fotos, sondas bloqueadas, registro de acceso |
| `scripts/desplegar.sh` | El reemplazo del push que disparaba el deploy |
| `scripts/respaldo.sh` | El respaldo diario (lo corre el contenedor `respaldo`) |
| `scripts/mudar-base.sh` | Una vez: trae la base de Neon |
| `scripts/mudar-subidas.ts` | Una vez: trae los archivos de Vercel Blob |
| `servidor/fail2ban/` | El filtro y las cárceles de fail2ban |
| `servidor/cron/` | El crontab y el script que dispara cada tarea |
| `.github/workflows/desplegar.yml` | Desplegar desde GitHub, apagado por omisión |

## Antes de empezar

- Una VPS de Hostinger con **Ubuntu 24.04**. La KVM 2 (2 vCPU, 8 GB) sobra; la
  KVM 1 (4 GB) alcanza. Lo más pesado es el build, no el tráfico.
- Acceso al DNS del dominio. En esta guía el dominio es `mjbj.ar`; donde diga
  eso va el real.
- La connection string **directa** de Neon (sin `-pooler` en el host). Está en
  `.env.local` como `DATABASE_URL_UNPOOLED`.
- Acceso al proyecto en Vercel y al repositorio en GitHub.
- Todos los valores de las variables que hoy están cargadas en Vercel:
  `vercel env pull .env.vercel --environment=production` los baja a un archivo
  (que **no** se commitea).

En los comandos, `<IP>` es la IP pública de la VPS y `mjbj` el usuario que se
crea en el paso 2.

---

## 1. Crear la VPS

En hPanel → VPS: sistema operativo **Ubuntu 24.04** (la imagen «limpia»; la que
viene con Docker también sirve, y entonces el paso 5 ya está hecho). Al
crearla, cargar la **clave pública SSH** de la máquina desde la que se va a
administrar (`~/.ssh/id_ed25519.pub`); si no hay, `ssh-keygen -t ed25519`.

Si en hPanel está activado el firewall de la VPS, tiene que dejar pasar 22, 80
y 443 (TCP) y 443 (UDP). Con el `ufw` del paso 3 alcanza; el de hPanel es una
segunda capa opcional.

## 2. Un usuario que no sea root, y SSH solo con llave

```bash
ssh root@<IP>

adduser mjbj                      # pide una contraseña: es la de sudo, guardarla
usermod -aG sudo mjbj
rsync --archive --chown=mjbj:mjbj ~/.ssh /home/mjbj
```

**Antes de cerrar la sesión de root**, en otra terminal comprobar que entra:

```bash
ssh mjbj@<IP>
sudo whoami                       # tiene que decir root
```

Recién entonces se apaga el ingreso con contraseña y el de root. En Ubuntu 24.04
la configuración va en un archivo aparte; el nombre empieza con `00-` porque
para `sshd` **gana el primer valor que lee**, y Hostinger deja un
`50-cloud-init.conf` que puede habilitar contraseñas:

```bash
sudo tee /etc/ssh/sshd_config.d/00-mjbj.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sudo sshd -t && sudo systemctl restart ssh
```

Y de nuevo, desde otra terminal, `ssh mjbj@<IP>` antes de cerrar la que está
abierta.

## 3. Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp           # HTTP/3
sudo ufw enable
sudo ufw status verbose
```

**Docker se saltea `ufw` para los puertos que publica.** Es un comportamiento
conocido y es la razón de dos decisiones del compose: la base publica su puerto
solo en `127.0.0.1` (invisible desde afuera) y la aplicación no publica ninguno
(solo la alcanza Caddy por la red interna). Si algún día se agrega un servicio,
nunca publicarlo como `"puerto:puerto"` a secas.

## 4. Actualizaciones automáticas

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades     # responder «Sí»
```

Para que los parches del kernel se apliquen sin que nadie entre a reiniciar,
reinicio automático de madrugada, fuera del horario del local:

```bash
sudo tee /etc/apt/apt.conf.d/52mjbj-reinicio <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "05:00";
EOF
```

Los contenedores tienen `restart: unless-stopped`: vuelven solos después del
reinicio.

## 5. Docker

El de los repositorios de Docker, no el de Ubuntu (que viene viejo y sin el
plugin de compose):

```bash
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker mjbj
```

Salir y volver a entrar para que tome el grupo, y comprobar con
`docker run --rm hello-world`. Pertenecer al grupo `docker` equivale a ser root
en la máquina: solo `mjbj` va ahí.

Para que los registros de los contenedores no llenen el disco:

```bash
sudo tee /etc/docker/daemon.json <<'EOF'
{ "log-driver": "local", "log-opts": { "max-size": "20m", "max-file": "5" } }
EOF
sudo systemctl restart docker
```

## 6. El DNS

En el proveedor del dominio:

| Tipo | Nombre | Valor | TTL |
|---|---|---|---|
| A | `@` | `<IP>` | 300 |
| A | `www` | `<IP>` | 300 |

**Sin registro AAAA** (IPv6), o borrarlo si existe. Docker no tiene IPv6
activado por omisión: un visitante que entra por IPv6 llega a Caddy con la IP
interna de Docker en vez de la suya, y entonces el límite de frecuencia y
fail2ban ven a todos esos visitantes como uno solo.

**El orden importa.** Caddy pide el certificado apenas arranca, y si el dominio
todavía apunta a Vercel, Let's Encrypt lo rechaza; después de cinco rechazos
hay que esperar una hora. Para probar todo **antes** de cambiar el dominio
principal, la forma cómoda es un subdominio de prueba: un registro A
`nuevo.mjbj.ar → <IP>`, y `DOMINIO="nuevo.mjbj.ar"` en el paso 8. El día de la
mudanza se cambia `DOMINIO` y se apunta el dominio principal (paso 12).

Bajar el TTL a 300 **un día antes** de la mudanza hace que el cambio se
propague en minutos y no en horas.

## 7. Traer el código

El servidor necesita leer el repositorio. Con una llave propia, de solo
lectura:

```bash
ssh-keygen -t ed25519 -C "vps-mjbj" -f ~/.ssh/id_github -N ""
cat ~/.ssh/id_github.pub
```

En GitHub → el repositorio → Settings → Deploy keys → Add deploy key: pegar la
pública, **sin** permiso de escritura. Después:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/id_github
EOF
git clone git@github.com:nawesan12/maderera.git ~/maderera
cd ~/maderera
git checkout main
```

## 8. El entorno

```bash
cd ~/maderera
cp .env.example .env.produccion
chmod 600 .env.produccion
nano .env.produccion
```

Lo que cambia respecto del ejemplo (el resto, con los valores de Vercel):

| Variable | Valor |
|---|---|
| `APP_URL` | `https://mjbj.ar` — **obligatoria**: sin ella el servidor no arranca |
| `BETTER_AUTH_URL` | `https://mjbj.ar` |
| `BETTER_AUTH_SECRET` | **el mismo de Vercel**: si cambia, se cierran todas las sesiones |
| `APP_ENV` | `production` |
| `SEO_INDEXAR` | `si` o `no`, **siempre declarada**: se hornea en el build |
| `DOMINIO` | `mjbj.ar` (o el subdominio de prueba) |
| `POSTGRES_USER` / `POSTGRES_DB` | `mjbj` / `mjbj` |
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` (solo letras y números: va adentro de una URL) |
| `TAREAS_SECRETO` | `openssl rand -base64 32` — **obligatoria**: sin ella el compose no levanta |
| `BLOB_READ_WRITE_TOKEN` | **vacía**: con token, las fotos nuevas seguirían yendo a Vercel |
| `DATABASE_URL` | se ignora: la arma el compose |
| `RCLONE_REMOTE` | ver [Respaldos](#respaldos) |

`APP_URL`, `APP_ENV` y `SEO_INDEXAR` llegan también al build: `robots.txt`, las
canónicas y el `metadataBase` se arman ahí. Si se cambian, hay que volver a
desplegar, no alcanza con reiniciar.

**`.env.produccion` no va al repositorio** (`.gitignore`) **ni a la imagen**
(`.dockerignore`).

Para no escribir el compose entero cada vez:

```bash
echo "alias dc='docker compose --env-file ~/maderera/.env.produccion -f ~/maderera/docker-compose.prod.yml'" >> ~/.bashrc
source ~/.bashrc
```

El resto de la guía usa `dc`.

### El certificado de ARCA

Cuando la clienta lo tramite, son dos archivos que van a `secretos/arca/`, **no**
a `.env.produccion`:

```bash
mkdir -p ~/maderera/secretos/arca
# copiarlos desde la máquina propia:
#   scp arca.crt arca.key mjbj@<IP>:~/maderera/secretos/arca/
sudo chown 1001:1001 ~/maderera/secretos/arca/arca.*
sudo chmod 400 ~/maderera/secretos/arca/arca.*
```

El compose monta esa carpeta en solo lectura en `/run/secrets/arca/` y ya
declara las rutas (`ARCA_CERTIFICADO_ARCHIVO`, `ARCA_CLAVE_PRIVADA_ARCHIVO`). El
dueño `1001` es el usuario con que corre la aplicación adentro del contenedor.
Nunca entran en la imagen. Mientras no estén, la facturación sigue con el
proveedor interno, igual que hoy, y `/admin/arca` dice qué falta.

## 9. fail2ban

```bash
sudo apt install -y fail2ban
sudo mkdir -p /var/log/caddy && sudo touch /var/log/caddy/acceso.log
sudo cp ~/maderera/servidor/fail2ban/filter.d/caddy-sondas.conf /etc/fail2ban/filter.d/
sudo cp ~/maderera/servidor/fail2ban/jail.d/mjbj.local /etc/fail2ban/jail.d/
sudo systemctl enable --now fail2ban
sudo systemctl restart fail2ban
sudo fail2ban-client status
```

Dos cárceles: `sshd` (intentos de entrar por SSH) y `caddy-sondas`, que lee el
registro de Caddy y banea por un día a quien pide tres veces en diez minutos
rutas como `/wp-login.php` o `/.env`. Esas rutas Caddy ya las contesta con 404
sin despertar a la aplicación; el ban es para que el robot deje de gastar
conexiones.

El ban va a la cadena `DOCKER-USER` y no a `INPUT` —el comentario en
`mjbj.local` explica por qué—. Para comprobar el filtro contra el registro
real: `sudo fail2ban-regex /var/log/caddy/acceso.log caddy-sondas`.

## 10. Mudar los datos

**Con el sitio viejo quieto.** Todo lo que se venda en Vercel después del
volcado no llega a la base nueva. Hacerlo fuera del horario del local, y avisar.

```bash
cd ~/maderera

# La base: pregunta dos veces antes de tocar nada.
NEON_URL='postgresql://…@ep-….neon.tech/neondb?sslmode=require' ./scripts/mudar-base.sh

# Los archivos de Vercel Blob. Primero ver qué haría:
dc --profile herramientas build migrador
dc --profile herramientas run --rm migrador node_modules/.bin/tsx scripts/mudar-subidas.ts --probar
# y después hacerlo:
dc --profile herramientas run --rm migrador node_modules/.bin/tsx scripts/mudar-subidas.ts
```

`mudar-subidas.ts` no tiene una lista de columnas: recorre todas las de texto y
JSON de la base buscando URLs de Blob, baja cada archivo al volumen de subidas y
reescribe la fila a `/subidas/<nombre>`. Se puede correr las veces que haga
falta; si alguna descarga falla, lo dice y la próxima corrida la reintenta.

**No dar de baja Vercel Blob** hasta que `--probar` diga «No hay URLs de Vercel
Blob en la base».

Si es una instalación sin datos previos (una copia de prueba), este paso se
saltea: el primer despliegue crea las tablas.

## 11. Primer despliegue

```bash
cd ~/maderera
./scripts/desplegar.sh --sin-pull
```

Hace, en orden: levanta la base, construye las imágenes (unos cinco minutos la
primera vez), **respalda antes de migrar**, migra en un contenedor de un solo
uso y recién ahí levanta la aplicación nueva y espera a que el chequeo de salud
dé bien. Si la migración falla, corta y la aplicación anterior sigue como
estaba. Al final levanta Caddy y el respaldo.

### Comprobar que anda

**Un 200 no prueba que ande**: el error boundary también responde 200. Hay que
mirar el contenido.

```bash
curl -sI https://mjbj.ar | head -20       # 200, Strict-Transport-Security, X-Frame-Options
curl -s https://mjbj.ar/robots.txt        # con SEO_INDEXAR=no tiene que decir Disallow: /
curl -s https://mjbj.ar | grep -o '<title>[^<]*'
curl -sI https://mjbj.ar/wp-login.php     # 404, y en el registro de Caddy
dc ps                                      # app «healthy»
```

Y en el navegador, con cada rol: entrar al panel, abrir el catálogo, **subir una
foto de producto y verla en el catálogo** (prueba el volumen, Caddy y la
optimización de imágenes de una vez), abrir el mostrador.

## 12. Cambiar el dominio

Si se probó con un subdominio:

1. `DOMINIO`, `APP_URL` y `BETTER_AUTH_URL` en `.env.produccion` pasan al
   dominio real.
2. En el DNS, el registro A de `@` y el de `www` pasan a `<IP>` (borrar los
   que apuntaban a Vercel).
3. `./scripts/desplegar.sh --sin-pull` (las URLs se hornean en el build).
4. `dc logs -f web` hasta ver `certificate obtained successfully` para los dos
   nombres.

Y lo que apunta al sitio desde afuera:

- **Mercado Pago** → Tus integraciones → Webhooks:
  `https://mjbj.ar/api/pagos/webhook`. Las preferencias nuevas ya mandan la
  URL correcta (sale de `APP_URL`).
- **Meta** → la app de WhatsApp → Webhooks: `https://mjbj.ar/api/whatsapp/webhook`.
- **El agente del taller**, en la PC del aserradero: `MJBJ_URL` (ver
  `agente-taller/README.md`).
- **Resend**: no cambia (es por dominio de correo, no del sitio).

## 13. Desconectar Vercel

Para que un push a `main` no salga a dos lados:

1. Vercel → proyecto `maderera` → Settings → Git → **Disconnect**. Así un push
   ya no dispara un deploy allá.
2. Settings → Domains: quitar el dominio, para que Vercel no lo reclame.
3. **Dejar Neon y Vercel Blob un par de semanas**, sin borrar: son la vuelta
   atrás. Pasado ese tiempo y con el respaldo diario funcionando
   ([Respaldos](#respaldos)), se borran el proyecto, el almacenamiento de Blob y
   la base de Neon.

Desde ahora, desplegar es entrar por SSH y correr `./scripts/desplegar.sh`
(trae `main` solo). O, sin terminal, el workflow de GitHub: ver
`.github/workflows/desplegar.yml`, que explica cómo habilitarlo y cómo hacer
que despliegue en cada push.

---

## Volver a la versión anterior

**Si la versión nueva anda mal** (el código, no la base). `desplegar.sh` guarda
la imagen que estaba corriendo como `mjbj-app:anterior`:

```bash
docker image tag mjbj-app:anterior mjbj-app:latest
dc up -d --no-deps --no-build app
```

Ojo: si la versión nueva traía una migración, la base ya quedó migrada y el
código viejo corre contra el esquema nuevo. Las migraciones que solo agregan
(columnas, tablas) lo aguantan; las que borran o renombran, no. En ese caso,
además:

**Si hay que volver la base atrás.** Antes de cada migración queda un volcado
en `respaldos/antes-de-migrar-<fecha>.dump`. Se pierde lo que se haya escrito
desde ese momento:

```bash
dc stop app
dc exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;"'
dc exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < respaldos/antes-de-migrar-<fecha>.dump
docker image tag mjbj-app:anterior mjbj-app:latest
dc up -d --no-deps --no-build app
```

**Si hay que volver a Vercel** (los primeros días, mientras Neon siga): volver
a conectar Git en Vercel, devolverle el dominio y apuntar el DNS a Vercel. Lo
que se haya escrito en el servidor después de la mudanza **no** está en Neon:
hay que volcarlo antes con `pg_dump` y cargarlo allá.

## Dónde mirar

| Qué | Dónde |
|---|---|
| La aplicación | `dc logs -f app` (los errores de Next, los `[arranque]`) |
| Caddy, certificados | `dc logs -f web` |
| Cada pedido | `/var/log/caddy/acceso.log` (JSON; `client_ip` es la IP real) |
| El respaldo | `dc logs respaldo` y `ls -lh ~/maderera/respaldos` |
| Las tareas programadas | `dc logs cron` (una línea por corrida; la de cada minuto, solo si hizo algo) |
| La cola de trabajos | `select tipo, estado, intentos, ultimo_error from trabajos where estado <> 'hecho'` |
| Los baneados | `sudo fail2ban-client status caddy-sondas` |
| El estado | `dc ps` (la app tiene que decir `healthy`) |
| El disco | `df -h` y `docker system df` |
| Docker mismo | `journalctl -u docker` |

Si la aplicación no arranca, lo primero es `dc logs app`: si falta `APP_URL` el
servidor no levanta a propósito y lo dice en una línea que empieza con
`[arranque]`.

## Respaldos

El servicio `respaldo` se fija una vez por hora si ya está el volcado del día
y, pasadas las 3 de la mañana, lo hace: `respaldos/mjbj-<fecha>.dump`. Antes de
darlo por bueno comprueba que se pueda leer. Se guardan **14 días**
(`RESPALDO_DIAS`), junto con los `antes-de-migrar-*` que deja cada despliegue.

**Un respaldo en el mismo disco no sobrevive a que se pierda el disco.** La
copia fuera de la máquina se configura una vez con rclone (Backblaze B2, Google
Drive, cualquier S3):

```bash
docker run --rm -it -v ~/maderera/secretos/rclone:/config/rclone rclone/rclone config
# crear un destino, por ejemplo «b2»; después en .env.produccion:
#   RCLONE_REMOTE="b2:mjbj-respaldos"
dc up -d respaldo
dc logs -f respaldo     # al día siguiente tiene que decir «copiado a b2:…»
```

Allá se guardan 90 días (`RCLONE_DIAS`).

**Probar una restauración de vez en cuando.** Un respaldo que nunca se
restauró no se sabe si sirve. Contra una base aparte, sin tocar la de verdad:

```bash
dc exec -T db createdb -U mjbj prueba_restauracion
dc exec -T db pg_restore -U mjbj -d prueba_restauracion --no-owner < respaldos/mjbj-<fecha>.dump
dc exec -T db psql -U mjbj -d prueba_restauracion -c "select count(*) from products"
dc exec -T db dropdb -U mjbj prueba_restauracion
```

Las facturas emitidas son documentación fiscal: perderlas es un problema de la
clienta ante ARCA.

## Mantenimiento

Una vez por mes, cinco minutos:

- `df -h`: el disco por debajo del 80 %.
- `ls -lh ~/maderera/respaldos`: el de ayer está y pesa parecido a los demás.
- `dc ps`: todo `Up`, la app `healthy`.
- `docker image prune -f` y `docker builder prune -f --filter until=720h`: los
  builds viejos ocupan disco.
- Imágenes de base: `dc pull db web respaldo && dc up -d db web respaldo`
  (actualiza Postgres 17 y Caddy 2 dentro de la misma versión mayor).

Las actualizaciones del sistema y el certificado son automáticos.

## Lo que se gana respecto de Vercel

En Vercel se pagaba por cada uso, y varias cosas se recortaron por eso. Acá el
costo es fijo y el criterio cambia: no saturar una sola máquina.

- **Tareas programadas** (`lib/tareas`, contenedor `cron`). Cada minuto se
  procesa la cola; cada hora deja de verse lo que venció en la portada (un
  banner «hasta el 30/9» ya no sigue el 1/10); a las 7 salen los
  recordatorios de eventos, el parte del día al panel y la limpieza de tablas
  que crecían solas; los lunes, las reseñas de Google y los candidatos a baja.
  Cada una corre **una vez por período**: el candado está en
  `tareas_corridas`, así que reiniciar el cron o dispararla a mano no repite
  nada. Para probarla a mano:
  `dc exec cron sh /tarea.sh diaria`.
- **Una cola con reintentos** (`lib/cola`). Los webhooks de Mercado Pago y de
  WhatsApp guardan el trabajo y contestan; si el proceso se reinicia en ese
  segundo —un despliegue— el pago o el mensaje no se pierden. Lo que falla se
  reintenta con espera creciente, y lo que agota los intentos avisa al panel.
- **Tiempo real** (`lib/vivo`, con `PLATAFORMA=vps`). Postgres avisa con
  `LISTEN/NOTIFY` y el panel lo recibe por SSE: la bandeja de WhatsApp, el
  taller y los pedidos web nuevos aparecen sin recargar, y el mostrador se
  entera de un precio nuevo al instante. Una sola conexión escucha por proceso.

## Lo que se pierde respecto de Vercel

- **El CDN.** `/catalogo` y `/stock` mandan `Vercel-CDN-Cache-Control` para que
  la red de Vercel guarde la página cinco minutos; Caddy no guarda copias, así
  que acá esas dos páginas se arman en cada pedido. No es caro: los datos de
  abajo salen de `unstable_cache` con etiqueta y no van a la base. Si algún día
  hace falta, poner Cloudflare adelante: lee `CDN-Cache-Control`, que ya se
  manda (y entonces hay que declararlo en `trusted_proxies` del `Caddyfile`).
- **Las vistas previas por rama.** Cada cambio se prueba en local, o en una
  segunda copia del servidor con `APP_ENV="staging"` y `SEO_INDEXAR="no"`.
- **La optimización de imágenes la hace la propia máquina.** El resultado queda
  en el volumen `next_cache`, que sobrevive a los despliegues.
- **Un despliegue corta unos segundos.** El contenedor viejo termina lo que
  tiene en curso —hasta 30 segundos, incluido lo pendiente de `after()`— y
  arranca el nuevo. Además, una pestaña que quedó abierta desde antes del
  despliegue puede dar «Failed to find Server Action» en el próximo envío de un
  formulario: la clave de las acciones cambia en cada build. Se arregla
  recargando.

## Por qué cada decisión, en una línea

- **El build necesita la base**: Next prerenderiza páginas que leen ajustes y
  sucursales. Por eso la base publica `127.0.0.1:5432` y el build usa la red
  del host.
- **El migrador es una imagen aparte**: `drizzle-kit` necesita sus
  dependencias, que el empaquetado `standalone` deja afuera.
- **Las fotos en un volumen y no en `public/`**: con `standalone`, Next solo
  sirve lo que había en `public/` al arrancar, y la imagen se reconstruye en
  cada despliegue. Caddy las sirve directo; `next/image` las pide a
  `app/api/subidas/[archivo]` (ver `next.config.ts`).
- **Las cabeceras de seguridad solo en `next.config.ts`**: Caddy no agrega
  ninguna, salvo en `/subidas/`, que no pasa por Next.
- **La IP del cliente**: Caddy reemplaza el `X-Forwarded-For` que trae el
  cliente y la aplicación no tiene puerto publicado; el límite de frecuencia de
  `lib/limites` cuenta contra la IP real.
- **`DATABASE_SSL=off`**: la base está en la misma red privada y su Postgres no
  admite SSL. `DATABASE_POOL_MAX` permite subir las diez conexiones sin tocar
  código.
- **`APP_ENV`**: lo que en Vercel era `VERCEL_ENV`. Decide si se indexa.
