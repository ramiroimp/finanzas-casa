-- ============================================
-- MIGRATION V5: config table for envelope engine
-- ============================================

create table if not exists config (
  clave text primary key,
  valor numeric not null
);

alter table config enable row level security;
create policy "Allow all" on config for all using (true) with check (true);

insert into config (clave, valor) values
  ('hip_semanal', 4037),
  ('presupuesto_dia_a_dia', 4000)
on conflict (clave) do nothing;
