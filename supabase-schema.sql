-- ============================================
-- Marro Finanzas — Supabase Schema
-- Correr en: Supabase Dashboard > SQL Editor
-- ============================================

-- 1. Tabla de semanas (una fila por semana, clave = lunes)
create table if not exists semanas (
  lunes            date primary key,
  ramiro           numeric not null default 14500,
  carolina         numeric not null default 7500,
  banorte_descontado boolean not null default false,
  items            jsonb not null default '[]'::jsonb,
  nota             text not null default '',
  sobrante         numeric not null default 0,
  saldo_acumulado  numeric not null default 0,
  created_at       timestamptz not null default now()
);

-- 2. Tabla de cubetas (singleton, id=1)
create table if not exists cubetas (
  id          int primary key default 1,
  salud       numeric not null default 0,
  bebe        numeric not null default 0,
  viajes      numeric not null default 0,
  acelerador  numeric not null default 0,
  updated_at  timestamptz not null default now()
);

-- Insertar fila inicial
insert into cubetas (id) values (1) on conflict (id) do nothing;

-- 3. Tabla de deudas (singleton, id=1)
create table if not exists deudas (
  id         int primary key default 1,
  banorte    numeric not null default 836435,
  hipoteca   numeric not null default 1400898,
  updated_at timestamptz not null default now()
);

-- Insertar fila inicial con valores por defecto
insert into deudas (id) values (1) on conflict (id) do nothing;

-- 4. Desactivar RLS (no auth por ahora)
alter table semanas enable row level security;
alter table cubetas enable row level security;
alter table deudas  enable row level security;

-- Policies permisivas para anon
create policy "Allow all on semanas" on semanas for all using (true) with check (true);
create policy "Allow all on cubetas" on cubetas for all using (true) with check (true);
create policy "Allow all on deudas"  on deudas  for all using (true) with check (true);
