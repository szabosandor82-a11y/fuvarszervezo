-- =====================================================================
-- FUVARSZERVEZO V138 – Csevego (gyors uzenetek a soforokkel)
--
-- MIT HOZ LETRE?
--   1. chat_messages: az uzenetek. Minden sofor beszelgetese a sajat
--      belepesi e-mail-cimevel azonosithato; a csoportos (mindenkinek
--      szolo) uzenetek beszelgetes-azonositoja: __all__
--   2. chat_reads: ki meddig olvasta az egyes beszelgeteseket (ebbol
--      szamolodik az olvasatlan uzenetek szama es a "Latta" jelzes)
--   3. chat-files tarolo: a csevegoben kuldott kepek es fajlok (privat,
--      50 MB/fajl, barmilyen fajltipus)
--
-- KI MIT LATHAT? (a szerver ellenorzi, nem csak a felulet)
--   - A sofor CSAK a sajat beszelgeteset es a csoportos uzeneteket latja,
--     es csak a sajat beszelgetesebe irhat.
--   - Az admin minden beszelgetest lat, barmelyikbe irhat, es csak o
--     kuldhet csoportos uzenetet.
--   - Uzenetet csak a kuldoje szerkeszthet vagy torolhet.
--   - A kuldo, a beszelgetes es a kuldes ideje utolag nem irhato at.
--
-- HASZNALAT
--   1. Supabase -> a projekted -> bal oldalt "SQL Editor"
--   2. Masold be ezt a teljes fajlt, es nyomj Run-t
--      ("Success. No rows returned" a helyes valasz)
--   A fajl tobbszor is lefuttathato, adatot nem torol.
-- =====================================================================

-- ---------- segedfuggvenyek ------------------------------------------
create or replace function public.chat_my_email_v138()
returns text
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.chat_my_role_v138()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.role
    from public.allowed_users u
   where lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     and u.active is true
   limit 1
$$;

create or replace function public.chat_is_admin_v138()
returns boolean
language sql
stable
as $$
  select coalesce(public.chat_my_role_v138() = 'admin', false)
$$;

create or replace function public.chat_is_member_v138()
returns boolean
language sql
stable
as $$
  select public.chat_my_role_v138() is not null
$$;

grant execute on function public.chat_my_email_v138()  to authenticated;
grant execute on function public.chat_my_role_v138()   to authenticated;
grant execute on function public.chat_is_admin_v138()  to authenticated;
grant execute on function public.chat_is_member_v138() to authenticated;

-- ---------- uzenetek --------------------------------------------------
create table if not exists public.chat_messages (
  id            uuid        primary key default gen_random_uuid(),
  conversation  text        not null,
  sender_email  text        not null,
  sender_role   text        not null default 'driver',
  sender_name   text,
  body          text        not null default '',
  attachments   jsonb       not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  edited_at     timestamptz,
  deleted       boolean     not null default false
);
create index if not exists chat_messages_conv_idx    on public.chat_messages (conversation, created_at);
create index if not exists chat_messages_updated_idx on public.chat_messages (updated_at);

-- Uj uzenet: a kuldo es az idopont a szerverrol jon, nem hamisithato.
create or replace function public.chat_messages_before_insert_v138()
returns trigger
language plpgsql
as $$
begin
  new.sender_email := public.chat_my_email_v138();
  new.sender_role  := coalesce(public.chat_my_role_v138(), 'driver');
  new.conversation := lower(new.conversation);
  new.created_at   := now();
  new.updated_at   := now();
  new.edited_at    := null;
  new.deleted      := false;
  new.body         := coalesce(new.body, '');
  new.attachments  := coalesce(new.attachments, '[]'::jsonb);
  return new;
end;
$$;

-- Szerkesztes / torles: csak a szoveg es a mellekletek valtozhatnak.
create or replace function public.chat_messages_before_update_v138()
returns trigger
language plpgsql
as $$
begin
  new.id           := old.id;
  new.conversation := old.conversation;
  new.sender_email := old.sender_email;
  new.sender_role  := old.sender_role;
  new.sender_name  := old.sender_name;
  new.created_at   := old.created_at;
  new.updated_at   := now();
  if new.deleted or old.deleted then
    new.deleted     := true;
    new.body        := '';
    new.attachments := '[]'::jsonb;
    new.edited_at   := coalesce(old.edited_at, now());
  elsif new.body is distinct from old.body or new.attachments is distinct from old.attachments then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end;
$$;

drop trigger if exists chat_messages_before_insert_v138 on public.chat_messages;
create trigger chat_messages_before_insert_v138
  before insert on public.chat_messages
  for each row execute function public.chat_messages_before_insert_v138();

drop trigger if exists chat_messages_before_update_v138 on public.chat_messages;
create trigger chat_messages_before_update_v138
  before update on public.chat_messages
  for each row execute function public.chat_messages_before_update_v138();

alter table public.chat_messages enable row level security;

drop policy if exists chat_messages_select_v138 on public.chat_messages;
create policy chat_messages_select_v138 on public.chat_messages
  for select to authenticated
  using (public.chat_is_member_v138()
         and (public.chat_is_admin_v138()
              or conversation = public.chat_my_email_v138()
              or conversation = '__all__'));

drop policy if exists chat_messages_insert_v138 on public.chat_messages;
create policy chat_messages_insert_v138 on public.chat_messages
  for insert to authenticated
  with check (public.chat_is_member_v138()
              and sender_email = public.chat_my_email_v138()
              and (public.chat_is_admin_v138()
                   or conversation = public.chat_my_email_v138()));

drop policy if exists chat_messages_update_v138 on public.chat_messages;
create policy chat_messages_update_v138 on public.chat_messages
  for update to authenticated
  using (sender_email = public.chat_my_email_v138())
  with check (sender_email = public.chat_my_email_v138());

grant select, insert, update on public.chat_messages to authenticated;

-- ---------- olvasottsag ------------------------------------------------
create table if not exists public.chat_reads (
  conversation  text        not null,
  reader_email  text        not null,
  last_read_at  timestamptz not null default now(),
  primary key (conversation, reader_email)
);

alter table public.chat_reads enable row level security;

drop policy if exists chat_reads_select_v138 on public.chat_reads;
create policy chat_reads_select_v138 on public.chat_reads
  for select to authenticated
  using (public.chat_is_member_v138()
         and (public.chat_is_admin_v138()
              or reader_email = public.chat_my_email_v138()
              or conversation = public.chat_my_email_v138()
              or conversation = '__all__'));

drop policy if exists chat_reads_insert_v138 on public.chat_reads;
create policy chat_reads_insert_v138 on public.chat_reads
  for insert to authenticated
  with check (reader_email = public.chat_my_email_v138()
              and public.chat_is_member_v138()
              and (public.chat_is_admin_v138()
                   or conversation = public.chat_my_email_v138()
                   or conversation = '__all__'));

drop policy if exists chat_reads_update_v138 on public.chat_reads;
create policy chat_reads_update_v138 on public.chat_reads
  for update to authenticated
  using (reader_email = public.chat_my_email_v138())
  with check (reader_email = public.chat_my_email_v138()
              and (public.chat_is_admin_v138()
                   or conversation = public.chat_my_email_v138()
                   or conversation = '__all__'));

grant select, insert, update on public.chat_reads to authenticated;

-- ---------- kepek es fajlok -------------------------------------------
-- Eleresi ut: <beszelgetes>/<azonosito>/<fajlnev>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 52428800, null)
on conflict (id) do update
   set public = false, file_size_limit = 52428800, allowed_mime_types = null;

drop policy if exists chat_files_select_v138 on storage.objects;
create policy chat_files_select_v138 on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-files'
         and public.chat_is_member_v138()
         and (public.chat_is_admin_v138()
              or split_part(name, '/', 1) = public.chat_my_email_v138()
              or split_part(name, '/', 1) = '__all__'));

drop policy if exists chat_files_insert_v138 on storage.objects;
create policy chat_files_insert_v138 on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-files'
              and public.chat_is_member_v138()
              and (public.chat_is_admin_v138()
                   or split_part(name, '/', 1) = public.chat_my_email_v138()));

-- =====================================================================
-- ELLENORZES
--   select count(*) from public.chat_messages;   -- 0, ha meg nincs uzenet
--   select id, public, file_size_limit from storage.buckets where id = 'chat-files';
-- =====================================================================
