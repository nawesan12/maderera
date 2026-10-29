-- Los datos del benchmark de la tanda 10, sobre una copia de tanda2:
--   docker exec mjbj-go-pg psql -U postgres -c "create database bench_t10 template tanda2"
--   docker exec -i mjbj-go-pg psql -U postgres -d bench_t10 < bench/tanda10/sembrar.sql
--
-- 20.000 clientes (la cartera a la que apunta una campaña), 2000 bajas,
-- 60 campañas con 2000 envíos cada una (120.000), 2000 solicitudes de acceso
-- profesional (la mitad con un CUIT que ya tiene ficha) y 200 eventos con 50
-- inscriptos cada uno.
select setseed(0.1029);

insert into customers (nombre, email, tipo, rubro, cuit)
select 'Cliente ' || i,
       'cliente' || i || '@bench.test',
       (case when i % 3 = 0 then 'profesional' else 'particular' end)::tipo_cliente,
       (array['carpintero', 'arquitecto', 'constructora', 'particular', 'otro'])[1 + i % 5],
       case when i % 2 = 0 then '20' || lpad(i::text, 8, '0') || (i % 10)::text end
from generate_series(1, 20000) i;

insert into bajas_de_correo (email, origen)
select 'cliente' || i || '@bench.test', 'enlace' from generate_series(1, 20000, 10) i;

insert into campanas (asunto, cuerpo, segmento, estado, created_at)
select 'Campaña ' || c, 'Hola\n\n- Pino\n- Fenólico\n\nhttps://mjbj.com.ar/catalogo',
       '{"tipo":"todos","rubros":[],"actividad":null}',
       (array['enviada', 'enviando', 'borrador', 'cancelada'])[1 + c % 4]::estado_campana,
       now() - (c || ' days')::interval
from generate_series(1, 60) c;

insert into campana_envios (campana_id, email, nombre, estado, enviado_at)
select c.id, 'cliente' || i || '@bench.test', 'Cliente ' || i,
       (array['enviado', 'enviado', 'enviado', 'fallido', 'omitido', 'pendiente'])[1 + (i + c.n) % 6]::estado_envio_campana, now()
from (select id, row_number() over () n from campanas) c, generate_series(1, 2000) i;

insert into professional_applications (nombre, documento_tipo, documento_numero, cuit, email, telefono, rubro, estado, created_at)
select 'Solicitante ' || i, 'cuit', '20' || lpad((i * 2)::text, 8, '0') || ((i * 2) % 10)::text,
       '20' || lpad((i * 2)::text, 8, '0') || ((i * 2) % 10)::text,
       's' || i || '@bench.test', '0223 474-3328', 'carpintero',
       (array['pendiente', 'aprobada', 'rechazada'])[1 + i % 3]::estado_solicitud, now() - (i || ' minutes')::interval
from generate_series(1, 2000) i;

insert into events (slug, titulo, inicia, cupo, precio, estado)
select 'evento-' || e, 'Evento ' || e, now() + ((e - 100) || ' days')::interval, 60, (e % 3) * 5000,
       (array['publicado', 'borrador', 'cerrado'])[1 + e % 3]::estado_evento
from generate_series(1, 200) e;

insert into event_registrations (event_id, nombre, email, estado)
select ev.id, 'Asistente ' || i, 'a' || i || '-' || ev.slug || '@bench.test',
       (array['confirmada', 'reservada', 'asistio', 'cancelada'])[1 + i % 4]::estado_inscripcion
from events ev, generate_series(1, 50) i;

analyze;
