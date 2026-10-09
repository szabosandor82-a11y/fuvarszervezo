-- =====================================================================
-- FUVARSZERVEZO – a torzsadat tablaja
--
-- Ez a tabla tarolja a PROJEKTEKET, BESZALLITOKAT, ATVEVOKET es a
-- JARMUVEKET, hogy minden gepen es telefonon ugyanaz legyen.
--
-- Ha ez a tabla nincs letrehozva, a program TOVABBRA IS MUKODIK: a
-- torzsadat a bongeszoben marad, a fuvarok pedig szinkronizalodnak. Csak
-- annyi a kulonbseg, hogy a torzsadat valtozasai (pl. egy uj jarmu, vagy
-- egy indulasi pont atirasa) nem jutnak at a tobbi eszkozre.
--
-- HASZNALAT
--   1. Supabase -> a projekted -> bal oldalt "SQL Editor"
--   2. Ird be ezt a fajlt, es nyomj Run-t
--   3. A programban nyomj Frissites-t
-- =====================================================================

create table if not exists public.master_data (
  id          text primary key,
  payload     jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.master_data enable row level security;

-- Olvasni minden belepett felhasznalo tud (a soforoknek is kell a
-- projektlista es a jarmuvek).
drop policy if exists master_data_read on public.master_data;
create policy master_data_read
  on public.master_data for select
  to authenticated
  using (true);

-- Irni csak ADMIN tud. A profiles tabla role mezoje dont.
drop policy if exists master_data_write on public.master_data;
create policy master_data_write
  on public.master_data for all
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.role = 'admin')
  );

-- Az elso mentes a programbol tortenik: a Jarmuvek lapon nyomj egy
-- "Indulasi pontok mentese"-t, vagy ments egy jarmuvet.
