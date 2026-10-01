<?php
/*
 * La configuración propia del webmail, sumada a la que arma la imagen con las
 * variables del compose.
 */

$config['product_name'] = 'Correo · Maderera Juan B. Justo';
$config['language'] = 'es_AR';
$config['timezone'] = 'America/Argentina/Buenos_Aires';

/*
 * Roundcube está detrás de Caddy: sin esto, para él todos los usuarios
 * vienen de la IP del proxy y el límite de intentos de abajo bloquearía a
 * todos juntos. Se confía en el `X-Forwarded-For` solo cuando lo manda una IP
 * de las redes privadas de Docker, que es donde está Caddy.
 */
$config['proxy_whitelist'] = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

/*
 * Tres intentos fallidos por minuto por IP. Es la defensa del webmail contra
 * quien prueba claves: el fail2ban del servidor de correo no puede hacerlo,
 * porque ve todas las entradas del webmail como una sola IP
 * (ver servidor/correo/fail2ban-jail.cf).
 */
$config['login_rate_limit'] = 3;

// La sesión se cierra sola después de una hora sin uso: es la PC del local.
$config['session_lifetime'] = 60;

/*
 * Roundcube se conecta por el nombre público (`mail.<dominio>`), que dentro
 * de Docker es un alias del contenedor `correo`: así el certificado coincide
 * y la conexión interna también va cifrada y verificada.
 */
$config['imap_conn_options'] = ['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]];
$config['smtp_conn_options'] = ['ssl' => ['verify_peer' => true, 'verify_peer_name' => true]];
