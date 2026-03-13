# Weekly Envelope Recommendation Engine

## Problem

The current recommendation engine treats income as a lump sum and only shows TDC payments and obligations when they fall in the current week. This creates blind spots:

1. **Hipoteca is invisible most weeks** — it only appears in "semana critica" (when day 3 falls in the week), so the user doesn't set aside money for it weekly.
2. **TDC payments appear all at once** — the full monthly payment shows up in one week instead of being distributed across the cycle.
3. **No day-to-day budget** — there's no explicit allocation for weekly living expenses before sending money to savings cubetas.
4. **Cubetas get priority over commitments** — today, anything left after visible obligations goes to cubetas, but hipoteca and TDC payments that aren't due this week are ignored.

The user's mental model: every Friday (payday), sit down and distribute income into envelopes — first commitments (hipoteca, TDC), then day-to-day, then savings.

## Design

### Priority Waterfall

Every week, income is allocated in strict order:

1. **Pre-deductions** (Banorte semanal, Sura) — already subtracted from paycheck. `calcRecomendacion` receives gross income (`ramiro + carolina`) and subtracts these internally to compute `ingresoNeto`. Sura is only deducted when `semanaLunes <= P.sura_fin`.
2. **Hipoteca semanal** — fixed weekly amount (~$4,037 = $16,149 / 4), set aside every week
3. **TDC semanal por tarjeta** — monthly payment estimate divided by 4 (always equal split, no tracking)
4. **Gastos planeados** — any planned expenses that fall in this week
5. **Presupuesto dia a dia** — fixed weekly budget for living expenses ($4,000 default)
6. **Cubetas** — whatever remains, distributed by existing `cuentas.pct_ahorro` percentages (e.g. Salud 30%, Bebe 25%, Viajes 25%, Mata Banorte 20%). Percentages are used as-is from each cubeta's `pct_ahorro` field — they are not normalized to 100%. If they sum to less than 100%, some surplus remains unallocated.

If there's a deficit (income < sum of 1-5), the engine suggests cubeta withdrawals using existing priority order (Viajes > Acelerador > Bebe > Salud as last resort), matching current code behavior.

### TDC Weekly Calculation

Simple equal-split model — no set-aside tracking required:

For each tarjeta:

1. Get monthly payment: `pago_pendiente > 0 ? pago_pendiente : (recurrentes + MSI activos)`
2. **Divide by 4** — always. Every week shows 1/4 of the monthly payment as the weekly TDC share.
3. Show cycle position as informational context only (sem X/4), not used for calculation.

**Cycle position algorithm (informational only):**
- Day 1 of cycle = day after `fecha_corte` (e.g. if `fecha_corte = 13`, cycle starts on the 14th)
- Count how many days have elapsed since last cycle start
- `semanaActual = Math.floor(daysElapsed / 7) + 1`, clamped to [1, 4]
- This is for display (e.g. "sem 2/4") — the weekly share is always `montoMensual / 4`

**Why no tracking:** The user receives fixed weekly income. Dividing the monthly TDC payment by 4 gives a consistent weekly amount regardless of whether previous weeks' money was actually moved. If the user misses a week, they'll see the same $X,XXX next Friday and can catch up naturally. This avoids needing a set-aside ledger table.

### Config Table

New `config` table in Supabase for user-editable parameters:

```sql
create table if not exists config (
  clave text primary key,
  valor numeric not null
);

-- RLS: permissive policy (single-user app, same pattern as other tables)
alter table config enable row level security;
create policy "Allow all" on config for all using (true) with check (true);

insert into config (clave, valor) values
  ('hip_semanal', 4037),
  ('presupuesto_dia_a_dia', 4000)
on conflict (clave) do nothing;
```

These replace hardcoded values in the `P` constant object. The `P` object retains values that don't need UI editing (buffer_inicial, minimo_op, sura_fin, banorte_semanal, sura_semanal, etc.).

**Note:** No `user_id` column — this is a single-user app. All other tables follow the same pattern (no user scoping). If multi-user is ever needed, all tables would need migration.

### UI: Recommendation Panel

The `RecommendationPanel` component is redesigned:

```
DISTRIBUCION SEMANAL
────────────────────
TU INGRESO NETO               $XX,XXX
  (Banorte y Sura ya descontados)

COMPROMISOS FIJOS
  Hipoteca                     $4,037
  Pago [TDC nombre] (sem X/4)  $X,XXX
  Pago [TDC nombre] (sem X/4)  $X,XXX
  [Gastos planeados si hay]     $X,XXX
                              ────────
  Subtotal compromisos          $X,XXX

DIA A DIA                      $4,000

A CUBETAS (sobrante)            $X,XXX
  [cubeta] ([pct]%)             $X,XXX
  [cubeta] ([pct]%)             $X,XXX
  ...
```

Key differences from current UI:
- Banorte/Sura disappear from obligations list (shown as pre-deduction note)
- Hipoteca appears every week (not just "semana critica")
- TDC shows weekly share (÷4) with cycle position indicator (sem 2/4)
- New "Dia a dia" row before cubetas
- Deficit warning and cubeta withdrawal suggestions remain unchanged

### UI: Config Panel

Small editable section at the bottom of the "Inicio" tab (tab id `"home"`, labeled "Inicio" with 🏠 icon in the nav bar). Two inline-editable fields:

- **Apartado hipoteca semanal** — default $4,037
- **Presupuesto dia a dia** — default $4,000

Same interaction pattern as CuentaCard: tap the number to edit, Enter to save. On save failure, value reverts to previous and no toast/error is shown (silent retry on next load). On load failure, hardcoded defaults from `P` are used.

### Changes to calcRecomendacion

The function signature adds `config` to the input:

```
calcRecomendacion({ ingreso, semanaLunes, tarjetas, recurrentes, msiList,
                    gastosPlaneados, cuentas, deudas, config })
```

**Income flow:** `ingreso` is gross (`ramiro + carolina`). The function computes:
```
ingresoNeto = ingreso - P.banorte_semanal - (semanaLunes <= P.sura_fin ? P.sura_semanal : 0)
```

**Note on `semanaLunes`:** Despite the name, this is a Friday ISO date string (the week start moved from Monday to Friday in a previous change). The variable name is a legacy artifact — it means "week start date."

Return object is a **new shape** — the old fields (`pagosTDC`, `obligaciones`, etc.) are **removed and replaced**. Since `RecommendationPanel` and `Planeacion` are both being rewritten in this change, there are no other consumers that depend on the old shape.

```js
{
  // Income
  ingresoNeto,         // gross income - Banorte - Sura (conditional on sura_fin)

  // Compromisos (priority order)
  apartadoHipoteca,    // { monto: number } — weekly hipoteca from config
  apartadosTDC,        // array of { tarjeta, montoMensual, montoSemanal, semanaActual, totalSemanas, detalle: { recurrentes, msi, manual } }
  gpSemana,            // gastos planeados that fall in this week (same as before)
  presupuestoDiaADia,  // number — weekly day-to-day budget from config
  totalCompromisos,    // hip + sum(TDC semanal) + sum(gastos planeados) + dia a dia

  // Result
  disponible,          // ingresoNeto - totalCompromisos. Negative = deficit.
  distribucion,        // cubeta allocations from cuentas.pct_ahorro (only if disponible > 0)
  sugerenciaRetiro,    // cubeta withdrawal suggestions (only if disponible < 0)

  // Info
  recSemana,           // recurrentes with dia_cargo falling in this week (informational, for "cargos a TDC esta semana" section)
}
```

**Deficit logic:** Triggered when `disponible < 0`. Same withdrawal priority as current code (Viajes > Acelerador > Bebe > Salud as last resort).

**`recSemana`:** This field already exists in the current `calcRecomendacion` (line 187 of App.jsx). It filters recurrentes whose `dia_cargo` falls in the current week's day range. It's informational — shown in a "cargos a TDC esta semana" section so the user knows what's being charged to their credit cards.

### Changes to calcSemana

`calcSemana` currently subtracts `banorte_pago` and `hip_pago` from income to compute `sobrante` and `saldo_acumulado`. Under the new model:

- `calcSemana` continues to track the buffer balance (`saldo_acumulado`) as before — it is the source of truth for "how much cash do I have in my operating account."
- `calcRecomendacion` is the envelope advisor — it tells you how to allocate.
- They serve different purposes and can coexist. `calcSemana` answers "what happened this week" (actual cash flow), `calcRecomendacion` answers "what should I do with my money" (planning).
- **No changes to `calcSemana`.** The `esSemanaCritica` function and hipoteca deduction in `calcSemana` remain for accurate buffer tracking.

### Changes to banorte_descontado checkbox

The `banorte_descontado` toggle in `ModalSemana` stays. It affects `calcSemana` (buffer tracking) — when toggled, Banorte isn't subtracted from the buffer. This is independent from `calcRecomendacion` which always treats Banorte as a pre-deduction for envelope planning. The two serve different scopes: `calcSemana` tracks actual cash flow, `calcRecomendacion` plans allocation.

### Changes to Planeacion Tab

The 8-week lookahead updates to show the same envelope model:
- Every week card shows: hipoteca weekly share ($4,037), TDC weekly shares (÷4 each), gastos planeados (if any fall in that week), dia a dia ($4,000)
- TDC weekly shares are the same every week (montoMensual ÷ 4) — no cycle-position variation for future weeks
- Total per week reflects the full allocation, not just events that "fall" in that week
- `viernesDePago` is no longer used in Planeacion (every week shows the ÷4 share). The `viernesDePago` helper function is kept in the codebase but only used if we want a "payment due this week" highlight in the future.

### What Does NOT Change

- **Tables**: tarjetas, recurrentes, msi, cuentas, semanas, movimientos — untouched
- **Expense registration**: AddGasto, ModalSemana flow — untouched
- **Cubetas/Cuentas system**: deposit, withdraw, transfer — untouched
- **pago_pendiente**: manual TDC payment field — preserved and used as input
- **Friday-before alerts**: viernesDePago logic — preserved in calcRecomendacion
- **Week cycle**: Friday-to-Thursday — untouched
- **Buffer tracking**: calcSemana, saldo_acumulado, minimo_op — untouched
- **banorte_descontado toggle**: stays in ModalSemana for buffer tracking

## Files Modified

| File | Change |
|------|--------|
| `src/App.jsx` | Rewrite `calcRecomendacion`, redesign `RecommendationPanel`, add `ConfigPanel` component, update Planeacion tab, load config on init |
| `src/supabase.js` | Add `loadConfig`, `saveConfig` functions |
| `supabase-migration-v5.sql` | Create `config` table with RLS policy and seed data |

## Migration

Single SQL migration (`supabase-migration-v5.sql`):

```sql
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
```

No changes to existing tables. The `P` constant in App.jsx keeps non-UI values; `hip_semanal` and `presupuesto_dia_a_dia` move to the config table.

## Risks

- **Low**: `calcRecomendacion` is a pure function. Changing its internals doesn't affect callers as long as the output shape is a superset of the current one.
- **Low**: Config table is simple key-value. If it fails to load, fallback to hardcoded defaults in `P`. No error UI — silent fallback.
- **Low**: TDC weekly share is always ÷4 — no cycle tracking complexity, no edge cases around month boundaries. Cycle position is informational only.
