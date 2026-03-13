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

1. **Pre-deductions** (Banorte semanal, Sura) — already subtracted from paycheck, shown as "ingreso neto"
2. **Hipoteca semanal** — fixed weekly amount (~$4,037 = $16,149 / 4), set aside every week
3. **TDC semanal por tarjeta** — monthly payment estimate divided by remaining weeks in the billing cycle
4. **Gastos planeados** — any planned expenses that fall in this week
5. **Presupuesto dia a dia** — fixed weekly budget for living expenses ($4,000 default)
6. **Cubetas** — whatever remains, distributed by percentage (Salud 30%, Bebe 25%, Viajes 25%, Mata Banorte 20%)

If there's a deficit (income < sum of 1-5), the engine suggests cubeta withdrawals using existing priority order (Viajes > Acelerador > Bebe, never Salud).

### TDC Weekly Calculation

For each tarjeta:

1. Get monthly payment: `pago_pendiente > 0 ? pago_pendiente : (recurrentes + MSI activos)`
2. Calculate billing cycle length: ~4 weeks (configurable via `semanas_ciclo_tdc` if needed)
3. Determine current position in cycle based on `fecha_corte`
4. Divide remaining payment by remaining weeks in cycle
5. If `pago_pendiente` is set, that's the total to distribute; otherwise use auto-calc

Example: Fiesta has $7,950/month payment, we're in week 2 of 4 → this week's share = $7,950 / 4 = $1,988. If we're in week 3 and haven't set aside anything yet → $7,950 / 2 = $3,975.

### Config Table

New `config` table in Supabase for user-editable parameters:

```sql
create table config (
  clave text primary key,
  valor numeric
);

insert into config values
  ('hip_semanal', 4037),
  ('presupuesto_dia_a_dia', 4000);
```

These replace hardcoded values in the `P` constant object. The `P` object retains values that don't need UI editing (buffer_inicial, minimo_op, sura_fin, etc.).

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
- Banorte/Sura disappear from obligations list (pre-deducted)
- Hipoteca appears every week (not just "semana critica")
- TDC shows weekly share with cycle position indicator (sem 2/4)
- New "Dia a dia" row before cubetas
- Deficit warning and cubeta withdrawal suggestions remain unchanged

### UI: Config Panel

Small editable section at the bottom of the "Inicio" tab or accessible via a gear icon. Two inline-editable fields:

- **Apartado hipoteca semanal** — default $4,037
- **Presupuesto dia a dia** — default $4,000

Same interaction pattern as CuentaCard: tap the number to edit, Enter to save.

### Changes to calcRecomendacion

The function signature stays the same, adding `config` to the input:

```
calcRecomendacion({ ingreso, semanaLunes, tarjetas, recurrentes, msiList,
                    gastosPlaneados, cuentas, deudas, config })
```

Return object adds new fields while keeping existing ones for backward compatibility:

```js
{
  // Existing (kept)
  pagosTDC,        // now contains weekly shares, not monthly totals
  obligaciones,    // simplified: no more Banorte/Sura
  gpSemana,
  totalNecesario,
  disponible,
  distribucion,
  sugerenciaRetiro,
  recSemana,

  // New
  ingresoNeto,         // income after Banorte/Sura pre-deduction
  apartadoHipoteca,    // weekly hipoteca amount
  apartadosTDC,        // array of { tarjeta, montoSemanal, semanaActual, totalSemanas }
  presupuestoDiaADia,  // weekly day-to-day budget
  totalCompromisos,    // hip + TDC + gastos planeados
}
```

### Changes to Planeacion Tab

The 8-week lookahead updates to show the same envelope model:
- Each week card shows: hipoteca share, TDC weekly shares, gastos planeados, dia a dia
- Total per week reflects the full allocation, not just events that "fall" in that week

### What Does NOT Change

- **Tables**: tarjetas, recurrentes, msi, cuentas, semanas, movimientos — untouched
- **Expense registration**: AddGasto, ModalSemana flow — untouched
- **Cubetas/Cuentas system**: deposit, withdraw, transfer — untouched
- **pago_pendiente**: manual TDC payment field — preserved and used as input
- **Friday-before alerts**: viernesDePago logic — preserved
- **Week cycle**: Friday-to-Thursday — untouched
- **Buffer tracking**: saldo_acumulado, minimo_op — untouched

## Files Modified

| File | Change |
|------|--------|
| `src/App.jsx` | Rewrite `calcRecomendacion`, redesign `RecommendationPanel`, add `ConfigPanel` component, update Planeacion tab, load config on init |
| `src/supabase.js` | Add `loadConfig`, `saveConfig` functions |
| `supabase-migration-v5.sql` | Create `config` table with seed data |

## Migration

Single SQL migration (`supabase-migration-v5.sql`):

```sql
create table if not exists config (
  clave text primary key,
  valor numeric not null
);

insert into config (clave, valor) values
  ('hip_semanal', 4037),
  ('presupuesto_dia_a_dia', 4000)
on conflict (clave) do nothing;
```

No changes to existing tables. The `P` constant in App.jsx keeps non-UI values; `hip_semanal` and `presupuesto_dia_a_dia` move to the config table.

## Risks

- **Low**: `calcRecomendacion` is a pure function. Changing its internals doesn't affect callers as long as the output shape is a superset of the current one.
- **Low**: Config table is simple key-value. If it fails to load, fallback to hardcoded defaults in `P`.
- **Medium**: TDC weekly share calculation depends on correctly identifying the current position in the billing cycle. Edge cases around month boundaries need careful handling. Mitigation: if cycle position can't be determined, fall back to dividing by 4.
