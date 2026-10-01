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
| `correo` | **Opcional.** Las casillas propias: recibe, guarda y manda correo (docker-mailserver) | Resend para los avisos; Gmail para las casillas |
| `webmail` | **Opcional.** Leer el correo desde el navegador (Roundcube) | — |

`correo` y `webmail` solo levantan con `COMPOSE_PROFILES=correo` en
`.env.produccion`: ver [Correo propio](#14-correo-propio-opcional) antes de
encenderlos.

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
| `docker-compose.prod.yml` | Los servicios, los volúmenes y la red |
| `Caddyfile` | HTTPS, compresión, fotos, sondas bloqueadas, registro de acceso |
| `scripts/desplegar.sh` | El reemplazo del push que disparaba el deploy |
| `scripts/respaldo.sh` | El respaldo diario (lo corre el contenedor `respaldo`) |
| `scripts/mudar-base.sh` | Una vez: trae la base de Neon |
| `scripts/mudar-subidas.ts` | Una vez: trae los archivos de Vercel Blob |
| `servidor/fail2ban/` | El filtro y las cárceles de fail2ban |
| `servidor/cron/` | El crontab y el script que dispara cada tarea |
| `servidor/correo/`, `servidor/webmail/` | La configuración del correo propio (sin nada secreto) |
| `scripts/correo.sh` | Casillas, alias, DKIM, relay y los registros DNS del correo |
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
y 443 (TCP) y 443 (UDP), y con el correo propio también 25, 465, 587 y 993
(TCP). Con el `ufw` del paso 3 alcanza; el de hPanel es una
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

La excepción a propósito es el **correo propio**, que publica 25, 465, 587 y
993: son puertos que tienen que estar abiertos a internet para que el correo
funcione. Se agregan igual a `ufw` para que la lista de lo abierto esté en un
solo lugar y se lea con `ufw status`:

```bash
sudo ufw allow 25/tcp    # recibir correo de otros servidores
sudo ufw allow 465/tcp   # mandar, para los programas de correo (TLS directo)
sudo ufw allow 587/tcp   # mandar, para los programas de correo (STARTTLS)
sudo ufw allow 993/tcp   # leer (IMAP cifrado)
```

**No 143 ni 110** (IMAP y POP3 sin cifrar): no hay programa de correo actual que
los necesite, y por ahí la clave viaja legible. Tampoco 4190 (filtros) ni 11334
(el panel de Rspamd): quedan solo dentro de Docker.

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

## 14. Correo propio (opcional)

Casillas con el dominio de la maderera —`ventas@`, `administracion@`— que se
leen desde el teléfono, la PC o el navegador, y por las que salen también los
avisos y las campañas de la tienda. Corre en dos contenedores más: `correo`
(docker-mailserver: Postfix para mandar y recibir, Dovecot para leer, Rspamd
contra el spam y para firmar) y `webmail` (Roundcube).

### Antes de decidir

**Es la pieza que más mantenimiento pide de todo el servidor**, y conviene
decidirlo sabiendo eso:

- **Que el correo llegue no depende solo de nosotros.** Gmail y Outlook miran
  la reputación de la IP que manda. Una IP nueva de una VPS no tiene ninguna, y
  los primeros días parte de lo que sale puede caer en spam aunque todo esté
  bien configurado. Se corrige con tiempo y poco volumen (ver
  [Calentar la IP](#calentar-la-ip)).
- **Hostinger limita lo que sale de la VPS a 5 correos por minuto**
  (ver [su ayuda](https://www.hostinger.com/support/7854530-is-smtp-port-25-blocked-on-hostinger-vps/)).
  El puerto 25 no está bloqueado, pero 5 por minuto son 300 por hora: alcanza
  para las casillas y los avisos de pedidos, **no para una campaña a toda la
  base de clientes**. Para eso hay que mandar por un relay (ver
  [Si 5 por minuto no alcanza](#si-5-por-minuto-no-alcanza)).
- **Si el servidor se cae, no entra correo.** Los otros servidores reintentan
  durante días, así que una caída de horas no pierde nada; una máquina perdida
  sin respaldo, sí.

**La alternativa**, que es lo que haría alguien que no quiere administrar
correo: las casillas en el correo de Hostinger (Business Email) o en Google
Workspace, y la tienda mandando sus avisos por Resend como hasta ahora. Se
paga un abono por casilla y no hay nada que mantener. Las dos cosas son
compatibles con el resto de esta guía: si se elige eso, no se enciende el
perfil `correo` y listo.

### Encenderlo

1. **Puertos**: los del [paso 3](#3-firewall) para el correo, y en el firewall
   de hPanel si está activo.
2. **DNS**: los registros de [abajo](#los-registros-dns), salvo el DKIM, que
   sale en el paso 5. Esperar a que propaguen (`dig +short mail.mjbj.ar`
   tiene que dar la IP).
3. **PTR (DNS inverso)**: hPanel → VPS → Configuración → **Dirección IP** →
   *Set PTR record* junto a la IPv4, con el valor `mail.mjbj.ar`
   ([ayuda de Hostinger](https://www.hostinger.com/support/4805528-how-to-setup-reverse-dns-on-vps/)).
   Sin esto, Gmail rechaza o manda a spam casi todo.
4. En `.env.produccion`:

   ```bash
   COMPOSE_PROFILES="correo"
   ```

   y desplegar (`./scripts/desplegar.sh`). Caddy saca el certificado de
   `mail.` y el servidor de correo arranca con él.

5. **En los dos minutos siguientes, la primera casilla.** docker-mailserver se
   apaga si arranca sin ninguna (y vuelve a intentar, en bucle):

   ```bash
   scripts/correo.sh alta postmaster@mjbj.ar
   scripts/correo.sh dkim        # genera la llave y muestra el registro DNS
   ```

   Cargar el registro `mail._domainkey` que muestra `dkim`.

6. Las casillas de verdad y los alias:

   ```bash
   scripts/correo.sh alta ventas@mjbj.ar
   scripts/correo.sh alta administracion@mjbj.ar
   scripts/correo.sh alias info@mjbj.ar ventas@mjbj.ar,administracion@mjbj.ar
   ```

   `alta` sin clave genera una de 20 caracteres y la muestra **una sola vez**.
   `postmaster@` conviene redirigirlo a una casilla que alguien lea: ahí llegan
   los reportes de DMARC y los avisos de versiones nuevas.

7. **La tienda manda por acá**: una casilla para ella y, en `.env.produccion`,

   ```bash
   EMAIL_PROVIDER="smtp"
   SMTP_USUARIO="avisos@mjbj.ar"
   SMTP_CLAVE="<la que dio «alta»>"
   EMAIL_REMITENTE="Maderera Juan B. Justo <avisos@mjbj.ar>"
   ```

   **El remitente tiene que ser la misma casilla** (o un alias suyo): el
   servidor no deja que una casilla firme como otra (`SPOOF_PROTECTION`). El
   resto (`SMTP_HOST`, `SMTP_PUERTO`, `SMTP_NOMBRE_TLS`) lo pone el compose.
   Desplegar de nuevo.

8. Probar en [mail-tester.com](https://www.mail-tester.com): mandarle un correo
   desde el webmail y desde la tienda. Tiene que dar 9/10 o más; lo que falte
   lo dice con nombre y apellido (casi siempre, un registro DNS).

### Los registros DNS

`scripts/correo.sh dns` los imprime con la IP del servidor. Para `mjbj.ar`:

| Tipo | Nombre | Valor | Para qué |
|---|---|---|---|
| A | `mail` | IP de la VPS | El servidor de correo |
| A | `webmail` | IP de la VPS | El webmail |
| A | `autoconfig` | IP de la VPS | Que Thunderbird se configure solo |
| MX | `@` | `mail.mjbj.ar` (prioridad 10) | Adónde se entrega el correo para `@mjbj.ar` |
| TXT | `@` | `v=spf1 mx -all` | Solo el servidor del MX puede mandar como `@mjbj.ar` |
| TXT | `mail._domainkey` | lo da `scripts/correo.sh dkim` | La firma DKIM de lo que sale |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:postmaster@mjbj.ar; adkim=s; aspf=s` | Qué hacer con lo que no pasa SPF/DKIM, y adónde mandar los reportes |
| SRV | `_submissions._tcp` | `0 1 465 mail.mjbj.ar` | Programas que buscan solos dónde mandar |
| SRV | `_imaps._tcp` | `0 1 993 mail.mjbj.ar` | Programas que buscan solos dónde leer |

Y el **PTR** de la IP, que no es un registro del dominio sino de Hostinger
(paso 3 de arriba).

**DMARC empieza en `p=none`** a propósito: no rechaza nada, solo manda
reportes diarios a `postmaster@`. Así se ve si algo legítimo —la tienda, un
sistema de facturación, una impresora que manda correos— sale sin firmar.
Después de dos o tres semanas de reportes limpios, se endurece:
`p=quarantine` (lo que falle va a spam) y, más adelante, `p=reject`. Saltear
ese paso es la forma de que un aviso legítimo que nadie conocía empiece a
desaparecer.

**Si se usa Resend además** (avisos por Resend, casillas acá), los registros
que pide Resend se cargan aparte —usa su propio subdominio— y estos no cambian.

### Configurar los programas de correo

| | Servidor | Puerto | Cifrado | Usuario |
|---|---|---|---|---|
| Entrante (IMAP) | `mail.mjbj.ar` | 993 | SSL/TLS | la dirección completa |
| Saliente (SMTP) | `mail.mjbj.ar` | 465 | SSL/TLS | la dirección completa |

(587 con STARTTLS también anda, para los programas que lo prefieren.)

- **Thunderbird**: dirección y clave, nada más (lee `autoconfig`).
- **Outlook**: *Agregar cuenta* → *Configuración avanzada* → **IMAP**, con la
  tabla de arriba. Elegir IMAP y no «Exchange» ni «POP».
- **Gmail en el teléfono** (Android/iPhone): *Agregar cuenta* → *Otra* →
  **Personal (IMAP)**, con la tabla.
- **Mail del iPhone**: *Ajustes* → *Mail* → *Cuentas* → *Añadir* → *Otra* →
  *Añadir cuenta de correo*, tipo **IMAP**, con la tabla.
- **Navegador**: `https://webmail.mjbj.ar`.

### Calentar la IP

Los primeros 15 días, poco volumen y correos que la gente abre:

- Las casillas, uso normal desde el primer día: es correo uno a uno, el mejor
  para la reputación.
- Los avisos de la tienda, también: los espera quien los recibe.
- **Las campañas, en tandas chicas** y empezando por los clientes que más
  compran (los que van a abrirlas): unas decenas por día la primera semana y
  subir de a poco. Una campaña a dos mil direcciones desde una IP nueva es la
  forma más rápida de terminar en una lista negra.
- Mirar mail-tester y los reportes de DMARC. Si Gmail empieza a mandar a spam,
  frenar las campañas antes de seguir.

### Si 5 por minuto no alcanza

El límite de Hostinger se esquiva mandando por un **relay** (Resend, Amazon
SES, Brevo, Mailgun): el servidor de correo sigue recibiendo y guardando
todo, pero lo que sale lo entrega el relay, sin el límite y con su reputación.
Con Resend, que la tienda ya conoce:

```bash
scripts/correo.sh relay smtp.resend.com 587 resend
# pide la clave: la API key de Resend
```

Y en el DNS, los registros que pide Resend para el dominio. Los avisos de la
tienda siguen saliendo por `EMAIL_PROVIDER="smtp"`: pasan por el servidor
propio y de ahí al relay.

**Qué hace la aplicación con el límite.** Las campañas (`/admin/campanas`)
salen en tandas por la cola: con `EMAIL_PROVIDER="smtp"`, **3 por minuto** por
omisión, para dejar lugar a los avisos de pedidos y recibos dentro de los 5.
El editor dice cuánto va a tardar antes de enviar (mil direcciones son más de
cinco horas). Con el relay configurado, se sube con `CAMPANAS_POR_MINUTO` en
`.env.produccion` (por ejemplo, 60). Y lo que el servidor rechaza
temporalmente —el sexto correo del minuto— no se pierde: el aviso va a la
cola y se reintenta, y la tanda de la campaña corta y sigue tres minutos
después.

### Mantenimiento del correo

- **Actualizar la imagen**: la versión está fijada en el compose
  (`mailserver/docker-mailserver:16.0.1`) y el servidor avisa a `postmaster@`
  cuando sale una nueva. Leer las notas de la versión antes —las mayores
  cambian configuración— y después cambiar el número en el compose,
  `dc pull correo && dc up -d correo`.
- **Disco**: los buzones crecen. `scripts/correo.sh listar` dice cuánto ocupa
  cada casilla; `docker system df -v | grep correo`, el total.
- **La cola**: `scripts/correo.sh cola` tendría que estar casi vacía. Muchos
  correos esperando es la señal de que algo rebota (un relay sin clave, una
  lista negra, el límite de Hostinger).
- **Listas negras**: si de golpe todo va a spam, mirar la IP en
  [MXToolbox](https://mxtoolbox.com/blacklists.aspx).
- **Claves**: `scripts/correo.sh clave <casilla>` genera una nueva. Cuando
  alguien deja la empresa, `baja` (borra los correos: respaldarlos antes si
  hacen falta) o `clave` para que nadie más entre.
- **Baneados**: fail2ban banea una semana a quien falla 6 claves. Si quien
  quedó afuera es alguien de la maderera con la clave vieja en el teléfono,
  `scripts/correo.sh baneados` y `desbanear <ip>`.

### Por qué así, en una línea

- **docker-mailserver y no Mailcow**: un solo contenedor y configuración por
  variables; Mailcow trae una docena y pide más memoria de la que tiene una
  VPS que además corre la tienda.
- **Rspamd y sin ClamAV**: Rspamd hace en un proceso lo que antes eran cinco;
  ClamAV solo pide más de 1 GB de memoria.
- **El certificado lo saca Caddy**: el mismo que ya renueva el del sitio. El
  correo lo lee de su volumen y se recarga solo cuando cambia (probado).
- **Roundcube sin root, con su propia base SQLite**: no comparte nada con la
  tienda.
- **El fail2ban del correo no banea redes privadas**: el webmail entra a
  Dovecot desde una IP interna, y banearla dejaría el webmail afuera para
  todos. El webmail se defiende solo: 3 intentos por minuto por IP real.
- **Perfil `correo`**: el servidor anda igual sin él, y apagarlo es sacar una
  línea de `.env.produccion`.

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
| El correo | `dc logs -f correo`; la cola, `scripts/correo.sh cola`; baneados, `scripts/correo.sh baneados` |
| El webmail | `dc logs -f webmail` y `/var/log/caddy/webmail.log` |
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

**Con el correo propio encendido, el respaldo también empaqueta el correo**:
`respaldos/correo-<fecha>.tar.gz`, con los buzones, las casillas con sus
claves y la llave DKIM, y sube a rclone junto con la base. Sin la llave DKIM,
un servidor reinstalado tendría que cambiar el registro DNS. Para restaurarlo,
con el correo apagado (`dc stop correo`):

```bash
docker run --rm -v mjbj_correo_buzones:/correo/buzones -v mjbj_correo_estado:/correo/estado \
  -v mjbj_correo_config:/correo/config -v ~/maderera/respaldos:/r alpine \
  tar -xzf /r/correo-<fecha>.tar.gz -C /correo
dc start correo
```

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
- Con el correo propio, ver además [su mantenimiento](#mantenimiento-del-correo).

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
