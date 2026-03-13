# Weekly Envelope Recommendation Engine — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current "show what's due this week" recommendation engine with a priority-waterfall envelope model that distributes income weekly across hipoteca, TDC payments, day-to-day budget, and savings cubetas.

**Architecture:** Pure-function `calcRecomendacion` rewrite with new return shape. New `config` Supabase table for editable parameters. `RecommendationPanel` and Planeacion tab redesigned to show envelope allocations. `calcSemana` and all other flows untouched.

**Tech Stack:** React 18, Vite, Supabase JS v2, inline styles (dark theme), single-file `App.jsx` architecture.

**Spec:** `docs/superpowers/specs/2026-03-13-weekly-envelope-recommendation-design.md`

---

## File Structure

> **Note:** Line numbers are approximate — always match by function/component signature, not line number. The file shifts as edits accumulate.

| File | Action | Responsibility |
|------|--------|---------------|
| `supabase-migration-v5.sql` | Create | SQL migration: `config` table with RLS and seed data |
| `src/supabase.js` | Modify (add ~20 lines at end) | Add `loadConfig` and `saveConfig` functions |
| `src/App.jsx` `function calcRecomendacion(...)` | Modify (rewrite) | Envelope waterfall logic. Match: `function calcRecomendacion({` through its closing `}` |
| `src/App.jsx` `function RecommendationPanel(...)` | Modify (rewrite) | New UI layout. Match: `function RecommendationPanel({` through its closing `}` |
| `src/App.jsx` Planeacion IIFE | Modify (rewrite) | Envelope model per week. Match: `{(() => { const weeks = [];` through `})()}` inside `tab==="planeacion"` |
| `src/App.jsx` (new component) | Add (~60 lines) | `ConfigPanel` — editable hip_semanal + dia_a_dia |
| `src/App.jsx` `function App()` | Modify (add state + loader) | Load config on init, add `config` state, pass to children |

---

## Chunk 1: Database + Supabase Client

### Task 1: Create migration SQL

**Files:**
- Create: `supabase-migration-v5.sql`

- [ ] **Step 1: Write migration file**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase-migration-v5.sql
git commit -m "feat: add config table migration for envelope engine"
```

### Task 2: Add Supabase client functions

**Files:**
- Modify: `src/supabase.js` (add after line 226, end of file)

- [ ] **Step 1: Add loadConfig and saveConfig**

Add at the end of `src/supabase.js`:

```js
// --- Config ---

export async function loadConfig() {
  const { data, error } = await supabase
    .from("config")
    .select("*");
  if (error) {
    console.error("loadConfig error:", error);
    return {};
  }
  const cfg = {};
  (data || []).forEach(row => { cfg[row.clave] = Number(row.valor); });
  return cfg;
}

export async function saveConfig(clave, valor) {
  const { error } = await supabase
    .from("config")
    .upsert({ clave, valor: Number(valor) }, { onConflict: "clave" });
  if (error) console.error("saveConfig error:", error);
}
```

- [ ] **Step 2: Add imports in App.jsx**

In `src/App.jsx` line 2, add `loadConfig` and `saveConfig` to the import:

```js
import {
  loadSemanas,
  upsertSemana,
  loadCubetas,
  saveCubetas,
  loadDeudas,
  saveDeudas,
  loadTarjetas,
  upsertTarjeta,
  loadRecurrentes,
  upsertRecurrente,
  deleteRecurrente,
  loadMsi,
  upsertMsi,
  deleteMsi,
  loadGastosPlaneados,
  upsertGastoPlaneado,
  deleteGastoPlaneado,
  loadCuentas,
  upsertCuenta,
  updateSaldoCuenta,
  loadMovimientos,
  insertMovimiento,
  loadConfig,
  saveConfig,
} from "./supabase";
```

- [ ] **Step 3: Add config state and loading in App component**

In `src/App.jsx`, inside `export default function App()`, add state after the existing state declarations (after `const [editRecurrente, setEditRecurrente] = useState(null);`):

```js
const [config, setConfig] = useState({ hip_semanal: 4037, presupuesto_dia_a_dia: 4000 });
```

In the `useEffect` loader (find the `Promise.all([` call), add `loadConfig()` and handle result:

Change the destructuring to include `cfg`:
```js
const [s, cubLegacy, d, t, r, m, gp, ctas, cfg] = await Promise.all([
  loadSemanas(), loadCubetas(), loadDeudas(),
  loadTarjetas(), loadRecurrentes(), loadMsi(), loadGastosPlaneados(),
  loadCuentas(), loadConfig(),
]);
```

After existing state setters (before `setReady(true)`), add:
```js
if (cfg && Object.keys(cfg).length > 0) setConfig(prev => ({ ...prev, ...cfg }));
```

- [ ] **Step 4: Add config save handler**

After the existing handlers (e.g. after `transferirEntreCuentas`), add:

```js
const actualizarConfig = async (clave, valor) => {
  const numVal = Number(valor) || 0;
  setConfig(prev => ({ ...prev, [clave]: numVal }));
  await saveConfig(clave, numVal);
};
```

- [ ] **Step 5: Build and verify no errors**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/supabase.js src/App.jsx
git commit -m "feat: add config state, loader, and save handler"
```

---

## Chunk 2: Rewrite calcRecomendacion

### Task 3: Replace calcRecomendacion with envelope waterfall

**Files:**
- Modify: `src/App.jsx` — the `calcRecomendacion` function

- [ ] **Step 1: Replace the entire calcRecomendacion function**

Find `function calcRecomendacion({` and replace the entire function (through its closing `}`) with:

```js
// --- Motor de Recomendacion (Modelo de Sobres) ---
function calcRecomendacion({ ingreso, semanaLunes, tarjetas, recurrentes, msiList, gastosPlaneados, cuentas, deudas, config }) {
  const cfg = config || { hip_semanal: 4037, presupuesto_dia_a_dia: 4000 };

  // --- Ingreso neto (pre-deducciones) ---
  const suraDeduccion = semanaLunes <= P.sura_fin ? P.sura_semanal : 0;
  const ingresoNeto = ingreso - P.banorte_semanal - suraDeduccion;

  // --- Dias de esta semana (para gastos planeados y recSemana) ---
  const ws = new Date(semanaLunes + "T12:00:00");
  const we = new Date(ws); we.setDate(we.getDate() + 6);
  const dias = [];
  for (let d = new Date(ws); d <= we; d.setDate(d.getDate() + 1)) {
    dias.push(d.getDate());
  }
  const weStr = we.toISOString().slice(0, 10);

  // --- 1. Apartado hipoteca semanal ---
  const apartadoHipoteca = { monto: cfg.hip_semanal || 0 };

  // --- 2. Apartados TDC (÷4 siempre) ---
  const apartadosTDC = tarjetas.map(t => {
    const recMes = recurrentes
      .filter(r => r.tarjeta_id === t.id && r.activo !== false)
      .reduce((sum, r) => sum + Number(r.monto), 0);
    const msiMes = msiList
      .filter(m => m.tarjeta_id === t.id && m.meses_pagados < m.total_meses)
      .reduce((sum, m) => sum + Number(m.mensualidad), 0);
    const autoCalc = recMes + msiMes;
    const montoMensual = Number(t.pago_pendiente) > 0 ? Number(t.pago_pendiente) : autoCalc;
    const montoSemanal = Math.round(montoMensual / 4);

    // Cycle position (informational only)
    const hoy = new Date();
    const cycleStart = t.fecha_corte + 1; // day after fecha_corte
    const y = hoy.getFullYear(), mo = hoy.getMonth();
    let cycleDate = new Date(y, mo, cycleStart, 12);
    if (cycleDate > hoy) cycleDate = new Date(y, mo - 1, cycleStart, 12);
    const daysElapsed = Math.floor((hoy - cycleDate) / 86400000);
    const semanaActual = Math.min(4, Math.max(1, Math.floor(daysElapsed / 7) + 1));

    return {
      tarjeta: t,
      montoMensual,
      montoSemanal,
      semanaActual,
      totalSemanas: 4,
      detalle: { recurrentes: recMes, msi: msiMes, manual: Number(t.pago_pendiente) > 0 },
    };
  });

  // --- 3. Gastos planeados esta semana ---
  const gpSemana = gastosPlaneados
    .filter(g => !g.completado && g.fecha >= semanaLunes && g.fecha <= weStr)
    .map(g => ({ tipo: "planeado", nombre: g.descripcion, monto: Number(g.monto), dia: null }));

  // --- 4. Presupuesto dia a dia ---
  const presupuestoDiaADia = cfg.presupuesto_dia_a_dia || 0;

  // --- Totales ---
  const totalTDCSemanal = apartadosTDC.reduce((a, x) => a + x.montoSemanal, 0);
  const totalGP = gpSemana.reduce((a, x) => a + x.monto, 0);
  const totalCompromisos = apartadoHipoteca.monto + totalTDCSemanal + totalGP + presupuestoDiaADia;
  const disponible = ingresoNeto - totalCompromisos;

  // --- Distribuir a cubetas (si hay sobrante) ---
  const ctasCubeta = cuentas.filter(c => c.tipo === "cubeta" && c.pct_ahorro > 0);
  const distribucion = ctasCubeta.map(c => ({
    ...c,
    monto: disponible > 0 ? disponible * c.pct_ahorro / 100 : 0,
  }));

  // --- Sugerencia de retiro si hay deficit ---
  let sugerenciaRetiro = [];
  if (disponible < 0) {
    const deficit = Math.abs(disponible);
    const prioRetiro = cuentas
      .filter(c => c.tipo === "cubeta" && c.saldo > 0)
      .sort((a, b) => {
        const orden = { nu_viajes: 1, nu_acelerador: 2, nu_bebe: 3, nu_salud: 4 };
        return (orden[a.id] || 99) - (orden[b.id] || 99);
      });
    let restante = deficit;
    for (const c of prioRetiro) {
      if (restante <= 0) break;
      const retiro = Math.min(c.saldo, restante);
      sugerenciaRetiro.push({ cuenta: c, monto: retiro });
      restante -= retiro;
    }
  }

  // --- Info: recurrentes que se cargan a TDC esta semana ---
  const recSemana = recurrentes.filter(r => r.activo !== false && dias.includes(r.dia_cargo));

  return {
    ingresoNeto,
    apartadoHipoteca,
    apartadosTDC,
    gpSemana,
    presupuestoDiaADia,
    totalCompromisos,
    disponible,
    distribucion,
    sugerenciaRetiro,
    recSemana,
  };
}
```

- [ ] **Step 2: Build and verify no errors**

```bash
npm run build
```

Expected: Build succeeds. (React components that consume `rec.pagosTDC` etc. will break at runtime but not at build time — we fix those in Task 4 and 5.)

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: rewrite calcRecomendacion with envelope waterfall model"
```

---

## Chunk 3: Update UI Components

### Task 4: Rewrite RecommendationPanel

**Files:**
- Modify: `src/App.jsx` — the `RecommendationPanel` component

- [ ] **Step 1: Replace RecommendationPanel**

Find `function RecommendationPanel({` and replace the entire function through its closing `}` with:

```js
function RecommendationPanel({rec}) {
  if (!rec || !rec.ingresoNeto || rec.ingresoNeto <= 0) return null;
  return (
    <div style={{background:`${C.gold}0d`,border:`1px solid ${C.gold}33`,
      borderRadius:14,padding:14,marginBottom:14}}>
      <div style={{fontSize:11,color:C.goldL,fontWeight:700,marginBottom:12,
        textTransform:"uppercase",letterSpacing:.5}}>&#9889; Distribuci&oacute;n semanal</div>

      {/* Ingreso neto */}
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
        <span style={{fontSize:13,fontWeight:700}}>Tu ingreso neto</span>
        <span style={{fontFamily:"monospace",fontWeight:800,color:C.goldL,fontSize:14}}>
          {peso(rec.ingresoNeto)}
        </span>
      </div>
      <div style={{fontSize:10,color:C.muted,marginBottom:12}}>
        Banorte y Sura ya descontados
      </div>

      {/* Compromisos fijos */}
      <div style={{marginBottom:10}}>
        <div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:6,textTransform:"uppercase"}}>
          Compromisos fijos
        </div>

        {/* Hipoteca */}
        <div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",
          background:`${C.red}11`,borderRadius:8,marginBottom:4}}>
          <span style={{fontSize:12}}>&#x1F3E0; Hipoteca semanal</span>
          <span style={{fontFamily:"monospace",fontWeight:700,color:C.red,fontSize:12}}>
            {peso(rec.apartadoHipoteca.monto)}
          </span>
        </div>

        {/* TDC semanal */}
        {rec.apartadosTDC.map((a, i) => (
          <div key={i} style={{padding:"6px 10px",background:`${C.red}11`,borderRadius:8,marginBottom:4}}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:12}}>
                {a.tarjeta.emoji} Pago {a.tarjeta.nombre}
                <span style={{color:C.muted,fontSize:10}}> (sem {a.semanaActual}/{a.totalSemanas})</span>
              </span>
              <span style={{fontFamily:"monospace",fontWeight:700,color:C.red,fontSize:12}}>
                {peso(a.montoSemanal)}
              </span>
            </div>
            <div style={{fontSize:10,color:C.muted,marginTop:2}}>
              {a.detalle.manual
                ? <span style={{color:C.gold}}>Manual {peso(a.montoMensual)}/mes &divide; 4</span>
                : <>Rec: {peso(a.detalle.recurrentes)} + MSI: {peso(a.detalle.msi)} = {peso(a.montoMensual)}/mes &divide; 4</>
              }
            </div>
          </div>
        ))}

        {/* Gastos planeados */}
        {rec.gpSemana.map((g, i) => (
          <div key={i} style={{display:"flex",justifyContent:"space-between",
            padding:"6px 10px",background:`${C.gold}11`,borderRadius:8,marginBottom:4}}>
            <span style={{fontSize:12}}>{g.nombre}</span>
            <span style={{fontFamily:"monospace",fontWeight:700,color:C.goldL,fontSize:12}}>
              {peso(g.monto)}
            </span>
          </div>
        ))}

        <div style={{display:"flex",justifyContent:"space-between",
          borderTop:`1px solid ${C.border}`,paddingTop:6,marginTop:4}}>
          <span style={{fontSize:11,color:C.muted}}>Subtotal compromisos</span>
          <span style={{fontFamily:"monospace",fontWeight:700,color:C.red,fontSize:12}}>
            {peso(rec.totalCompromisos - rec.presupuestoDiaADia)}
          </span>
        </div>
      </div>

      {/* Dia a dia */}
      <div style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",
        background:`${C.orange}11`,border:`1px solid ${C.orange}22`,borderRadius:8,marginBottom:10}}>
        <span style={{fontSize:12,fontWeight:600}}>&#x1F6D2; D&iacute;a a d&iacute;a</span>
        <span style={{fontFamily:"monospace",fontWeight:700,color:C.orange,fontSize:12}}>
          {peso(rec.presupuestoDiaADia)}
        </span>
      </div>

      {/* Disponible / Cubetas */}
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:8,marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontSize:12,color:C.muted}}>Total compromisos + d&iacute;a a d&iacute;a</span>
          <span style={{fontFamily:"monospace",fontWeight:800,color:C.red,fontSize:13}}>
            {peso(rec.totalCompromisos)}
          </span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between"}}>
          <span style={{fontSize:12,color:C.muted}}>Disponible para cubetas</span>
          <span style={{fontFamily:"monospace",fontWeight:800,
            color:rec.disponible>=0?C.green:C.red,fontSize:13}}>
            {rec.disponible>=0?"+":""}{peso(rec.disponible)}
          </span>
        </div>
      </div>

      {rec.disponible > 0 && rec.distribucion.length > 0 && (
        <div style={{background:`${C.green}0d`,border:`1px solid ${C.green}22`,borderRadius:10,padding:10,marginBottom:8}}>
          <div style={{fontSize:10,color:C.green,fontWeight:700,marginBottom:6}}>A CUBETAS</div>
          {rec.distribucion.map(c=>(
            <div key={c.id} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{fontSize:12}}>{c.emoji} {c.nombre} ({c.pct_ahorro}%)</span>
              <span style={{fontFamily:"monospace",fontWeight:700,color:c.color,fontSize:12}}>{peso(c.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {rec.disponible < 0 && rec.sugerenciaRetiro.length > 0 && (
        <div style={{background:`${C.red}11`,border:`1px solid ${C.red}33`,borderRadius:10,padding:10}}>
          <div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:6}}>
            &#9888;&#65039; D&Eacute;FICIT de {peso(Math.abs(rec.disponible))} &mdash; Sugerencia:
          </div>
          {rec.sugerenciaRetiro.map((s,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{fontSize:12}}>Retirar de {s.cuenta.emoji} {s.cuenta.nombre}</span>
              <span style={{fontFamily:"monospace",fontWeight:700,color:C.red,fontSize:12}}>{peso(s.monto)}</span>
            </div>
          ))}
        </div>
      )}

      {rec.recSemana.length > 0 && (
        <div style={{marginTop:8,borderTop:`1px solid ${C.border}`,paddingTop:8}}>
          <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:4}}>
            INFO: Recurrentes que se cargan a TDC esta semana
          </div>
          {rec.recSemana.map(r=>(
            <div key={r.id} style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
              <span style={{fontSize:11,color:C.muted}}>{r.nombre} (d&iacute;a {r.dia_cargo})</span>
              <span style={{fontFamily:"monospace",fontSize:11,color:C.muted}}>{peso(r.monto)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update ModalSemana to pass config and use new rec shape**

In `ModalSemana`, find the `calcRecomendacion` call and update it to pass `config`:

Change:
```js
  const rec = calcRecomendacion({
    ingreso, semanaLunes: semana.lunes,
    tarjetas, recurrentes, msiList, gastosPlaneados, cuentas, deudas,
  });
```

To:
```js
  const rec = calcRecomendacion({
    ingreso, semanaLunes: semana.lunes,
    tarjetas, recurrentes, msiList, gastosPlaneados, cuentas, deudas, config,
  });
```

Also update `ModalSemana` function signature to receive `config`:

Change:
```js
function ModalSemana({semana, prevSaldo, onSave, onClose, tarjetas, recurrentes, msiList, gastosPlaneados, cuentas, deudas, onAddMsi}) {
```

To:
```js
function ModalSemana({semana, prevSaldo, onSave, onClose, tarjetas, recurrentes, msiList, gastosPlaneados, cuentas, deudas, onAddMsi, config}) {
```

Update `RecommendationPanel` usage in ModalSemana. Change:
```js
        <RecommendationPanel rec={rec} ingreso={ingreso} />
```

To:
```js
        <RecommendationPanel rec={rec} />
```

Find where `ModalSemana` is rendered (search for `<ModalSemana semana={editSemana}`) and pass `config`:

Change:
```js
        <ModalSemana semana={editSemana} prevSaldo={getPrevSaldo(editSemana.lunes)}
          onSave={guardarSemana} onClose={()=>setEditSemana(null)}
          tarjetas={tarjetas} recurrentes={recurrentes} msiList={msiList}
          gastosPlaneados={gastosPlaneados} cuentas={cuentas} deudas={deudas}
          onAddMsi={agregarMsi}/>
```

To:
```js
        <ModalSemana semana={editSemana} prevSaldo={getPrevSaldo(editSemana.lunes)}
          onSave={guardarSemana} onClose={()=>setEditSemana(null)}
          tarjetas={tarjetas} recurrentes={recurrentes} msiList={msiList}
          gastosPlaneados={gastosPlaneados} cuentas={cuentas} deudas={deudas}
          onAddMsi={agregarMsi} config={config}/>
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: rewrite RecommendationPanel with envelope UI"
```

### Task 5: Rewrite Planeacion tab

**Files:**
- Modify: `src/App.jsx` — the Planeacion tab IIFE block inside `{tab==="planeacion" && ...}`

- [ ] **Step 1: Replace the Planeacion week card rendering**

Inside the Planeacion tab (the `{tab==="planeacion" && ...}` block), replace the entire IIFE `{(() => { const weeks = []; ... })()}` section with:

```js
            {(() => {
              const weeks = [];
              for (let i = 0; i < 8; i++) {
                const d = new Date(hoyInicio+"T12:00:00");
                d.setDate(d.getDate() + i * 7);
                const dom = new Date(d);
                dom.setDate(dom.getDate() + 6);
                weeks.push({
                  lunes: d.toISOString().slice(0,10),
                  domingo: dom.toISOString().slice(0,10),
                  lunesDate: new Date(d),
                  domingoDate: new Date(dom),
                });
              }
              return weeks.map((w, wi) => {
                const dias = [];
                for (let dd = new Date(w.lunesDate); dd <= w.domingoDate; dd = new Date(dd.getFullYear(), dd.getMonth(), dd.getDate()+1)) {
                  dias.push(dd.getDate());
                }

                // Envelope model: same every week
                const hipSemanal = config.hip_semanal || 4037;
                const diaADia = config.presupuesto_dia_a_dia || 4000;

                // TDC weekly shares (÷4 each)
                const tdcShares = tarjetas.map(t => {
                  const recMes = recurrentes.filter(r => r.tarjeta_id === t.id && r.activo !== false)
                    .reduce((sum, r) => sum + Number(r.monto), 0);
                  const msiMes = msiList.filter(m => m.tarjeta_id === t.id && m.meses_pagados < m.total_meses)
                    .reduce((sum, m) => sum + Number(m.mensualidad), 0);
                  const montoMensual = Number(t.pago_pendiente) > 0 ? Number(t.pago_pendiente) : (recMes + msiMes);
                  return { ...t, montoSemanal: Math.round(montoMensual / 4), montoMensual };
                });
                const totalTDC = tdcShares.reduce((a, t) => a + t.montoSemanal, 0);

                // Gastos planeados this week
                const gpSemana = gastosPlaneados.filter(g => !g.completado && g.fecha >= w.lunes && g.fecha <= w.domingo);
                const totalGP = gpSemana.reduce((a, g) => a + Number(g.monto), 0);

                // Recurrentes this week (informational)
                const recSemana = recurrentes.filter(r => r.activo !== false && dias.includes(r.dia_cargo));

                const totalSemana = hipSemanal + totalTDC + totalGP + diaADia;
                const esHoy = wi === 0;

                return (
                  <Card key={w.lunes} style={{
                    padding:16,
                    borderLeft: esHoy ? `3px solid ${C.gold}` : undefined,
                  }}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div>
                        <div style={{fontSize:13,fontWeight:700,textTransform:"capitalize"}}>
                          {w.lunesDate.toLocaleDateString("es-MX",{day:"numeric",month:"short"})}
                          {" - "}
                          {w.domingoDate.toLocaleDateString("es-MX",{day:"numeric",month:"short"})}
                          {esHoy && <span style={{marginLeft:8,color:C.gold,fontSize:10,fontWeight:600}}>&bull; ESTA SEMANA</span>}
                        </div>
                      </div>
                      <span style={{fontFamily:"monospace",fontWeight:800,fontSize:14,
                        color:totalSemana>15000?C.red:C.orange}}>
                        {peso(totalSemana)}
                      </span>
                    </div>

                    {/* Hipoteca */}
                    <div style={{display:"flex",justifyContent:"space-between",
                      padding:"7px 10px",background:`${C.red}11`,
                      border:`1px solid ${C.red}22`,borderRadius:8,marginBottom:4}}>
                      <span style={{fontSize:12}}>&#x1F3E0; Hipoteca</span>
                      <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:C.red}}>
                        {peso(hipSemanal)}
                      </span>
                    </div>

                    {/* TDC shares */}
                    {tdcShares.map(t => (
                      <div key={`tdc-${t.id}`} style={{display:"flex",justifyContent:"space-between",
                        alignItems:"center",padding:"7px 10px",background:`${C.red}11`,
                        border:`1px solid ${C.red}22`,borderRadius:8,marginBottom:4}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:600,color:C.red}}>
                            {t.emoji} Pago {t.nombre}
                          </div>
                          <div style={{fontSize:10,color:C.muted}}>
                            {peso(t.montoMensual)}/mes &divide; 4
                          </div>
                        </div>
                        <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:C.red}}>
                          {peso(t.montoSemanal)}
                        </span>
                      </div>
                    ))}

                    {/* Dia a dia */}
                    <div style={{display:"flex",justifyContent:"space-between",
                      padding:"7px 10px",background:`${C.orange}11`,
                      border:`1px solid ${C.orange}22`,borderRadius:8,marginBottom:4}}>
                      <span style={{fontSize:12}}>&#x1F6D2; D&iacute;a a d&iacute;a</span>
                      <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:C.orange}}>
                        {peso(diaADia)}
                      </span>
                    </div>

                    {/* Recurrentes (info) */}
                    {recSemana.map(r => {
                      const tdc = tarjetas.find(x => x.id === r.tarjeta_id);
                      return (
                        <div key={r.id} style={{display:"flex",justifyContent:"space-between",
                          alignItems:"center",padding:"7px 10px",background:C.s2,borderRadius:8,
                          marginBottom:4}}>
                          <div style={{flex:1}}>
                            <div style={{fontSize:12,fontWeight:500}}>{r.nombre}</div>
                            <div style={{fontSize:10,color:C.muted}}>
                              D&iacute;a {r.dia_cargo} &middot; {tdc?tdc.nombre:""}
                            </div>
                          </div>
                          <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:C.orange,marginRight:6}}>
                            {peso(r.monto)}
                          </span>
                          <button onClick={()=>setEditRecurrente(r)}
                            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:12,padding:"2px"}}>&#9998;</button>
                          <button onClick={()=>eliminarRecurrente(r.id)}
                            style={{background:"none",border:"none",color:C.red,cursor:"pointer",fontSize:12,padding:"2px"}}>&#10005;</button>
                        </div>
                      );
                    })}

                    {/* Gastos planeados */}
                    {gpSemana.map(g => {
                      const catInfo = CATEGORIAS_GASTO.find(c=>c.id===g.categoria);
                      return (
                      <div key={g.id} style={{display:"flex",justifyContent:"space-between",
                        alignItems:"center",padding:"7px 10px",background:`${C.gold}0d`,
                        border:`1px solid ${C.gold}22`,borderRadius:8,marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          {catInfo && <span style={{fontSize:14}}>{catInfo.emoji}</span>}
                          <div>
                            <div style={{fontSize:12,fontWeight:500}}>{g.descripcion}</div>
                            <div style={{fontSize:10,color:C.muted}}>
                              {g.fecha} {catInfo?`\u00b7 ${catInfo.label}`:""}
                            </div>
                          </div>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:C.goldL}}>
                            {peso(g.monto)}
                          </span>
                          <button onClick={()=>eliminarGastoPlaneado(g.id)}
                            style={{background:"none",border:"none",color:C.muted,cursor:"pointer",
                              fontSize:14}}>&#10005;</button>
                        </div>
                      </div>
                      );
                    })}

                    {tdcShares.length===0 && recSemana.length===0 && gpSemana.length===0 && (
                      <div style={{textAlign:"center",padding:8,color:C.muted,fontSize:12}}>
                        Solo compromisos fijos esta semana
                      </div>
                    )}
                  </Card>
                );
              });
            })()}
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: rewrite Planeacion tab with envelope model"
```

### Task 6: Add ConfigPanel component

**Files:**
- Modify: `src/App.jsx` — add new component and render it in Inicio tab

- [ ] **Step 1: Add ConfigPanel component**

Add before the `export default function App()` line (e.g. after `TransferPanel`):

```js
function ConfigPanel({config, onUpdate}) {
  const [editKey, setEditKey] = useState(null);
  const [editVal, setEditVal] = useState("");

  const items = [
    { clave: "hip_semanal", label: "Apartado hipoteca semanal", emoji: "\u{1F3E0}" },
    { clave: "presupuesto_dia_a_dia", label: "Presupuesto d\u00eda a d\u00eda", emoji: "\u{1F6D2}" },
  ];

  return (
    <Card>
      <div style={{fontSize:11,color:C.muted,fontWeight:700,marginBottom:12,
        textTransform:"uppercase",letterSpacing:.5}}>&#9881;&#65039; Configuraci&oacute;n semanal</div>
      {items.map(item => (
        <div key={item.clave} style={{display:"flex",justifyContent:"space-between",
          alignItems:"center",marginBottom:8}}>
          <span style={{fontSize:13}}>{item.emoji} {item.label}</span>
          {editKey === item.clave ? (
            <div style={{display:"flex",gap:4}}>
              <input type="number" autoFocus value={editVal}
                onChange={e=>setEditVal(e.target.value)}
                onKeyDown={e=>{
                  if(e.key==="Enter"){onUpdate(item.clave,editVal);setEditKey(null);}
                  if(e.key==="Escape") setEditKey(null);
                }}
                onBlur={()=>{onUpdate(item.clave,editVal);setEditKey(null);}}
                style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:8,
                  padding:"4px 8px",color:C.goldL,fontFamily:"monospace",fontSize:13,
                  width:100,textAlign:"right",outline:"none"}}/>
            </div>
          ) : (
            <div onClick={()=>{setEditVal(String(config[item.clave]||0));setEditKey(item.clave);}}
              style={{cursor:"pointer"}}>
              <span style={{fontFamily:"monospace",fontWeight:800,fontSize:15,color:C.goldL}}>
                {peso(config[item.clave]||0)}
              </span>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}
```

- [ ] **Step 2: Render ConfigPanel in Inicio tab**

In the `{tab==="home" && ...}` block, add `ConfigPanel` at the end of the home content (just before the closing `</div>` of the home flex column, after the historial card):

```js
            <ConfigPanel config={config} onUpdate={actualizarConfig}/>
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: add ConfigPanel with editable hip_semanal and dia_a_dia"
```

---

## Chunk 4: Final Verification

### Task 7: Build, push, and verify

- [ ] **Step 1: Final build**

```bash
npm run build
```

Expected: Build succeeds with no errors or warnings.

- [ ] **Step 2: Push all changes**

```bash
git push
```

- [ ] **Step 3: Remind user to run migration**

Print the SQL the user needs to execute in Supabase SQL Editor:

```sql
-- Run this in Supabase SQL Editor:
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

- [ ] **Step 4: Verify on production**

After migration is run, verify on `finanzas-casa-theta.vercel.app`:
1. Inicio tab shows ConfigPanel at bottom with editable values
2. Opening a week (ModalSemana) shows new envelope-style recommendation
3. Planeacion tab shows hipoteca + TDC shares + dia a dia every week
4. Changing config values persists after reload
