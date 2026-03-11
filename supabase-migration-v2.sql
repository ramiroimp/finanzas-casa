-- ============================================
-- Finanzas de la Casa — Migration V2
-- Nuevas tablas: tarjetas, recurrentes, msi, gastos_planeados
-- Correr en: Supabase Dashboard > SQL Editor
-- ============================================

-- 1. Tarjetas de credito
create table if not exists tarjetas (
  id             text primary key,
  nombre         text not null,
  ultimos4       text not null,
  banco          text not null,
  fecha_corte    int not null,
  fecha_pago     int not null,
  limite_credito numeric not null default 0,
  saldo_actual   numeric not null default 0,
  color          text not null default '#c9973a',
  emoji          text not null default '💳',
  activa         boolean not null default true
);

-- 2. Cargos recurrentes
create table if not exists recurrentes (
  id          text primary key,
  tarjeta_id  text references tarjetas(id),
  nombre      text not null,
  monto       numeric not null,
  dia_cargo   int,
  categoria   text,
  activo      boolean not null default true
);

-- 3. Compras a MSI
create table if not exists msi (
  id              text primary key,
  tarjeta_id      text references tarjetas(id),
  descripcion     text not null,
  monto_original  numeric not null,
  mensualidad     numeric not null,
  total_meses     int not null,
  meses_pagados   int not null default 0,
  fecha_inicio    date,
  con_intereses   boolean not null default false,
  tasa_interes    numeric not null default 0
);

-- 4. Gastos planeados futuros
create table if not exists gastos_planeados (
  id          text primary key,
  descripcion text not null,
  monto       numeric not null,
  fecha       date not null,
  categoria   text,
  completado  boolean not null default false
);

-- RLS permisivo
alter table tarjetas enable row level security;
alter table recurrentes enable row level security;
alter table msi enable row level security;
alter table gastos_planeados enable row level security;

create policy "Allow all on tarjetas" on tarjetas for all using (true) with check (true);
create policy "Allow all on recurrentes" on recurrentes for all using (true) with check (true);
create policy "Allow all on msi" on msi for all using (true) with check (true);
create policy "Allow all on gastos_planeados" on gastos_planeados for all using (true) with check (true);

-- ============================================
-- Datos iniciales: Tarjetas
-- ============================================
insert into tarjetas (id, nombre, ultimos4, banco, fecha_corte, fecha_pago, limite_credito, saldo_actual, color, emoji) values
  ('likeu',  'LikeU Oro',              '0110', 'Santander', 12, 4,  114700, 13617,  '#e8b84b', '💛'),
  ('free',   'Free Oro',               '9810', 'Santander', 6,  13, 137200, 23387,  '#22c55e', '💚'),
  ('fiesta', 'Fiesta Rewards Platino', '7002', 'Santander', 6,  30, 76500,  61814,  '#818cf8', '💜'),
  ('amex',   'Amex Platino',           '----', 'Amex',      11, 3,  0,      3452,   '#a78bfa', '💎')
on conflict (id) do nothing;

-- ============================================
-- Datos iniciales: Recurrentes
-- ============================================
insert into recurrentes (id, tarjeta_id, nombre, monto, dia_cargo, categoria, activo) values
  ('totalplay',    'free',  'Totalplay',                770,     19, 'servicio',     true),
  ('gym_ramiro',   'free',  'Gympass Wellhub (Ramiro)', 1499.90, 20, 'salud',        true),
  ('gym_caro',     'free',  'Gympass Wellhub (Caro)',   1499.90, 25, 'salud',        true),
  ('gnp_seguros',  'free',  'GNP Seguros Retiro',       8458,   23, 'seguro',       true),
  ('apple_419',    'free',  'Apple (iCloud/suscr.)',     419,    19, 'suscripcion',  true),
  ('apple_89',     'free',  'Apple Music',               89,      1, 'suscripcion',  true),
  ('apple_39',     'free',  'Apple TV+',                 39,      1, 'suscripcion',  true),
  ('apple_499',    'free',  'Apple One / suscr.',       499,     12, 'suscripcion',  true),
  ('apple_199',    'free',  'Apple suscripcion',        199,     12, 'suscripcion',  true),
  ('google_one',   'free',  'Google One',               395,      9, 'suscripcion',  true),
  ('google_cloud', 'free',  'Google Cloud',              93.66,   1, 'suscripcion',  true),
  ('paramount',    'free',  'Paramount+ (MercadoPago)', 100,     22, 'suscripcion',  true),
  ('max_hbo',      'free',  'MAX (MercadoPago)',        167.30,  22, 'suscripcion',  true),
  ('amazon_prime', 'free',  'Amazon Prime',              59,     11, 'suscripcion',  true),
  ('naturgy',      'likeu', 'Naturgy Gas (bimestral)',  1520,    12, 'servicio',     true)
on conflict (id) do nothing;

-- ============================================
-- Datos iniciales: MSI
-- ============================================
insert into msi (id, tarjeta_id, descripcion, monto_original, mensualidad, total_meses, meses_pagados, fecha_inicio, con_intereses, tasa_interes) values
  ('aeromexico_10msi', 'fiesta', 'Aeromexico vuelos 10MSI',    49664,   4966.40, 10, 1,  '2026-02-23', false, 0),
  ('mp_12msi',         'free',   'MercadoPago 12MSI',          2679,    223.25,  12, 1,  '2026-01-16', false, 0),
  ('bt_likeu',         'likeu',  'Balance Transfer MCI',       34256,   1471.50, 34, 30, '2023-08-21', true,  26.90),
  ('bt_fiesta',        'fiesta', 'Balance Transfer MCI',       69727,   2984.18, 34, 31, '2023-08-21', true,  26.90),
  ('amex_msi_ext',     'amex',   'MSI automatico extranjero',  1097.28, 548.64,  2,  0,  '2026-02-01', false, 0),
  ('amex_msi_mn',      'amex',   'MSI automatico MN',          2653.25, 2653.25, 1,  0,  '2026-02-01', false, 0)
on conflict (id) do nothing;
