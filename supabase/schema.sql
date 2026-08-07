-- Fuvarszervező V48 – Supabase adatbázis
-- Futtasd le a Supabase SQL Editorban egyben.

create extension if not exists pgcrypto;

create table if not exists public.allowed_users (
  email text primary key,
  role text not null check (role in ('admin','driver','test')),
  driver_key text check (driver_key in ('mario','patrik','martin') or driver_key is null),
  vehicle_id text,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.allowed_users(email,role,driver_key,vehicle_id,display_name,active) values
  ('szabo.sandor82@gmail.com','admin',null,null,'Szabó Sándor',true),
  ('szabo.sandor@stand98.hu','test',null,null,'Teszt felhasználó',true),
  ('schmidt.martin@stand98.hu','driver','martin','v-martin','Schmidt Martin',true),
  ('polgar.patrik@stand98.hu','driver','patrik','v-patrik','Polgár Patrik',true),
  ('berki.mario@stand98.hu','driver','mario','v-mario','Berki Márió',true)
on conflict (email) do update set
  role=excluded.role, driver_key=excluded.driver_key, vehicle_id=excluded.vehicle_id,
  display_name=excluded.display_name, active=excluded.active;

create or replace function public.current_email() returns text
language sql stable as $$ select lower(coalesce(auth.jwt()->>'email','')) $$;
create or replace function public.current_role() returns text
language sql stable security definer set search_path=public as $$
  select role from public.allowed_users where email=public.current_email() and active=true
$$;
create or replace function public.current_driver_key() returns text
language sql stable security definer set search_path=public as $$
  select driver_key from public.allowed_users where email=public.current_email() and active=true
$$;
create or replace function public.app_today() returns date
language sql stable as $$ select timezone('Europe/Budapest',now())::date $$;

alter table public.allowed_users enable row level security;
drop policy if exists allowed_users_read on public.allowed_users;
create policy allowed_users_read on public.allowed_users for select to authenticated
using (active=true);

create table if not exists public.orders (
  id text primary key,
  schedule_date date,
  vehicle_id text,
  driver_key text check (driver_key in ('mario','patrik','martin') or driver_key is null),
  order_no text not null default '',
  project_name text not null default '',
  sequence integer not null default 999,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default public.current_email()
);
create index if not exists orders_date_driver_idx on public.orders(schedule_date,driver_key,sequence);

create or replace function public.can_access_order(p_order_id text) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.orders o
    where o.id=p_order_id and (
      public.current_role()='admin'
      or (public.current_role()='test' and o.schedule_date between public.app_today() and public.app_today()+1)
      or (public.current_role()='driver' and o.driver_key=public.current_driver_key() and o.schedule_date between public.app_today() and public.app_today()+1)
    )
  )
$$;

alter table public.orders enable row level security;
drop policy if exists orders_read on public.orders;
drop policy if exists orders_admin_insert on public.orders;
drop policy if exists orders_admin_update on public.orders;
drop policy if exists orders_admin_delete on public.orders;
create policy orders_read on public.orders for select to authenticated
using (
  public.current_role()='admin'
  or (public.current_role()='test' and schedule_date between public.app_today() and public.app_today()+1)
  or (public.current_role()='driver' and driver_key=public.current_driver_key() and schedule_date between public.app_today() and public.app_today()+1)
);
create policy orders_admin_insert on public.orders for insert to authenticated
with check (public.current_role()='admin');
create policy orders_admin_update on public.orders for update to authenticated
using (public.current_role()='admin') with check (public.current_role()='admin');
create policy orders_admin_delete on public.orders for delete to authenticated
using (public.current_role()='admin');

create or replace function public.restricted_payload_update(p_existing jsonb,p_incoming jsonb)
returns jsonb
language plpgsql immutable as $$
declare v_result jsonb := coalesce(p_existing,'{}'::jsonb);
begin
  -- A sofőr csak a tételekhez és a szállítólevél-metaadatokhoz nyúlhat.
  if coalesce(p_incoming,'{}'::jsonb) ? 'items' then
    v_result := jsonb_set(v_result,'{items}',coalesce(p_incoming->'items','[]'::jsonb),true);
  end if;
  if coalesce(p_incoming,'{}'::jsonb) ? 'deliveryReports' then
    v_result := jsonb_set(v_result,'{deliveryReports}',coalesce(p_incoming->'deliveryReports','[]'::jsonb),true);
  end if;
  if coalesce(p_incoming,'{}'::jsonb) ? 'completed' then
    v_result := jsonb_set(v_result,'{completed}',coalesce(p_incoming->'completed','false'::jsonb),true);
  end if;
  if coalesce(p_incoming,'{}'::jsonb) ? 'completedAt' then
    v_result := jsonb_set(v_result,'{completedAt}',coalesce(p_incoming->'completedAt','""'::jsonb),true);
  end if;
  return v_result;
end $$;

create or replace function public.update_own_order_payload(p_order_id text,p_payload jsonb)
returns public.orders
language plpgsql security definer set search_path=public as $$
declare
  v_order public.orders;
  v_role text := public.current_role();
  v_payload jsonb;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'A fuvar nem található.'; end if;
  if v_role='driver' and not (v_order.driver_key=public.current_driver_key() and v_order.schedule_date between public.app_today() and public.app_today()+1) then
    raise exception 'Ehhez a fuvarhoz nincs jogosultság.';
  elsif v_role='test' and not (v_order.schedule_date between public.app_today() and public.app_today()+1) then
    raise exception 'A tesztfelhasználó csak a mai és holnapi fuvarokat módosíthatja.';
  elsif v_role not in ('driver','test','admin') then
    raise exception 'Nincs jogosultság.';
  end if;

  if v_role='admin' then
    v_payload := coalesce(p_payload,v_order.payload);
  else
    v_payload := public.restricted_payload_update(v_order.payload,p_payload);
  end if;
  v_payload := jsonb_set(
    jsonb_set(
      jsonb_set(v_payload,'{id}',to_jsonb(v_order.id),true),
      '{vehicleId}',to_jsonb(coalesce(v_order.vehicle_id,'')),true
    ),
    '{scheduleDate}',to_jsonb(coalesce(v_order.schedule_date::text,'')),true
  );

  update public.orders set
    payload=v_payload,
    updated_at=now(), updated_by=public.current_email()
  where id=p_order_id returning * into v_order;
  return v_order;
end $$;
grant execute on function public.update_own_order_payload(text,jsonb) to authenticated;

-- A sofőrök tétel- és hátralékmódosításainak kötegelt, szerveroldalon korlátozott mentése.
-- Új fuvar csak egy már hozzáférhető rendelésből áthelyezett hátralékos tételekhez jöhet létre.
create or replace function public.sync_own_orders(p_orders jsonb)
returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_entry jsonb;
  v_id text;
  v_role text := public.current_role();
  v_existing public.orders;
  v_source public.orders;
  v_target_date date;
  v_vehicle_id text;
  v_driver_key text;
  v_payload jsonb;
  v_count integer := 0;
begin
  if v_role not in ('driver','test') then raise exception 'Ez a művelet csak mobil felhasználónak engedélyezett.'; end if;
  for v_entry in select value from jsonb_array_elements(coalesce(p_orders,'[]'::jsonb)) loop
    v_id := nullif(v_entry->>'id','');
    if v_id is null then continue; end if;
    select * into v_existing from public.orders where id=v_id for update;
    if found then
      -- A helyi állapotban átmenetileg benne maradhat egy későbbi napra létrehozott
      -- hátralékos célfuvar. A sofőr ezt a cél napon kívül nem módosíthatja; ilyenkor
      -- a kötegelt mentés egyszerűen kihagyja, hogy a többi tétel mentése ne akadjon meg.
      if v_role='driver' and not (v_existing.driver_key=public.current_driver_key() and v_existing.schedule_date between public.app_today() and public.app_today()+1) then
        continue;
      elsif v_role='test' and not (v_existing.schedule_date between public.app_today() and public.app_today()+1) then
        continue;
      end if;
      perform public.update_own_order_payload(v_id,v_entry);
      v_count := v_count+1;
      continue;
    end if;

    if nullif(v_entry->>'movedFromOrderId','') is null then
      raise exception 'Új fuvar csak hátralékos tétel átütemezésével hozható létre.';
    end if;
    select * into v_source from public.orders where id=v_entry->>'movedFromOrderId' for update;
    if not found then raise exception 'A hátralék forrásfuvarja nem található.'; end if;
    if v_role='driver' and not (v_source.driver_key=public.current_driver_key() and v_source.schedule_date between public.app_today() and public.app_today()+1) then
      raise exception 'A forrásfuvarhoz nincs jogosultság.';
    elsif v_role='test' and not (v_source.schedule_date between public.app_today() and public.app_today()+1) then
      raise exception 'A tesztfelhasználó csak mai vagy holnapi forrásfuvarból ütemezhet át.';
    end if;

    v_target_date := nullif(v_entry->>'scheduleDate','')::date;
    if v_target_date is null or v_target_date < public.app_today() or v_target_date > public.app_today()+365 then
      raise exception 'Az átütemezési dátum érvénytelen.';
    end if;
    if v_role='driver' then
      select vehicle_id,driver_key into v_vehicle_id,v_driver_key
      from public.allowed_users where email=public.current_email() and active=true;
    else
      v_vehicle_id := nullif(v_entry->>'vehicleId','');
      select driver_key into v_driver_key from public.allowed_users
      where role='driver' and vehicle_id=v_vehicle_id and active=true limit 1;
    end if;
    if v_vehicle_id is null or v_driver_key is null then raise exception 'A célsofőrhöz nincs jármű rendelve.'; end if;

    v_payload := coalesce(v_source.payload,'{}'::jsonb);
    v_payload := jsonb_set(v_payload,'{id}',to_jsonb(v_id),true);
    v_payload := jsonb_set(v_payload,'{scheduleDate}',to_jsonb(v_target_date::text),true);
    v_payload := jsonb_set(v_payload,'{vehicleId}',to_jsonb(v_vehicle_id),true);
    v_payload := jsonb_set(v_payload,'{movedFromOrderId}',to_jsonb(v_source.id),true);
    v_payload := jsonb_set(v_payload,'{items}',coalesce(v_entry->'items','[]'::jsonb),true);
    v_payload := jsonb_set(v_payload,'{deliveryReports}','[]'::jsonb,true);
    v_payload := jsonb_set(v_payload,'{completed}','false'::jsonb,true);
    v_payload := jsonb_set(v_payload,'{completedAt}','""'::jsonb,true);
    v_payload := jsonb_set(v_payload,'{sequence}','999'::jsonb,true);

    insert into public.orders(id,schedule_date,vehicle_id,driver_key,order_no,project_name,sequence,payload,updated_at,updated_by)
    values(v_id,v_target_date,v_vehicle_id,v_driver_key,v_source.order_no,v_source.project_name,999,v_payload,now(),public.current_email());
    v_count := v_count+1;
  end loop;
  return v_count;
end $$;
grant execute on function public.sync_own_orders(jsonb) to authenticated;

create table if not exists public.transfer_requests (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  order_no text not null default '',
  project_name text not null default '',
  schedule_date date,
  from_driver_key text not null check (from_driver_key in ('mario','patrik','martin')),
  to_driver_key text not null check (to_driver_key in ('mario','patrik','martin')),
  status text not null default 'pending' check (status in ('pending','accepted','rejected','cancelled')),
  requested_by text not null default public.current_email(),
  note text not null default '',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  response_by text
);
create unique index if not exists one_pending_transfer_per_order on public.transfer_requests(order_id) where status='pending';

alter table public.transfer_requests enable row level security;
drop policy if exists transfers_read on public.transfer_requests;
create policy transfers_read on public.transfer_requests for select to authenticated
using (
  public.current_role()='admin'
  or public.current_role()='test'
  or requested_by=public.current_email()
  or from_driver_key=public.current_driver_key()
  or to_driver_key=public.current_driver_key()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  action text not null,
  order_id text,
  actor_email text not null default public.current_email(),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
drop policy if exists audit_admin_read on public.audit_log;
create policy audit_admin_read on public.audit_log for select to authenticated using (public.current_role()='admin');

create or replace function public.request_transfer(p_order_id text,p_to_driver_key text,p_note text default '')
returns public.transfer_requests
language plpgsql security definer set search_path=public as $$
declare
  v_order public.orders;
  v_request public.transfer_requests;
  v_role text := public.current_role();
begin
  if p_to_driver_key not in ('mario','patrik','martin') then raise exception 'Ismeretlen célsofőr.'; end if;
  select * into v_order from public.orders where id=p_order_id;
  if not found then raise exception 'A fuvar nem található.'; end if;
  if v_order.driver_key is null then raise exception 'A fuvar nincs sofőrhöz rendelve.'; end if;
  if v_order.driver_key=p_to_driver_key then raise exception 'A fuvar már ennél a sofőrnél van.'; end if;
  if v_role='driver' and (v_order.driver_key<>public.current_driver_key() or v_order.schedule_date not between public.app_today() and public.app_today()+1) then
    raise exception 'Csak a saját mai vagy holnapi fuvarod adható át.';
  elsif v_role='test' and v_order.schedule_date not between public.app_today() and public.app_today()+1 then
    raise exception 'Csak a mai vagy holnapi fuvar adható át.';
  elsif v_role not in ('driver','test','admin') then raise exception 'Nincs jogosultság.';
  end if;
  if not exists(select 1 from public.allowed_users where role='driver' and driver_key=p_to_driver_key and active=true) then
    raise exception 'A célsofőr nem aktív.';
  end if;
  insert into public.transfer_requests(order_id,order_no,project_name,schedule_date,from_driver_key,to_driver_key,note)
  values(v_order.id,v_order.order_no,v_order.project_name,v_order.schedule_date,v_order.driver_key,p_to_driver_key,coalesce(p_note,''))
  returning * into v_request;
  insert into public.audit_log(action,order_id,details) values('transfer_requested',v_order.id,jsonb_build_object('from',v_order.driver_key,'to',p_to_driver_key,'request_id',v_request.id));
  return v_request;
exception when unique_violation then
  raise exception 'Ehhez a fuvarhoz már van függőben lévő átadási kérés.';
end $$;
grant execute on function public.request_transfer(text,text,text) to authenticated;

create or replace function public.accept_transfer(p_request_id uuid)
returns public.transfer_requests
language plpgsql security definer set search_path=public as $$
declare
  v_request public.transfer_requests;
  v_target_vehicle text;
  v_payload jsonb;
begin
  select * into v_request from public.transfer_requests where id=p_request_id for update;
  if not found then raise exception 'Az átadási kérés nem található.'; end if;
  if v_request.status<>'pending' then raise exception 'Az átadási kérés már lezárult.'; end if;
  if public.current_role()<>'driver' or public.current_driver_key()<>v_request.to_driver_key then
    raise exception 'Csak a kijelölt sofőr fogadhatja el.';
  end if;
  select vehicle_id into v_target_vehicle from public.allowed_users where role='driver' and driver_key=v_request.to_driver_key and active=true limit 1;
  if v_target_vehicle is null then raise exception 'A célsofőrhöz nincs jármű rendelve.'; end if;
  select payload into v_payload from public.orders where id=v_request.order_id for update;
  update public.orders set
    driver_key=v_request.to_driver_key,
    vehicle_id=v_target_vehicle,
    payload=jsonb_set(
      jsonb_set(coalesce(v_payload,'{}'::jsonb),'{vehicleId}',to_jsonb(v_target_vehicle),true),
      '{lastTransfer}',jsonb_build_object('requestId',v_request.id,'from',v_request.from_driver_key,'to',v_request.to_driver_key,'acceptedAt',now(),'acceptedBy',public.current_email()),true
    ),
    updated_at=now(),updated_by=public.current_email()
  where id=v_request.order_id;
  update public.transfer_requests set status='accepted',responded_at=now(),response_by=public.current_email() where id=p_request_id returning * into v_request;
  insert into public.audit_log(action,order_id,details) values('transfer_accepted',v_request.order_id,jsonb_build_object('from',v_request.from_driver_key,'to',v_request.to_driver_key,'request_id',v_request.id));
  return v_request;
end $$;
grant execute on function public.accept_transfer(uuid) to authenticated;

create or replace function public.reject_transfer(p_request_id uuid)
returns public.transfer_requests
language plpgsql security definer set search_path=public as $$
declare v_request public.transfer_requests;
begin
  select * into v_request from public.transfer_requests where id=p_request_id for update;
  if not found then raise exception 'Az átadási kérés nem található.'; end if;
  if v_request.status<>'pending' then raise exception 'Az átadási kérés már lezárult.'; end if;
  if public.current_role()<>'driver' or public.current_driver_key()<>v_request.to_driver_key then raise exception 'Csak a kijelölt sofőr utasíthatja el.'; end if;
  update public.transfer_requests set status='rejected',responded_at=now(),response_by=public.current_email() where id=p_request_id returning * into v_request;
  insert into public.audit_log(action,order_id,details) values('transfer_rejected',v_request.order_id,jsonb_build_object('from',v_request.from_driver_key,'to',v_request.to_driver_key,'request_id',v_request.id));
  return v_request;
end $$;
grant execute on function public.reject_transfer(uuid) to authenticated;

create or replace function public.cancel_transfer(p_request_id uuid)
returns public.transfer_requests
language plpgsql security definer set search_path=public as $$
declare v_request public.transfer_requests;
begin
  select * into v_request from public.transfer_requests where id=p_request_id for update;
  if not found then raise exception 'Az átadási kérés nem található.'; end if;
  if v_request.status<>'pending' then raise exception 'Az átadási kérés már lezárult.'; end if;
  if public.current_role()<>'admin' and v_request.requested_by<>public.current_email() then raise exception 'Nincs jogosultság.'; end if;
  update public.transfer_requests set status='cancelled',responded_at=now(),response_by=public.current_email() where id=p_request_id returning * into v_request;
  insert into public.audit_log(action,order_id,details) values('transfer_cancelled',v_request.order_id,jsonb_build_object('request_id',v_request.id));
  return v_request;
end $$;
grant execute on function public.cancel_transfer(uuid) to authenticated;

create table if not exists public.delivery_reports (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  order_no text not null default '',
  project_name text not null default '',
  note text not null default '',
  created_by text not null default public.current_email(),
  created_at timestamptz not null default now()
);
create table if not exists public.delivery_report_files (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.delivery_reports(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists delivery_files_order_idx on public.delivery_report_files(order_id,created_at desc);

alter table public.delivery_reports enable row level security;
alter table public.delivery_report_files enable row level security;
drop policy if exists reports_access on public.delivery_reports;
drop policy if exists reports_insert on public.delivery_reports;
drop policy if exists report_files_access on public.delivery_report_files;
drop policy if exists report_files_insert on public.delivery_report_files;
create policy reports_access on public.delivery_reports for select to authenticated using (public.can_access_order(order_id));
create policy reports_insert on public.delivery_reports for insert to authenticated with check (public.can_access_order(order_id));
create policy report_files_access on public.delivery_report_files for select to authenticated using (public.can_access_order(order_id));
create policy report_files_insert on public.delivery_report_files for insert to authenticated with check (public.can_access_order(order_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('delivery-docs','delivery-docs',false,15728640,array['image/jpeg','image/png','image/heic','image/heif','application/pdf','audio/webm','audio/mp4','audio/mpeg'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists delivery_docs_read on storage.objects;
drop policy if exists delivery_docs_insert on storage.objects;
create policy delivery_docs_read on storage.objects for select to authenticated
using (bucket_id='delivery-docs' and public.can_access_order((storage.foldername(name))[1]));
create policy delivery_docs_insert on storage.objects for insert to authenticated
with check (bucket_id='delivery-docs' and public.can_access_order((storage.foldername(name))[1]));

-- Tételszintű hátralék közös tárolása
create table if not exists public.backlog_entries (
  id text primary key,
  source_order_id text references public.orders(id) on delete cascade,
  target_order_id text references public.orders(id) on delete cascade,
  moved_to_date date,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default public.current_email()
);
create index if not exists backlog_date_idx on public.backlog_entries(moved_to_date);
alter table public.backlog_entries enable row level security;
drop policy if exists backlog_read on public.backlog_entries;
drop policy if exists backlog_admin_write on public.backlog_entries;
create policy backlog_read on public.backlog_entries for select to authenticated
using (public.current_role()='admin' or public.can_access_order(source_order_id) or public.can_access_order(target_order_id));
create policy backlog_admin_write on public.backlog_entries for all to authenticated
using (public.current_role()='admin') with check (public.current_role()='admin');

create or replace function public.sync_own_backlog(p_entries jsonb)
returns integer
language plpgsql security definer set search_path=public as $$
declare
  v_entry jsonb;
  v_id text;
  v_source text;
  v_target text;
  v_count integer := 0;
  v_ids text[] := array[]::text[];
begin
  if public.current_role() not in ('driver','test','admin') then raise exception 'Nincs jogosultság.'; end if;
  for v_entry in select value from jsonb_array_elements(coalesce(p_entries,'[]'::jsonb)) loop
    v_id := v_entry->>'id'; v_source := v_entry->>'sourceOrderId'; v_target := v_entry->>'targetOrderId';
    if v_id is null or v_id='' then continue; end if;
    if not (public.can_access_order(v_source) or public.can_access_order(v_target)) then continue; end if;
    insert into public.backlog_entries(id,source_order_id,target_order_id,moved_to_date,payload,updated_at,updated_by)
    values(v_id,nullif(v_source,''),nullif(v_target,''),nullif(v_entry->>'movedToDate','')::date,v_entry,now(),public.current_email())
    on conflict(id) do update set source_order_id=excluded.source_order_id,target_order_id=excluded.target_order_id,moved_to_date=excluded.moved_to_date,payload=excluded.payload,updated_at=now(),updated_by=public.current_email();
    v_ids := array_append(v_ids,v_id); v_count := v_count+1;
  end loop;
  delete from public.backlog_entries b
  where (public.can_access_order(b.source_order_id) or public.can_access_order(b.target_order_id))
    and not (b.id=any(v_ids));
  return v_count;
end $$;
grant execute on function public.sync_own_backlog(jsonb) to authenticated;

-- Aktuális törzsadat-pillanatkép. Ezt kizárólag az admin olvashatja és írhatja.
-- Így a teszt során tanult címek/átvevők a következő kiadás előtt visszatölthetők.
create table if not exists public.master_data (
  id text primary key check (id='current'),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text not null default public.current_email()
);
alter table public.master_data enable row level security;
drop policy if exists master_data_admin_read on public.master_data;
drop policy if exists master_data_admin_insert on public.master_data;
drop policy if exists master_data_admin_update on public.master_data;
create policy master_data_admin_read on public.master_data for select to authenticated using (public.current_role()='admin');
create policy master_data_admin_insert on public.master_data for insert to authenticated with check (public.current_role()='admin');
create policy master_data_admin_update on public.master_data for update to authenticated using (public.current_role()='admin') with check (public.current_role()='admin');
