-- ============================================
-- MIGRATION V3: Cuentas unificadas + Movimientos
-- ============================================

-- 1. Tabla cuentas (reemplaza cubetas singleton)
create table if not exists cuentas (
  id          text primary key,
  nombre      text not null,
  banco       text not null,
  tipo        text not null,        -- 'nomina','ahorro','cubeta','reserva'
  emoji       text default '💰',
  color       text default '#c9973a',
  saldo       numeric default 0,
  meta        numeric default 0,
  pct_ahorro  numeric default 0,
  es_ingreso  boolean default false,
  orden       int default 0,
  activa      boolean default true
);

-- RLS
alter table cuentas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='cuentas' and policyname='cuentas_all') then
    create policy cuentas_all on cuentas for all using (true) with check (true);
  end if;
end $$;

-- 2. Tabla movimientos (log de transferencias)
create table if not exists movimientos (
  id              text primary key,
  fecha           date not null,
  tipo            text not null,        -- 'transferencia','pago_tdc','ingreso'
  cuenta_origen   text references cuentas(id),
  cuenta_destino  text references cuentas(id),
  tarjeta_id      text references tarjetas(id),
  monto           numeric not null,
  descripcion     text default '',
  semana_lunes    date,
  created_at      timestamptz default now()
);

alter table movimientos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='movimientos' and policyname='movimientos_all') then
    create policy movimientos_all on movimientos for all using (true) with check (true);
  end if;
end $$;

-- 3. Datos iniciales de cuentas
-- Cuentas bancarias
insert into cuentas (id, nombre, banco, tipo, emoji, color, saldo, meta, pct_ahorro, es_ingreso, orden) values
  ('banamex',       'Banamex (principal)',     'Banamex',    'ahorro',  '🏦', '#2563eb', 88000, 0, 0, false, 1),
  ('sant_hipoteca', 'Santander Hipoteca',      'Santander',  'ahorro',  '🏠', '#818cf8', 21000, 0, 0, false, 2),
  ('sant_nomina',   'Santander Nómina',        'Santander',  'nomina',  '💵', '#059669', 0,     0, 0, true,  3),
  ('sant_uni',      'Santander Universitaria', 'Santander',  'ahorro',  '🎓', '#7c3aed', 0,     0, 0, false, 4),
  ('reserva_tdc',   'Reserva Pago TDC',        'Nu',         'reserva', '🛡️', '#dc2626', 0,     0, 0, false, 5)
on conflict (id) do nothing;

-- Cubetas Nu (migrar saldos de tabla cubetas existente)
-- Primero insertar con saldo 0, luego actualizar desde cubetas
insert into cuentas (id, nombre, banco, tipo, emoji, color, saldo, meta, pct_ahorro, orden) values
  ('nu_salud',      'Fondo de Salud',     'Nu', 'cubeta', '🏥', '#059669', 0, 600000, 30, 10),
  ('nu_bebe',       'Educación Bebé',     'Nu', 'cubeta', '👶', '#7c3aed', 0, 300000, 25, 11),
  ('nu_viajes',     'Vacaciones / Japón', 'Nu', 'cubeta', '✈️', '#d97706', 0, 200000, 25, 12),
  ('nu_acelerador', 'Mata Banorte / ETF', 'Nu', 'cubeta', '🔥', '#dc2626', 0, 836435, 20, 13)
on conflict (id) do nothing;

-- Migrar saldos de cubetas singleton a cuentas
update cuentas set saldo = coalesce((select salud from cubetas where id = 1), 0) where id = 'nu_salud';
update cuentas set saldo = coalesce((select bebe from cubetas where id = 1), 0) where id = 'nu_bebe';
update cuentas set saldo = coalesce((select viajes from cubetas where id = 1), 0) where id = 'nu_viajes';
update cuentas set saldo = coalesce((select acelerador from cubetas where id = 1), 0) where id = 'nu_acelerador';
