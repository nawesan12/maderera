-- La bandeja del benchmark: 1500 conversaciones con 20 mensajes cada una
-- (30.000), la mitad con ficha de cliente.
--   docker exec -i mjbj-go-pg psql -U postgres -d bench_t9 < bench/tanda9/sembrar.sql
insert into customers (nombre, telefono)
select 'Cliente ' || g, '223 ' || (5000000 + g)::text from generate_series(1, 750) g;

insert into whatsapp_conversaciones (wa_jid, display_name, customer_id, ultimo_mensaje_at, ultimo_mensaje_preview, ultimo_entrante_at, no_leidos)
select '549223' || (5000000 + g)::text || '@s.whatsapp.net', 'Persona ' || g,
       (select id from customers where telefono = '223 ' || (5000000 + g)::text),
       now() - (g || ' minutes')::interval, 'Último mensaje ' || g,
       now() - (g || ' minutes')::interval, 0
  from generate_series(1, 1500) g;

insert into whatsapp_mensajes (conversacion_id, direccion, wa_message_id, tipo, cuerpo, estado, origen, ocurrido_at)
select c.id, case when m % 2 = 0 then 'entrante'::direccion_mensaje else 'saliente'::direccion_mensaje end,
       'wamid.BENCH' || c.wa_jid || '.' || m, 'text', 'Mensaje ' || m || ' de la charla, con un texto de largo normal para la bandeja.',
       'entregado', case when m % 2 = 0 then 'cliente' else 'panel' end, now() - ((40 - m) || ' minutes')::interval
  from whatsapp_conversaciones c, generate_series(1, 20) m;

insert into whatsapp_sesion (proveedor) select 'demo' where not exists (select 1 from whatsapp_sesion);
analyze;
