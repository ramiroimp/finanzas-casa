# Plan: Nuevas secciones de la app

## Datos extraidos de los estados de cuenta

### Tarjetas de Credito

| TDC | Ultimos 4 | Corte | Pago | Saldo deudor total | Limite |
|---|---|---|---|---|---|
| Santander LikeU Oro | 0110 | 12 | 4 | $13,617.45 | $114,700 |
| Santander Free Oro | 9810 | 6 (dia 14-15) | 13 (dia 6 mes sig.) | $23,386.55 | $137,200 |
| Santander Fiesta Rewards Platino | 7002 | 6 (dia 7-8) | 30 | $61,813.66 | $76,500 |
| Amex Platino | — | 11 | 3 mes sig. | (datos manuales) | — |

### Cargos recurrentes detectados (por TDC)

**Free 9810:**
- Totalplay: $770/mes (dia ~19)
- Gympass Wellhub (Ramiro): $1,499.90/mes (dia ~20)
- Gympass (Carolina): $1,499.90/mes (dia ~25)
- GPO NAL PROV (GNP seguros): $2,481.61 + $5,976.52 = ~$8,458/mes
- Apple.com/bill: $419 + $89 + $39 + $499 + $199 = multiples suscripciones
- Google One: $395/mes
- Google Cloud: $93.66/mes
- Paramount+ (via MercadoPago): ~$100/mes
- MAX (via MercadoPago): $167.30/mes
- Amazon suscripciones: $59/mes + $510 esporadico

**LikeU 0110:**
- Naturgy Gas (PAY PAL NATURGYMEX): $734 + $786 = ~$1,520/bimestre
- The Fives (hotel — parece unico, no recurrente)
- BT MCI (cargo diferido con intereses): $1,298.32/mes — 30 de 34 pagos, saldo $5,491.07

**Fiesta 7002:**
- Aeromexico vuelos 10 MSI: $49,664 total, $4,966.40/mes, 1 de 10 pagos, saldo $44,697.60
- BT MCI (cargo diferido con intereses): saldo $8,474.48, 31 de 34, ~$2,701.96/mes

**Amex Platino (datos del usuario):**
- 2 meses mas de $548.64 MSI automatico extranjero
- $2,653.25 MSI automatico MN
- $249.99 Uber (unico)

### MSI activos

| TDC | Descripcion | Monto original | Saldo pendiente | Pago mensual | Pagos restantes |
|---|---|---|---|---|---|
| Fiesta 7002 | Aeromexico vuelos 10MSI | $49,664 | $44,697.60 | $4,966.40 | 9 |
| Free 9810 | MercadoPago 12MSI | $2,679 | $2,455.75 | $223.25 | 11 |
| Amex | MSI auto extranjero | ~$1,097 | ~$1,097 | $548.64 | 2 |
| Amex | MSI auto MN | $2,653.25 | $2,653.25 | (por definir) | (por definir) |

### Deuda con intereses (BT MCI — Balance Transfer)

| TDC | Saldo pendiente | Pago mensual (incl. intereses) | Pagos restantes | Tasa |
|---|---|---|---|---|
| LikeU 0110 | $5,491.07 | ~$1,471.50 | 4 de 34 | 26.90% |
| Fiesta 7002 | $8,474.48 | ~$2,984.18 | 3 de 34 | 26.90% |

---

## Nuevas funcionalidades a implementar

### 1. Tab "Tarjetas" — Vista de TDC

**Pantalla principal:**
- 4 cards (una por TDC) mostrando:
  - Nombre, ultimos 4 digitos, color/emoji
  - Saldo deudor total
  - Fecha de corte y fecha limite de pago
  - Barra de uso (saldo / limite de credito)
  - Badge si el pago esta proximo (< 7 dias)

**Dentro de cada TDC (expandible o modal):**
- Gastos recurrentes asignados (con toggle activo/inactivo)
- MSI activos en esa tarjeta
- Balance transfers / deuda con intereses
- Boton "Registrar pago" para marcar que ya se pago

### 2. Sub-seccion "Recurrentes"

Lista de cargos recurrentes con:
- Nombre, monto, dia del mes, TDC asignada
- Indicador: proximo cargo en X dias
- Estado: pendiente / cargado este mes
- No se generan automaticamente, pero se muestra recordatorio

Datos iniciales precargados de los estados de cuenta.

### 3. Sub-seccion "MSI"

Para cada compra a MSI:
- Descripcion, monto original, mensualidad, TDC
- Barra de progreso (pagos hechos / total)
- Meses restantes
- Se descuenta automaticamente del "pago requerido" de la TDC

### 4. Tab "Planeacion" — Timeline semanal de gastos futuros

**Vista timeline:**
- Muestra las proximas 8-12 semanas (lunes a domingo)
- Cada semana muestra:
  - Gastos planeados (manuales, ej: "pago seguro auto")
  - Cargos recurrentes que caen en esa semana
  - Pagos de TDC que vencen en esa semana
  - MSI que se cobran en esa semana
  - Total estimado de salidas

**Agregar gasto planeado:**
- Descripcion, monto, fecha estimada, categoria
- Se asigna automaticamente a la semana correspondiente

---

## Nuevas tablas Supabase

```sql
-- Tarjetas de credito
create table tarjetas (
  id text primary key,
  nombre text not null,
  ultimos4 text not null,
  banco text not null,
  fecha_corte int not null,       -- dia del mes
  fecha_pago int not null,        -- dia del mes
  limite_credito numeric default 0,
  saldo_actual numeric default 0, -- se actualiza manualmente
  color text default '#c9973a',
  emoji text default '💳',
  activa boolean default true
);

-- Cargos recurrentes (suscripciones, servicios)
create table recurrentes (
  id text primary key,
  tarjeta_id text references tarjetas(id),
  nombre text not null,
  monto numeric not null,
  dia_cargo int,                  -- dia del mes aprox
  categoria text,                 -- servicio, seguro, suscripcion, etc
  activo boolean default true
);

-- Compras a MSI
create table msi (
  id text primary key,
  tarjeta_id text references tarjetas(id),
  descripcion text not null,
  monto_original numeric not null,
  mensualidad numeric not null,
  total_meses int not null,
  meses_pagados int default 0,
  fecha_inicio date,
  con_intereses boolean default false,
  tasa_interes numeric default 0
);

-- Gastos planeados futuros
create table gastos_planeados (
  id text primary key,
  descripcion text not null,
  monto numeric not null,
  fecha date not null,
  categoria text,
  completado boolean default false
);
```

## Cambios en la UI

- Agregar 2 nuevos tabs en el nav: "Tarjetas" y "Planeacion"
- El nav actual tiene 3 tabs (Dashboard, Semana, Cubetas) — con 5 tabs se pone apretado en mobile
- Solucion: usar iconos + texto corto, o un nav scrolleable horizontal

## Archivos a modificar

1. `src/supabase.js` — agregar CRUD para las 4 nuevas tablas
2. `src/App.jsx` — agregar tabs y secciones de Tarjetas y Planeacion
3. `supabase-schema.sql` — agregar las 4 nuevas tablas con datos iniciales
