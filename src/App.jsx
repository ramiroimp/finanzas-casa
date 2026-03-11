import { useState, useEffect } from "react";
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
} from "./supabase";

const P = {
  buffer_inicial: 109000, minimo_op: 25000,
  banorte_semanal: 5642, sura_semanal: 1200,
  sura_fin: "2026-07-10", hip_mensual: 16149, hip_dia: 3,
};

const CATEGORIAS_GASTO = [
  {id:"servicio",    label:"Servicio",     emoji:"\u{1F4A1}"},
  {id:"suscripcion", label:"Suscripci\u00f3n",  emoji:"\u{1F4FA}"},
  {id:"seguro",      label:"Seguro",       emoji:"\u{1F6E1}\uFE0F"},
  {id:"salud",       label:"Salud",        emoji:"\u{1F3E5}"},
  {id:"auto",        label:"Auto",         emoji:"\u{1F697}"},
  {id:"hogar",       label:"Hogar",        emoji:"\u{1F3E0}"},
  {id:"educacion",   label:"Educaci\u00f3n",    emoji:"\u{1F393}"},
  {id:"viaje",       label:"Viaje",        emoji:"\u2708\uFE0F"},
  {id:"comida",      label:"Comida",       emoji:"\u{1F37D}\uFE0F"},
  {id:"compras",     label:"Compras",      emoji:"\u{1F6D2}"},
  {id:"bebe",        label:"Beb\u00e9",         emoji:"\u{1F476}"},
  {id:"mascota",     label:"Mascota",      emoji:"\u{1F43E}"},
  {id:"otro",        label:"Otro",         emoji:"\u{1F4CC}"},
];

const CATS = [
  { id:"agua",      label:"Agua",       emoji:"\u{1F4A7}", def:350  },
  { id:"gas",       label:"Gas",        emoji:"\u{1F525}", def:600  },
  { id:"luz",       label:"Luz",        emoji:"\u26A1", def:1200 },
  { id:"internet",  label:"Internet",   emoji:"\u{1F4F6}", def:700  },
  { id:"streaming", label:"Streaming",  emoji:"\u{1F4FA}", def:400  },
  { id:"gnp",       label:"GNP Retiro", emoji:"\u{1F3E6}", def:8139 },
  { id:"gym",       label:"Gimnasio",   emoji:"\u{1F4AA}", def:3200 },
  { id:"mascotas",  label:"Mascotas",   emoji:"\u{1F43E}", def:1500 },
  { id:"bebe_cat",  label:"Beb\u00e9",       emoji:"\u{1F37C}", def:900  },
  { id:"super",     label:"S\u00faper",      emoji:"\u{1F6D2}", def:2000 },
  { id:"ropa",      label:"Ropa",       emoji:"\u{1F454}", def:1000 },
  { id:"salidas",   label:"Salidas",    emoji:"\u{1F37D}\uFE0F", def:1500 },
  { id:"otro",      label:"Otro",       emoji:"\u{1F4CC}", def:0    },
];

const peso = (n) => n == null ? "\u2014" :
  new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",maximumFractionDigits:0}).format(n);
const uid = () => Math.random().toString(36).slice(2,9);

function getMondayOf(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0,10);
}

function esSemanaCritica(lunesStr) {
  const lunes = new Date(lunesStr + "T12:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(lunes); d.setDate(lunes.getDate() + i);
    if (d.getDate() === P.hip_dia) return true;
  }
  return false;
}

function diasHasta(dia) {
  const hoy = new Date();
  const y = hoy.getFullYear(), m = hoy.getMonth();
  let f = new Date(y, m, dia);
  if (f.getTime() <= hoy.getTime()) f = new Date(y, m + 1, dia);
  return Math.ceil((f - hoy) / 86400000);
}

function calcSemana(s, prevSaldo) {
  const total_ingreso = (Number(s.ramiro)||0) + (Number(s.carolina)||0);
  const critica = esSemanaCritica(s.lunes);
  const banorte_pago = s.banorte_descontado ? 0 : P.banorte_semanal;
  const hip_pago = critica ? P.hip_mensual : 0;
  const items_total = (s.items||[]).reduce((a,i) => a + (Number(i.monto)||0), 0);
  const total_salidas = banorte_pago + hip_pago + items_total;
  const sobrante = total_ingreso - total_salidas;
  const saldo = (prevSaldo ?? P.buffer_inicial) + sobrante;
  return { total_ingreso, banorte_pago, hip_pago, items_total, total_salidas, sobrante, saldo, critica };
}

// --- Motor de Recomendacion ---
function calcRecomendacion({ ingreso, semanaLunes, tarjetas, recurrentes, msiList, gastosPlaneados, cuentas, deudas }) {
  const lunes = new Date(semanaLunes + "T12:00:00");
  const domingo = new Date(lunes);
  domingo.setDate(domingo.getDate() + 6);

  const dias = [];
  for (let d = new Date(lunes); d <= domingo; d.setDate(d.getDate() + 1)) {
    dias.push(d.getDate());
  }

  // Prioridad 1: Pagos TDC que vencen esta semana
  const pagosTDC = tarjetas
    .filter(t => dias.includes(t.fecha_pago) && t.saldo_actual > 0)
    .map(t => ({ tipo: "tdc", nombre: `Pago ${t.nombre}`, monto: Number(t.saldo_actual), dia: t.fecha_pago, tarjeta: t }));

  // Prioridad 2: Obligaciones fijas
  const obligaciones = [];
  if (dias.includes(P.hip_dia)) {
    obligaciones.push({ tipo: "fijo", nombre: "Hipoteca Santander", monto: P.hip_mensual, dia: P.hip_dia });
  }
  obligaciones.push({ tipo: "fijo", nombre: "Banorte semanal", monto: P.banorte_semanal, dia: null });
  if (semanaLunes <= P.sura_fin) {
    obligaciones.push({ tipo: "fijo", nombre: "Sura (Carolina)", monto: P.sura_semanal, dia: null });
  }

  // Prioridad 3: Gastos planeados en la ventana
  const gpSemana = gastosPlaneados
    .filter(g => !g.completado && g.fecha >= semanaLunes && g.fecha <= domingo.toISOString().slice(0,10))
    .map(g => ({ tipo: "planeado", nombre: g.descripcion, monto: Number(g.monto), dia: null }));

  const totalTDC = pagosTDC.reduce((a, x) => a + x.monto, 0);
  const totalOblig = obligaciones.reduce((a, x) => a + x.monto, 0);
  const totalGP = gpSemana.reduce((a, x) => a + x.monto, 0);
  const totalNecesario = totalTDC + totalOblig + totalGP;
  const disponible = ingreso - totalNecesario;

  // Distribuir a cubetas
  const ctasCubeta = cuentas.filter(c => c.tipo === "cubeta" && c.pct_ahorro > 0);
  const distribucion = ctasCubeta.map(c => ({
    ...c,
    monto: disponible > 0 ? disponible * c.pct_ahorro / 100 : 0,
  }));

  // Sugerencia de retiro si hay deficit
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

  // Info: recurrentes TDC de la semana (no afectan flujo de caja directo)
  const recSemana = recurrentes.filter(r => r.activo !== false && dias.includes(r.dia_cargo));

  return {
    pagosTDC, obligaciones, gpSemana,
    totalTDC, totalOblig, totalGP, totalNecesario,
    disponible, distribucion, sugerenciaRetiro, recSemana,
  };
}

const C = {
  bg:"#080c14", surface:"#0f1623", s2:"#162030", s3:"#1c2a3d",
  border:"#1e2d42", text:"#dde6f5", muted:"#5a7295",
  gold:"#c9973a", goldL:"#e8b84b", green:"#22c55e",
  red:"#f87171", orange:"#fb923c", purple:"#a78bfa",
};

const Card = ({children, style={}}) => (
  <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,padding:20,...style}}>
    {children}
  </div>
);

const Btn = ({children, onClick, color, outline=false, small=false, full=false, style={}}) => {
  const col = color || C.gold;
  return (
    <button onClick={onClick} style={{
      background: outline ? "transparent" : col,
      color: outline ? col : "#000",
      border:`1px solid ${col}`, borderRadius:10,
      padding: small ? "6px 14px" : full ? "13px" : "10px 20px",
      fontSize: small ? 12 : 14, fontWeight:700, cursor:"pointer",
      width: full ? "100%" : "auto", fontFamily:"inherit", ...style
    }}>{children}</button>
  );
};

function CubetaCard({cub, onDeposit, onWithdraw}) {
  const saldo = Number(cub.saldo) || 0;
  const p = cub.meta > 0 ? Math.min(1, saldo / cub.meta) : 0;
  const [mode, setMode] = useState(null);
  const [amt, setAmt] = useState("");
  const go = () => {
    const n = parseFloat(amt);
    if (!n || n <= 0) return;
    mode === "dep" ? onDeposit(cub.id, n) : onWithdraw(cub.id, n);
    setAmt(""); setMode(null);
  };
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,
      padding:18,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:cub.color}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
        <div>
          <div style={{fontSize:22}}>{cub.emoji}</div>
          <div style={{fontWeight:700,fontSize:13,marginTop:4}}>{cub.nombre}</div>
          {cub.meta>0 && <div style={{fontSize:10,color:C.muted}}>Meta {peso(cub.meta)}</div>}
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"monospace",fontWeight:800,fontSize:19,color:C.goldL}}>{peso(saldo)}</div>
          {cub.meta>0 && <div style={{fontSize:12,color:cub.color,fontWeight:700}}>{(p*100).toFixed(1)}%</div>}
        </div>
      </div>
      {cub.meta>0 && (
        <div style={{background:C.s2,borderRadius:99,height:5,marginBottom:12,overflow:"hidden"}}>
          <div style={{width:`${p*100}%`,height:"100%",background:cub.color,borderRadius:99,transition:"width .5s"}}/>
        </div>
      )}
      {mode ? (
        <div style={{display:"flex",gap:8}}>
          <input autoFocus type="number" value={amt} onChange={e=>setAmt(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&go()}
            placeholder={mode==="dep"?"Depositar...":"Retirar..."}
            style={{flex:1,background:C.s2,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"8px 10px",color:C.goldL,outline:"none",fontFamily:"monospace",fontSize:14}}/>
          <button onClick={go} style={{background:mode==="dep"?C.green:C.red,color:"#000",
            border:"none",borderRadius:8,padding:"8px 12px",fontWeight:700,cursor:"pointer"}}>&#10003;</button>
          <button onClick={()=>{setMode(null);setAmt("")}} style={{background:C.s2,color:C.muted,
            border:`1px solid ${C.border}`,borderRadius:8,padding:"8px 10px",cursor:"pointer"}}>&#10005;</button>
        </div>
      ) : (
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setMode("dep")} style={{flex:1,background:C.s2,
            border:`1px solid ${C.green}44`,color:C.green,borderRadius:8,
            padding:"7px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>+ Depositar</button>
          <button onClick={()=>setMode("with")} style={{flex:1,background:C.s2,
            border:`1px solid ${C.red}44`,color:C.red,borderRadius:8,
            padding:"7px",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>&minus; Retirar</button>
        </div>
      )}
    </div>
  );
}

function CuentaCard({cta, onUpdate}) {
  const saldo = Number(cta.saldo) || 0;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  return (
    <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,
      padding:16,position:"relative",overflow:"hidden"}}>
      <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:cta.color}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>{cta.emoji}</span>
          <div>
            <div style={{fontWeight:700,fontSize:13}}>{cta.nombre}</div>
            <div style={{fontSize:10,color:C.muted}}>{cta.banco}{cta.tipo==="reserva"?" \u00b7 Reserva":""}</div>
          </div>
        </div>
        {editing ? (
          <div style={{display:"flex",gap:4}}>
            <input autoFocus type="number" value={val} onChange={e=>setVal(e.target.value)}
              onKeyDown={e=>{if(e.key==="Enter"){onUpdate(cta.id,Number(val));setEditing(false);}}}
              style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:8,
                padding:"4px 8px",color:C.goldL,fontFamily:"monospace",fontSize:13,
                width:100,textAlign:"right",outline:"none"}}/>
            <button onClick={()=>setEditing(false)} style={{background:"none",
              border:"none",color:C.muted,cursor:"pointer"}}>&#10005;</button>
          </div>
        ) : (
          <div onClick={()=>{setVal(String(saldo));setEditing(true);}}
            style={{cursor:"pointer",textAlign:"right"}}>
            <div style={{fontFamily:"monospace",fontWeight:800,fontSize:17,color:cta.color||C.goldL}}>
              {peso(saldo)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AddGasto({onAdd, onClose, tarjetas, cuentas}) {
  const [cat, setCat] = useState("super");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0,10));
  const [desc, setDesc] = useState("");
  const [fuenteTipo, setFuenteTipo] = useState("cuenta");
  const [fuenteId, setFuenteId] = useState("banamex");
  const selCat = CATS.find(c=>c.id===cat);
  useEffect(()=>{ if(selCat?.def>0) setMonto(String(selCat.def)); }, [cat]);
  const add = () => {
    const n = parseFloat(monto);
    if (!n || n <= 0) return;
    onAdd({id:uid(), cat, desc, monto:n, fecha, fuente_tipo:fuenteTipo, fuente_id:fuenteId});
    onClose();
  };
  const ctasActivas = cuentas.filter(c => c.tipo !== "cubeta");
  return (
    <div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",
      alignItems:"flex-end",justifyContent:"center",zIndex:300}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:C.surface,borderRadius:"20px 20px 0 0",padding:22,
        width:"100%",maxWidth:480,border:`1px solid ${C.border}`,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontWeight:700,fontSize:16,marginBottom:16}}>Agregar gasto</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:7,marginBottom:16}}>
          {CATS.map(c=>(
            <button key={c.id} onClick={()=>setCat(c.id)} style={{
              background:cat===c.id?`${C.gold}22`:C.s2,
              border:`1px solid ${cat===c.id?C.gold:C.border}`,
              borderRadius:10,padding:"8px 4px",cursor:"pointer",
              display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
              <span style={{fontSize:18}}>{c.emoji}</span>
              <span style={{fontSize:9,color:cat===c.id?C.goldL:C.muted,
                fontWeight:600,textAlign:"center",fontFamily:"inherit"}}>{c.label}</span>
            </button>
          ))}
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>Pagado con</div>
          <div style={{display:"flex",gap:6,marginBottom:8}}>
            {[{v:"cuenta",l:"Cuenta"},{v:"tdc",l:"Tarjeta"}].map(o=>(
              <button key={o.v} onClick={()=>{
                setFuenteTipo(o.v);
                setFuenteId(o.v==="cuenta"?"banamex":(tarjetas[0]?.id||""));
              }} style={{
                flex:1,background:fuenteTipo===o.v?`${C.gold}22`:C.s2,
                border:`1px solid ${fuenteTipo===o.v?C.gold:C.border}`,
                borderRadius:8,padding:"8px",fontSize:12,fontWeight:700,
                color:fuenteTipo===o.v?C.goldL:C.muted,cursor:"pointer",fontFamily:"inherit",
              }}>{o.l}</button>
            ))}
          </div>
          <select value={fuenteId} onChange={e=>setFuenteId(e.target.value)}
            style={{width:"100%",background:C.s2,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"9px 10px",color:C.text,outline:"none",fontFamily:"inherit",fontSize:13}}>
            {fuenteTipo==="cuenta"
              ? ctasActivas.map(c=><option key={c.id} value={c.id}>{c.emoji} {c.nombre}</option>)
              : tarjetas.map(t=><option key={t.id} value={t.id}>{t.emoji} {t.nombre}</option>)
            }
          </select>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>
            {selCat?.emoji} {selCat?.label} &mdash; Monto
          </div>
          <div style={{display:"flex",background:C.s2,border:`1px solid ${C.border}`,
            borderRadius:10,overflow:"hidden"}}>
            <span style={{padding:"0 12px",color:C.muted,fontSize:13,alignSelf:"center"}}>$</span>
            <input type="number" value={monto} onChange={e=>setMonto(e.target.value)}
              style={{flex:1,background:"transparent",border:"none",outline:"none",
                padding:"11px 4px",color:C.goldL,fontSize:17,fontWeight:700,fontFamily:"monospace"}}/>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <div>
            <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>Fecha</div>
            <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)}
              style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:10,
                padding:"9px 10px",color:C.text,outline:"none",width:"100%",fontFamily:"inherit"}}/>
          </div>
          <div>
            <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>Nota</div>
            <input type="text" value={desc} onChange={e=>setDesc(e.target.value)}
              placeholder="ej. bimestre..."
              style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:10,
                padding:"9px 10px",color:C.text,outline:"none",width:"100%",fontFamily:"inherit"}}/>
          </div>
        </div>
        <Btn onClick={add} full>Agregar &#10003;</Btn>
      </div>
    </div>
  );
}

function AddGastoPlaneado({onAdd, onClose}) {
  const [desc, setDesc] = useState("");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0,10));
  const [cat, setCat] = useState("otro");
  const add = () => {
    const n = parseFloat(monto);
    if (!n || n <= 0 || !desc) return;
    onAdd({id:uid(), descripcion:desc, monto:n, fecha, categoria:cat, completado:false});
    onClose();
  };
  return (
    <div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",
      alignItems:"flex-end",justifyContent:"center",zIndex:300}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:C.surface,borderRadius:"20px 20px 0 0",padding:22,
        width:"100%",maxWidth:480,border:`1px solid ${C.border}`,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontWeight:700,fontSize:16,marginBottom:16}}>Agregar gasto planeado</div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>Categor&iacute;a</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
            {CATEGORIAS_GASTO.map(c=>(
              <button key={c.id} onClick={()=>setCat(c.id)} style={{
                background:cat===c.id?`${C.gold}22`:C.s2,
                border:`1px solid ${cat===c.id?C.gold:C.border}`,
                borderRadius:10,padding:"7px 3px",cursor:"pointer",
                display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                <span style={{fontSize:16}}>{c.emoji}</span>
                <span style={{fontSize:8,color:cat===c.id?C.goldL:C.muted,
                  fontWeight:600,textAlign:"center",fontFamily:"inherit"}}>{c.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>Descripci&oacute;n</div>
          <input type="text" value={desc} onChange={e=>setDesc(e.target.value)}
            placeholder="ej. Pago seguro auto..."
            style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:10,
              padding:"9px 12px",color:C.text,outline:"none",width:"100%",fontFamily:"inherit"}}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <div>
            <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>Monto</div>
            <div style={{display:"flex",background:C.s2,border:`1px solid ${C.border}`,
              borderRadius:10,overflow:"hidden"}}>
              <span style={{padding:"0 10px",color:C.muted,fontSize:13,alignSelf:"center"}}>$</span>
              <input type="number" value={monto} onChange={e=>setMonto(e.target.value)}
                style={{flex:1,background:"transparent",border:"none",outline:"none",
                  padding:"9px 4px",color:C.goldL,fontSize:15,fontWeight:700,fontFamily:"monospace"}}/>
            </div>
          </div>
          <div>
            <div style={{fontSize:11,color:C.muted,marginBottom:5,fontWeight:600}}>Fecha</div>
            <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)}
              style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:10,
                padding:"9px 10px",color:C.text,outline:"none",width:"100%",fontFamily:"inherit"}}/>
          </div>
        </div>
        <Btn onClick={add} full>Agregar &#10003;</Btn>
      </div>
    </div>
  );
}

function RecommendationPanel({rec, ingreso}) {
  if (!ingreso || ingreso <= 0) return null;
  return (
    <div style={{background:`${C.gold}0d`,border:`1px solid ${C.gold}33`,
      borderRadius:14,padding:14,marginBottom:14}}>
      <div style={{fontSize:11,color:C.goldL,fontWeight:700,marginBottom:12,
        textTransform:"uppercase",letterSpacing:.5}}>&#9889; Recomendaci&oacute;n semanal</div>

      {rec.pagosTDC.length > 0 && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:10,color:C.red,fontWeight:700,marginBottom:6}}>PAGOS TDC (prioridad)</div>
          {rec.pagosTDC.map((p,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:4,
              padding:"6px 10px",background:`${C.red}11`,borderRadius:8}}>
              <span style={{fontSize:12}}>{p.nombre} (d&iacute;a {p.dia})</span>
              <span style={{fontFamily:"monospace",fontWeight:700,color:C.red,fontSize:12}}>{peso(p.monto)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{marginBottom:10}}>
        <div style={{fontSize:10,color:C.orange,fontWeight:700,marginBottom:6}}>OBLIGACIONES FIJAS</div>
        {rec.obligaciones.map((o,i)=>(
          <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
            <span style={{fontSize:12}}>{o.nombre}{o.dia?` (d\u00eda ${o.dia})`:""}</span>
            <span style={{fontFamily:"monospace",fontWeight:700,color:C.orange,fontSize:12}}>{peso(o.monto)}</span>
          </div>
        ))}
      </div>

      {rec.gpSemana.length > 0 && (
        <div style={{marginBottom:10}}>
          <div style={{fontSize:10,color:C.goldL,fontWeight:700,marginBottom:6}}>GASTOS PLANEADOS</div>
          {rec.gpSemana.map((g,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{fontSize:12}}>{g.nombre}</span>
              <span style={{fontFamily:"monospace",fontWeight:700,color:C.goldL,fontSize:12}}>{peso(g.monto)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:8,marginTop:4,marginBottom:8}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
          <span style={{fontSize:12,color:C.muted}}>Total necesario</span>
          <span style={{fontFamily:"monospace",fontWeight:800,color:C.red,fontSize:13}}>{peso(rec.totalNecesario)}</span>
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
          <div style={{fontSize:10,color:C.green,fontWeight:700,marginBottom:6}}>A CUBETAS NU</div>
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
          <div style={{fontSize:10,color:C.muted,marginTop:4}}>
            Prioridad: Viajes &gt; Acelerador &gt; Beb&eacute; (nunca Salud)
          </div>
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

function ModalSemana({semana, prevSaldo, onSave, onClose, tarjetas, recurrentes, msiList, gastosPlaneados, cuentas, deudas}) {
  const critica = esSemanaCritica(semana.lunes);
  const suraON = semana.lunes <= P.sura_fin;
  const [ramiro, setRamiro] = useState(semana.ramiro ?? 14500);
  const [carolina, setCarolina] = useState(semana.carolina ?? 7500);
  const [banorteDesc, setBanorteDesc] = useState(semana.banorte_descontado ?? false);
  const [items, setItems] = useState(semana.items || []);
  const [nota, setNota] = useState(semana.nota || "");
  const [showAdd, setShowAdd] = useState(false);
  const calc = calcSemana({lunes:semana.lunes,ramiro,carolina,banorte_descontado:banorteDesc,items}, prevSaldo);

  const ingreso = calc.total_ingreso;
  const rec = calcRecomendacion({
    ingreso, semanaLunes: semana.lunes,
    tarjetas, recurrentes, msiList, gastosPlaneados, cuentas, deudas,
  });

  const guardar = () => onSave({
    ...semana, ramiro:Number(ramiro), carolina:Number(carolina),
    banorte_descontado:banorteDesc, items, nota,
    sobrante:calc.sobrante, saldo_acumulado:calc.saldo,
  });
  const catLabel = (id) => CATS.find(c=>c.id===id) || {emoji:"\u{1F4CC}",label:"Otro"};

  const getFuenteLabel = (item) => {
    if (!item.fuente_tipo) return null;
    if (item.fuente_tipo === "tdc") {
      const t = tarjetas.find(x => x.id === item.fuente_id);
      return t ? `${t.emoji} ${t.nombre}` : "TDC";
    }
    const c = cuentas.find(x => x.id === item.fuente_id);
    return c ? `${c.emoji} ${c.nombre}` : "Cuenta";
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#000000cc",zIndex:100,overflowY:"auto",
      display:"flex",justifyContent:"center",padding:16}}>
      <div style={{background:C.surface,borderRadius:20,padding:22,
        width:"100%",maxWidth:520,border:`1px solid ${C.border}`,
        height:"fit-content",marginTop:8,marginBottom:8}}>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18}}>
          <div>
            <div style={{fontWeight:700,fontSize:16,textTransform:"capitalize"}}>
              {new Date(semana.lunes+"T12:00:00").toLocaleDateString("es-MX",
                {weekday:"long",day:"numeric",month:"long"})}
            </div>
            <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
              {critica && <span style={{background:`${C.red}18`,color:C.red,borderRadius:99,
                padding:"2px 10px",fontSize:11,fontWeight:700}}>&#x1F534; Semana hipoteca</span>}
              {!suraON && <span style={{background:`${C.green}18`,color:C.green,borderRadius:99,
                padding:"2px 10px",fontSize:11,fontWeight:700}}>&#x1F4B0; Sura liberado</span>}
            </div>
          </div>
          <button onClick={onClose} style={{background:"none",border:"none",
            color:C.muted,fontSize:22,cursor:"pointer"}}>&#10005;</button>
        </div>

        <div style={{background:C.s2,borderRadius:14,padding:16,marginBottom:14}}>
          <div style={{fontSize:11,color:C.goldL,fontWeight:700,marginBottom:14,
            letterSpacing:1,textTransform:"uppercase"}}>Ingresos</div>

          <div style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",
              alignItems:"center",marginBottom:6}}>
              <span style={{fontSize:12,color:C.muted,fontWeight:600}}>&#x1F464; Ramiro</span>
              <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer"}}
                onClick={()=>setBanorteDesc(!banorteDesc)}>
                <span style={{fontSize:11,color:banorteDesc?C.green:C.muted}}>
                  {banorteDesc?"&#10003; Banorte ya descontado":"Banorte pendiente"}
                </span>
                <div style={{width:34,height:18,background:banorteDesc?C.green:C.border,
                  borderRadius:99,position:"relative",transition:"background .2s"}}>
                  <div style={{position:"absolute",top:2,left:banorteDesc?16:2,width:14,height:14,
                    background:"white",borderRadius:"50%",transition:"left .2s"}}/>
                </div>
              </label>
            </div>
            <div style={{display:"flex",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:10,overflow:"hidden"}}>
              <span style={{padding:"0 10px",color:C.muted,fontSize:13,alignSelf:"center"}}>$</span>
              <input type="number" value={ramiro} onChange={e=>setRamiro(e.target.value)}
                style={{flex:1,background:"transparent",border:"none",outline:"none",
                  padding:"10px 4px",color:C.goldL,fontSize:17,fontWeight:700,fontFamily:"monospace"}}/>
            </div>
            {!banorteDesc && (
              <div style={{fontSize:11,color:C.orange,marginTop:4}}>
                &#9888;&#65039; Se restar&aacute;n {peso(P.banorte_semanal)} de Banorte
              </div>
            )}
          </div>

          <div>
            <div style={{fontSize:12,color:C.muted,fontWeight:600,marginBottom:6}}>
              &#x1F464; Carolina
              <span style={{marginLeft:8,fontSize:10,
                color:suraON?C.orange:C.green}}>
                {suraON ? `\u2022 Sura ${peso(P.sura_semanal)} ya descontado` : "\u2022 Sura liberado +$1,200"}
              </span>
            </div>
            <div style={{display:"flex",background:C.surface,border:`1px solid ${C.border}`,
              borderRadius:10,overflow:"hidden"}}>
              <span style={{padding:"0 10px",color:C.muted,fontSize:13,alignSelf:"center"}}>$</span>
              <input type="number" value={carolina} onChange={e=>setCarolina(e.target.value)}
                style={{flex:1,background:"transparent",border:"none",outline:"none",
                  padding:"10px 4px",color:C.purple,fontSize:17,fontWeight:700,fontFamily:"monospace"}}/>
            </div>
          </div>

          <div style={{display:"flex",justifyContent:"space-between",marginTop:12,
            paddingTop:10,borderTop:`1px solid ${C.border}`}}>
            <span style={{fontSize:13,color:C.muted}}>Total ingreso</span>
            <span style={{fontFamily:"monospace",fontWeight:800,fontSize:17,color:C.goldL}}>
              {peso(calc.total_ingreso)}
            </span>
          </div>
        </div>

        <div style={{marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:11,color:C.red,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>
              Gastos
            </div>
            <button onClick={()=>setShowAdd(true)} style={{background:C.s2,
              border:`1px solid ${C.border}`,color:C.muted,borderRadius:8,
              padding:"5px 12px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              + Agregar
            </button>
          </div>

          {critica && (
            <div style={{display:"flex",justifyContent:"space-between",padding:"9px 12px",
              background:`${C.red}11`,border:`1px solid ${C.red}33`,borderRadius:10,marginBottom:6}}>
              <span style={{fontSize:13}}>&#x1F3E0; Hipoteca Santander</span>
              <span style={{fontFamily:"monospace",fontWeight:700,color:C.red}}>{peso(P.hip_mensual)}</span>
            </div>
          )}
          {!banorteDesc && (
            <div style={{display:"flex",justifyContent:"space-between",padding:"9px 12px",
              background:`${C.orange}11`,border:`1px solid ${C.orange}33`,borderRadius:10,marginBottom:6}}>
              <span style={{fontSize:13}}>&#x1F3E6; Banorte semanal</span>
              <span style={{fontFamily:"monospace",fontWeight:700,color:C.orange}}>{peso(P.banorte_semanal)}</span>
            </div>
          )}

          {items.length === 0 && (
            <div style={{textAlign:"center",padding:18,color:C.muted,fontSize:13,
              background:C.s2,borderRadius:12,border:`1px dashed ${C.border}`}}>
              Sin gastos &mdash; toca "+ Agregar"
            </div>
          )}
          {items.map(item => {
            const c = catLabel(item.cat);
            const fuente = getFuenteLabel(item);
            return (
              <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,
                padding:"9px 12px",background:C.s2,borderRadius:10,marginBottom:6}}>
                <span style={{fontSize:18,width:26}}>{c.emoji}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500}}>{c.label}{item.desc?` \u00b7 ${item.desc}`:""}</div>
                  <div style={{fontSize:11,color:C.muted}}>
                    {item.fecha}
                    {fuente && <span> &middot; {fuente}</span>}
                  </div>
                </div>
                <span style={{fontFamily:"monospace",fontWeight:700,color:C.red,fontSize:14}}>{peso(item.monto)}</span>
                <button onClick={()=>setItems(prev=>prev.filter(i=>i.id!==item.id))}
                  style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:16}}>&#10005;</button>
              </div>
            );
          })}
        </div>

        <div style={{background:C.s2,borderRadius:14,padding:14,marginBottom:14}}>
          {[
            ["Ingreso total", calc.total_ingreso, C.goldL],
            ["\u2212 Deudas/fijos", -(calc.banorte_pago+calc.hip_pago), C.red],
            ["\u2212 Gastos variables", -calc.items_total, C.orange],
            null,
            ["= Sobrante", calc.sobrante, calc.sobrante>=0?C.green:C.red],
            ["Saldo buffer", calc.saldo, calc.saldo>=P.minimo_op?C.goldL:C.red],
          ].map((row,i) => row ? (
            <div key={i} style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:12,color:C.muted}}>{row[0]}</span>
              <span style={{fontFamily:"monospace",fontWeight:700,fontSize:13,color:row[2]}}>{peso(row[1])}</span>
            </div>
          ) : <div key={i} style={{borderTop:`1px solid ${C.border}`,margin:"7px 0"}}/>)}
          {calc.saldo < P.minimo_op && (
            <div style={{background:`${C.red}18`,borderRadius:8,padding:"8px 12px",marginTop:8,
              fontSize:11,color:C.red,fontWeight:600}}>
              &#x1F6A8; Buffer absorbe d&eacute;ficit de {peso(P.minimo_op - calc.saldo)}
            </div>
          )}
        </div>

        <RecommendationPanel rec={rec} ingreso={ingreso} />

        <div style={{marginBottom:14}}>
          <input value={nota} onChange={e=>setNota(e.target.value)}
            placeholder="Nota de la semana..."
            style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:10,
              padding:"9px 12px",color:C.text,outline:"none",width:"100%",fontFamily:"inherit"}}/>
        </div>
        <Btn onClick={guardar} full>Guardar semana &#10003;</Btn>
      </div>
      {showAdd && <AddGasto onAdd={item=>setItems(p=>[...p,item])} onClose={()=>setShowAdd(false)}
        tarjetas={tarjetas} cuentas={cuentas}/>}
    </div>
  );
}

function TransferPanel({cuentas, onTransfer}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [monto, setMonto] = useState("");
  const [show, setShow] = useState(false);

  const doTransfer = () => {
    const n = parseFloat(monto);
    if (!n || n <= 0 || !from || !to || from === to) return;
    onTransfer(from, to, n);
    setMonto(""); setFrom(""); setTo(""); setShow(false);
  };

  if (!show) {
    return (
      <button onClick={()=>setShow(true)} style={{width:"100%",background:C.s2,
        border:`1px solid ${C.border}`,borderRadius:12,padding:"12px",
        color:C.muted,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
        &#8644; Transferir entre cuentas
      </button>
    );
  }

  return (
    <Card style={{padding:16}}>
      <div style={{fontSize:11,color:C.goldL,fontWeight:700,marginBottom:12,textTransform:"uppercase",letterSpacing:.5}}>
        Transferir entre cuentas
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:10}}>
        <div>
          <div style={{fontSize:10,color:C.muted,marginBottom:4}}>De</div>
          <select value={from} onChange={e=>setFrom(e.target.value)}
            style={{width:"100%",background:C.s2,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"8px",color:C.text,outline:"none",fontFamily:"inherit",fontSize:12}}>
            <option value="">Seleccionar...</option>
            {cuentas.map(c=><option key={c.id} value={c.id}>{c.emoji} {c.nombre}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:10,color:C.muted,marginBottom:4}}>A</div>
          <select value={to} onChange={e=>setTo(e.target.value)}
            style={{width:"100%",background:C.s2,border:`1px solid ${C.border}`,borderRadius:8,
              padding:"8px",color:C.text,outline:"none",fontFamily:"inherit",fontSize:12}}>
            <option value="">Seleccionar...</option>
            {cuentas.map(c=><option key={c.id} value={c.id}>{c.emoji} {c.nombre}</option>)}
          </select>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <div style={{display:"flex",flex:1,background:C.s2,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
          <span style={{padding:"0 8px",color:C.muted,fontSize:13,alignSelf:"center"}}>$</span>
          <input type="number" value={monto} onChange={e=>setMonto(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&doTransfer()}
            placeholder="Monto"
            style={{flex:1,background:"transparent",border:"none",outline:"none",
              padding:"9px 4px",color:C.goldL,fontSize:14,fontWeight:700,fontFamily:"monospace"}}/>
        </div>
        <Btn onClick={doTransfer} small>Transferir</Btn>
        <button onClick={()=>setShow(false)} style={{background:C.s2,color:C.muted,
          border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px",cursor:"pointer"}}>&#10005;</button>
      </div>
    </Card>
  );
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [semanas, setSemanas] = useState([]);
  const [cuentas, setCuentas] = useState([]);
  const [deudas, setDeudas] = useState({banorte:836435,hipoteca:1400898});
  const [ready, setReady] = useState(false);
  const [editSemana, setEditSemana] = useState(null);
  const [editDeudas, setEditDeudas] = useState(false);
  const [tarjetas, setTarjetas] = useState([]);
  const [recurrentes, setRecurrentes] = useState([]);
  const [msiList, setMsiList] = useState([]);
  const [gastosPlaneados, setGastosPlaneados] = useState([]);
  const [expandedTDC, setExpandedTDC] = useState(null);
  const [showAddPlaneado, setShowAddPlaneado] = useState(false);
  const [editTDCSaldo, setEditTDCSaldo] = useState(null);

  // Legacy cubetas state for fallback
  const [cubetasLegacy, setCubetasLegacy] = useState(null);

  useEffect(()=>{
    (async()=>{
      const [s, cubLegacy, d, t, r, m, gp, ctas] = await Promise.all([
        loadSemanas(), loadCubetas(), loadDeudas(),
        loadTarjetas(), loadRecurrentes(), loadMsi(), loadGastosPlaneados(),
        loadCuentas(),
      ]);
      if(s && s.length > 0) setSemanas(s);
      if(cubLegacy) setCubetasLegacy(cubLegacy);
      if(d) setDeudas(d);
      setTarjetas(t||[]);
      setRecurrentes(r||[]);
      setMsiList(m||[]);
      setGastosPlaneados(gp||[]);

      // Use cuentas if available, otherwise fallback to legacy cubetas
      if (ctas && ctas.length > 0) {
        setCuentas(ctas);
      } else if (cubLegacy) {
        // Fallback: build virtual cuentas from legacy cubetas
        const fallbackCubetas = [
          {id:"nu_salud", nombre:"Fondo de Salud", banco:"Nu", tipo:"cubeta", emoji:"\u{1F3E5}", color:"#059669", saldo:cubLegacy.salud||0, meta:600000, pct_ahorro:30, orden:10},
          {id:"nu_bebe", nombre:"Educaci\u00f3n Beb\u00e9", banco:"Nu", tipo:"cubeta", emoji:"\u{1F476}", color:"#7c3aed", saldo:cubLegacy.bebe||0, meta:300000, pct_ahorro:25, orden:11},
          {id:"nu_viajes", nombre:"Vacaciones / Jap\u00f3n", banco:"Nu", tipo:"cubeta", emoji:"\u2708\uFE0F", color:"#d97706", saldo:cubLegacy.viajes||0, meta:200000, pct_ahorro:25, orden:12},
          {id:"nu_acelerador", nombre:"Mata Banorte / ETF", banco:"Nu", tipo:"cubeta", emoji:"\u{1F525}", color:"#dc2626", saldo:cubLegacy.acelerador||0, meta:836435, pct_ahorro:20, orden:13},
          {id:"banamex", nombre:"Banamex (principal)", banco:"Banamex", tipo:"ahorro", emoji:"\u{1F3E6}", color:"#2563eb", saldo:88000, meta:0, pct_ahorro:0, orden:1},
        ];
        setCuentas(fallbackCubetas);
      }
      setReady(true);
    })();
  },[]);

  const saveDeu = async(v)=>{setDeudas(v); await saveDeudas(v);};

  // Derived values from cuentas
  const ctasCubeta = cuentas.filter(c => c.tipo === "cubeta");
  const ctasBanco = cuentas.filter(c => c.tipo !== "cubeta");
  const reservaTDC = cuentas.find(c => c.id === "reserva_tdc");
  const totalCubetas = ctasCubeta.reduce((a, c) => a + (Number(c.saldo) || 0), 0);
  const totalBanco = ctasBanco.reduce((a, c) => a + (Number(c.saldo) || 0), 0);
  const totalCuentas = cuentas.reduce((a, c) => a + (Number(c.saldo) || 0), 0);

  const hoyLunes = getMondayOf();
  const sorted = [...semanas].sort((a,b)=>a.lunes.localeCompare(b.lunes));

  const getPrevSaldo = (lunesStr) => {
    const idx = sorted.findIndex(s=>s.lunes===lunesStr);
    return idx<=0 ? P.buffer_inicial : (sorted[idx-1]?.saldo_acumulado ?? P.buffer_inicial);
  };

  const bufferActual = sorted.length>0 ? sorted[sorted.length-1].saldo_acumulado : P.buffer_inicial;
  const totalDeudaTDC = tarjetas.reduce((a, t) => a + (Number(t.saldo_actual) || 0), 0);
  const patrimonioNeto = totalCuentas - deudas.banorte - deudas.hipoteca - totalDeudaTDC;
  const semanaHoy = semanas.find(s=>s.lunes===hoyLunes);
  const critHoy = esSemanaCritica(hoyLunes);

  const totalRecurrentesMes = recurrentes.filter(r => r.activo !== false).reduce((a, r) => a + (Number(r.monto) || 0), 0);
  const totalMSIMes = msiList.filter(m => m.meses_pagados < m.total_meses).reduce((a, m) => a + (Number(m.mensualidad) || 0), 0);

  const guardarSemana = async(s) => {
    const prev = getPrevSaldo(s.lunes);
    const calc = calcSemana(s, prev);
    const full = {...s, sobrante:calc.sobrante, saldo_acumulado:calc.saldo};
    const idx = sorted.findIndex(x=>x.lunes===s.lunes);
    const nueva = idx>=0
      ? sorted.map((x,i)=>i===idx?full:x)
      : [...sorted,full].sort((a,b)=>a.lunes.localeCompare(b.lunes));
    setSemanas(nueva);
    await upsertSemana(full);
    setEditSemana(null);
  };

  const abrirSemana = (lunes=hoyLunes) => {
    setEditSemana(semanas.find(s=>s.lunes===lunes) ?? {lunes});
  };

  const actualizarSaldoTDC = async (id, nuevoSaldo) => {
    const t = tarjetas.find(x => x.id === id);
    if (!t) return;
    const updated = { ...t, saldo_actual: Number(nuevoSaldo) };
    setTarjetas(prev => prev.map(x => x.id === id ? updated : x));
    await upsertTarjeta(updated);
    setEditTDCSaldo(null);
  };

  const agregarGastoPlaneado = async (g) => {
    setGastosPlaneados(prev => [...prev, g].sort((a, b) => a.fecha.localeCompare(b.fecha)));
    await upsertGastoPlaneado(g);
    setShowAddPlaneado(false);
  };

  const eliminarGastoPlaneado = async (id) => {
    setGastosPlaneados(prev => prev.filter(g => g.id !== id));
    await deleteGastoPlaneado(id);
  };

  const actualizarSaldoCuenta = async (id, nuevoSaldo) => {
    setCuentas(prev => prev.map(c => c.id === id ? {...c, saldo: Number(nuevoSaldo)} : c));
    await updateSaldoCuenta(id, Number(nuevoSaldo));
  };

  const depositarCubeta = async (id, n) => {
    const cta = cuentas.find(c => c.id === id);
    if (!cta) return;
    const nuevoSaldo = (Number(cta.saldo) || 0) + n;
    setCuentas(prev => prev.map(c => c.id === id ? {...c, saldo: nuevoSaldo} : c));
    await updateSaldoCuenta(id, nuevoSaldo);
  };

  const retirarCubeta = async (id, n) => {
    const cta = cuentas.find(c => c.id === id);
    if (!cta) return;
    const nuevoSaldo = Math.max(0, (Number(cta.saldo) || 0) - n);
    setCuentas(prev => prev.map(c => c.id === id ? {...c, saldo: nuevoSaldo} : c));
    await updateSaldoCuenta(id, nuevoSaldo);
  };

  const transferirEntreCuentas = async (fromId, toId, monto) => {
    const from = cuentas.find(c => c.id === fromId);
    const to = cuentas.find(c => c.id === toId);
    if (!from || !to) return;
    const newFromSaldo = Math.max(0, (Number(from.saldo) || 0) - monto);
    const newToSaldo = (Number(to.saldo) || 0) + monto;
    setCuentas(prev => prev.map(c => {
      if (c.id === fromId) return {...c, saldo: newFromSaldo};
      if (c.id === toId) return {...c, saldo: newToSaldo};
      return c;
    }));
    await updateSaldoCuenta(fromId, newFromSaldo);
    await updateSaldoCuenta(toId, newToSaldo);
    await insertMovimiento({
      id: uid(), fecha: new Date().toISOString().slice(0,10),
      tipo: "transferencia", cuenta_origen: fromId, cuenta_destino: toId,
      monto, descripcion: `${from.nombre} \u2192 ${to.nombre}`,
    });
  };

  if(!ready) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",
      justifyContent:"center",color:C.muted,fontSize:14}}>Cargando...</div>
  );

  const TABS=[
    {id:"home",label:"Inicio",icon:"\u{1F3E0}"},
    {id:"semana",label:"Semana",icon:"\u{1F4C5}"},
    {id:"tarjetas",label:"TDC",icon:"\u{1F4B3}"},
    {id:"planeacion",label:"Plan",icon:"\u{1F4CA}"},
    {id:"cuentas",label:"Cuentas",icon:"\u{1F4B0}"},
  ];

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"system-ui,sans-serif"}}>
      <div style={{position:"sticky",top:0,zIndex:50,background:`${C.bg}f0`,
        backdropFilter:"blur(12px)",borderBottom:`1px solid ${C.border}33`}}>
        <div style={{maxWidth:560,margin:"0 auto",padding:"11px 16px",
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontWeight:800,fontSize:14,color:C.goldL,letterSpacing:1}}>FINANZAS&middot;CASA</div>
            <div style={{fontSize:10,color:C.muted,fontFamily:"monospace",marginTop:1}}>
              patrimonio {peso(patrimonioNeto)}
            </div>
          </div>
          <div style={{display:"flex",gap:3}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                background:tab===t.id?`${C.gold}22`:"transparent",
                border:`1px solid ${tab===t.id?`${C.gold}77`:C.border}`,
                color:tab===t.id?C.goldL:C.muted,
                borderRadius:8,padding:"5px 7px",fontSize:10,fontWeight:700,
                cursor:"pointer",fontFamily:"inherit",display:"flex",flexDirection:"column",
                alignItems:"center",gap:1,minWidth:44
              }}>
                <span style={{fontSize:14}}>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:560,margin:"0 auto",padding:"20px 16px 50px"}}>

        {tab==="home" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{background:`linear-gradient(135deg,${C.surface},${C.s2})`,
              border:`1px solid ${C.border}`,borderRadius:20,padding:24,
              position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:-50,right:-50,width:200,height:200,
                background:`radial-gradient(${C.gold}0d,transparent 70%)`,borderRadius:"50%",pointerEvents:"none"}}/>
              <div style={{fontSize:11,color:C.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>
                Patrimonio Neto
              </div>
              <div style={{fontFamily:"monospace",fontWeight:900,fontSize:36,
                color:patrimonioNeto>=0?C.goldL:C.red,marginBottom:20}}>
                {peso(patrimonioNeto)}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                {[
                  ["\u{1F3E6}","Cuentas",totalBanco,C.green],
                  ["\u{1FA63}","Cubetas",totalCubetas,C.purple],
                  ["\u{1F6E1}\uFE0F","Reserva TDC",reservaTDC?Number(reservaTDC.saldo):0,C.orange],
                  ["\u{1F4B3}","Deuda TDC",-totalDeudaTDC,C.red],
                ].map(([e,l,v,c])=>(
                  <div key={l}>
                    <div style={{fontSize:10,color:C.muted}}>{e} {l}</div>
                    <div style={{fontFamily:"monospace",fontWeight:800,fontSize:15,color:c,marginTop:3}}>
                      {peso(v)}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{borderTop:`1px solid ${C.border}`,marginTop:14,paddingTop:10,
                display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                {[
                  ["\u{1F3E0}","Hipoteca",-deudas.hipoteca,"#818cf8"],
                  ["\u{1F3E6}","Banorte",-deudas.banorte,C.red],
                ].map(([e,l,v,c])=>(
                  <div key={l}>
                    <div style={{fontSize:10,color:C.muted}}>{e} {l}</div>
                    <div style={{fontFamily:"monospace",fontWeight:800,fontSize:15,color:c,marginTop:3}}>
                      {peso(v)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div>
                  <div style={{fontWeight:700,fontSize:14}}>Esta semana</div>
                  <div style={{fontSize:11,color:C.muted,marginTop:2,textTransform:"capitalize"}}>
                    {new Date(hoyLunes+"T12:00:00").toLocaleDateString("es-MX",
                      {weekday:"long",day:"numeric",month:"long"})}
                  </div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  {critHoy && <span style={{background:`${C.red}18`,color:C.red,
                    borderRadius:99,padding:"2px 8px",fontSize:10,fontWeight:700}}>&#x1F534;</span>}
                  <Btn onClick={()=>abrirSemana()} small>
                    {semanaHoy?"Editar":"Registrar"}
                  </Btn>
                </div>
              </div>
              {semanaHoy ? (
                <>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
                    {[
                      ["Sobrante",semanaHoy.sobrante,semanaHoy.sobrante>=0?C.green:C.red],
                      ["Saldo buffer",semanaHoy.saldo_acumulado,semanaHoy.saldo_acumulado>=P.minimo_op?C.goldL:C.red],
                    ].map(([l,v,c])=>(
                      <div key={l} style={{background:C.s2,borderRadius:12,padding:"12px 14px"}}>
                        <div style={{fontSize:11,color:C.muted,marginBottom:3}}>{l}</div>
                        <div style={{fontFamily:"monospace",fontWeight:800,fontSize:19,color:c}}>
                          {v>=0?"+":""}{peso(v)}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div style={{textAlign:"center",padding:"16px 0",color:C.muted,fontSize:13}}>
                  Semana no registrada &mdash; toca "Registrar"
                </div>
              )}
            </Card>

            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:14}}>Deudas activas</div>
                <button onClick={()=>setEditDeudas(!editDeudas)}
                  style={{background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:12}}>
                  {editDeudas?"&#10003; Listo":"Editar saldos"}
                </button>
              </div>
              {[
                {k:"hipoteca",label:"Hipoteca Santander",inicial:1800000,color:"#818cf8"},
                {k:"banorte",label:"Cr\u00e9dito Banorte",inicial:836435,color:C.red},
              ].map(d=>{
                const s=deudas[d.k]; const p=1-s/d.inicial;
                return (
                  <div key={d.k} style={{marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                      <span style={{fontSize:13,fontWeight:500}}>{d.label}</span>
                      {editDeudas ? (
                        <input type="number" defaultValue={s}
                          onBlur={async e=>await saveDeu({...deudas,[d.k]:+e.target.value})}
                          style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:8,
                            padding:"3px 8px",color:C.goldL,fontFamily:"monospace",
                            fontSize:13,width:120,textAlign:"right",outline:"none"}}/>
                      ) : (
                        <span style={{fontFamily:"monospace",fontSize:13,color:d.color,fontWeight:700}}>
                          {peso(s)}
                        </span>
                      )}
                    </div>
                    <div style={{background:C.s2,borderRadius:99,height:5,overflow:"hidden"}}>
                      <div style={{width:`${p*100}%`,height:"100%",background:d.color,
                        borderRadius:99,transition:"width .5s"}}/>
                    </div>
                    <div style={{fontSize:10,color:C.muted,marginTop:3}}>{(p*100).toFixed(1)}% liquidado</div>
                  </div>
                );
              })}
              {totalDeudaTDC > 0 && (
                <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10,marginTop:4}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontSize:13,fontWeight:500}}>Deuda TDC total</span>
                    <span style={{fontFamily:"monospace",fontSize:13,color:C.red,fontWeight:700}}>{peso(totalDeudaTDC)}</span>
                  </div>
                </div>
              )}
            </Card>

            {sorted.length>0 && (
              <Card>
                <div style={{fontWeight:700,fontSize:14,marginBottom:14}}>Historial reciente</div>
                {[...sorted].reverse().slice(0,6).map(s=>{
                  const critica=esSemanaCritica(s.lunes);
                  return (
                    <div key={s.lunes} onClick={()=>abrirSemana(s.lunes)}
                      style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                        padding:"10px 12px",background:C.s2,borderRadius:10,marginBottom:6,
                        cursor:"pointer",borderLeft:`3px solid ${s.sobrante>=0?C.green:C.red}`}}>
                      <div>
                        <div style={{fontSize:12,fontWeight:500,textTransform:"capitalize"}}>
                          {new Date(s.lunes+"T12:00:00").toLocaleDateString("es-MX",
                            {day:"2-digit",month:"short"})}
                          {critica&&<span style={{marginLeft:6,color:C.red,fontSize:10}}>&#x1F534;</span>}
                        </div>
                        <div style={{fontSize:11,color:C.muted,marginTop:1}}>
                          {(s.items||[]).length} gastos
                        </div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:"monospace",fontWeight:700,fontSize:14,
                          color:s.sobrante>=0?C.green:C.red}}>
                          {s.sobrante>=0?"+":""}{peso(s.sobrante)}
                        </div>
                        <div style={{fontFamily:"monospace",fontSize:10,color:C.muted}}>
                          {peso(s.saldo_acumulado)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        )}

        {tab==="semana" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,fontSize:18}}>Semanas</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                  Buffer: <span style={{color:C.goldL,fontWeight:700}}>{peso(bufferActual)}</span>
                  <span style={{color:C.muted}}> &middot; m&iacute;n {peso(P.minimo_op)}</span>
                </div>
              </div>
              <Btn onClick={()=>abrirSemana()}>{semanaHoy?"Editar semana actual":"+ Esta semana"}</Btn>
            </div>

            <Card style={{padding:14}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                <span style={{fontSize:13,color:C.muted}}>Buffer operativo</span>
                <span style={{fontFamily:"monospace",fontWeight:800,
                  color:bufferActual>=P.minimo_op?C.green:C.red}}>{peso(bufferActual)}</span>
              </div>
              <div style={{background:C.s2,borderRadius:99,height:8,overflow:"hidden"}}>
                <div style={{
                  width:`${Math.min(100,bufferActual/P.buffer_inicial*100)}%`,height:"100%",
                  background:`linear-gradient(90deg,${bufferActual<P.minimo_op?C.red:C.green},${C.goldL})`,
                  borderRadius:99,transition:"width .5s"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",
                fontSize:10,color:C.muted,marginTop:4}}>
                <span>&#x1F534; M&iacute;n {peso(P.minimo_op)}</span>
                <span>Inicial {peso(P.buffer_inicial)}</span>
              </div>
            </Card>

            {[...Array(10)].map((_,i)=>{
              const d=new Date(hoyLunes+"T12:00:00");
              d.setDate(d.getDate()-i*7);
              const lunes=d.toISOString().slice(0,10);
              const reg=semanas.find(s=>s.lunes===lunes);
              const critica=esSemanaCritica(lunes);
              return (
                <div key={lunes} onClick={()=>abrirSemana(lunes)}
                  style={{background:C.surface,border:`1px solid ${reg?C.border:`${C.border}55`}`,
                    borderRadius:14,padding:"14px 16px",cursor:"pointer",opacity:reg?1:.65,
                    borderLeft:`3px solid ${reg?(reg.sobrante>=0?C.green:C.red):C.border}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:600,textTransform:"capitalize"}}>
                        {d.toLocaleDateString("es-MX",{weekday:"long",day:"numeric",month:"long"})}
                        {i===0&&<span style={{marginLeft:8,fontSize:10,color:C.gold,fontWeight:600}}>&bull; HOY</span>}
                        {critica&&<span style={{marginLeft:8,color:C.red,fontSize:11}}>&#x1F534;</span>}
                      </div>
                      <div style={{fontSize:11,color:C.muted,marginTop:3}}>
                        {reg?`${(reg.items||[]).length} gastos \u00b7 ${peso(reg.items?.reduce((a,i)=>a+(i.monto||0),0)||0)}`:"Sin registrar \u2014 toca para ingresar"}
                      </div>
                    </div>
                    {reg&&(
                      <div style={{textAlign:"right"}}>
                        <div style={{fontFamily:"monospace",fontWeight:700,fontSize:15,
                          color:reg.sobrante>=0?C.green:C.red}}>
                          {reg.sobrante>=0?"+":""}{peso(reg.sobrante)}
                        </div>
                        <div style={{fontFamily:"monospace",fontSize:11,color:C.muted}}>
                          {peso(reg.saldo_acumulado)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab==="cuentas" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div>
              <div style={{fontWeight:700,fontSize:18}}>Cuentas</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                Total: <span style={{color:C.goldL,fontWeight:700}}>{peso(totalCuentas)}</span>
                <span style={{margin:"0 6px"}}>&middot;</span>
                Banco: <span style={{color:C.green,fontWeight:700}}>{peso(totalBanco)}</span>
                <span style={{margin:"0 6px"}}>&middot;</span>
                Cubetas: <span style={{color:C.purple,fontWeight:700}}>{peso(totalCubetas)}</span>
              </div>
            </div>

            {/* Cuentas bancarias */}
            <div>
              <div style={{fontSize:11,color:C.goldL,fontWeight:700,marginBottom:10,
                textTransform:"uppercase",letterSpacing:.5}}>&#x1F3E6; Cuentas bancarias</div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {ctasBanco.map(c=>(
                  <CuentaCard key={c.id} cta={c} onUpdate={actualizarSaldoCuenta}/>
                ))}
              </div>
            </div>

            {/* Cubetas Nu */}
            <div>
              <div style={{fontSize:11,color:C.purple,fontWeight:700,marginBottom:10,
                textTransform:"uppercase",letterSpacing:.5}}>&#x1FA63; Cubetas Nu</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
                {ctasCubeta.map(c=>(
                  <CubetaCard key={c.id} cub={c}
                    onDeposit={depositarCubeta}
                    onWithdraw={retirarCubeta}
                  />
                ))}
              </div>
            </div>

            {/* Transferencias */}
            <TransferPanel cuentas={cuentas} onTransfer={transferirEntreCuentas}/>
          </div>
        )}

        {tab==="tarjetas" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div>
              <div style={{fontWeight:700,fontSize:18}}>Tarjetas de Cr&eacute;dito</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                Deuda total: <span style={{color:C.red,fontWeight:700}}>{peso(totalDeudaTDC)}</span>
                <span style={{margin:"0 6px"}}>&middot;</span>
                Recurrentes: <span style={{color:C.orange,fontWeight:700}}>{peso(totalRecurrentesMes)}</span>/mes
              </div>
            </div>

            {tarjetas.map(t => {
              const uso = t.limite_credito > 0 ? t.saldo_actual / t.limite_credito : 0;
              const diasCorte = diasHasta(t.fecha_corte);
              const diasPago = diasHasta(t.fecha_pago);
              const recTDC = recurrentes.filter(r => r.tarjeta_id === t.id && r.activo !== false);
              const msiTDC = msiList.filter(m => m.tarjeta_id === t.id && m.meses_pagados < m.total_meses);
              const expanded = expandedTDC === t.id;
              const totalRecTDC = recTDC.reduce((a, r) => a + Number(r.monto), 0);
              return (
                <div key={t.id} style={{background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:16,overflow:"hidden"}}>
                  <div style={{position:"relative"}}>
                    <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:t.color}}/>
                    <div style={{padding:18,cursor:"pointer"}} onClick={()=>setExpandedTDC(expanded?null:t.id)}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{fontSize:20}}>{t.emoji}</span>
                          <div>
                            <div style={{fontWeight:700,fontSize:14}}>{t.nombre}</div>
                            <div style={{fontSize:11,color:C.muted}}>{t.banco} &middot; ****{t.ultimos4}</div>
                          </div>
                        </div>
                        <div style={{textAlign:"right"}}>
                          {editTDCSaldo===t.id ? (
                            <div style={{display:"flex",gap:4}} onClick={e=>e.stopPropagation()}>
                              <input type="number" defaultValue={t.saldo_actual} autoFocus
                                onKeyDown={e=>{if(e.key==="Enter")actualizarSaldoTDC(t.id,e.target.value)}}
                                style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:8,
                                  padding:"4px 8px",color:C.goldL,fontFamily:"monospace",fontSize:13,
                                  width:100,textAlign:"right",outline:"none"}}/>
                              <button onClick={()=>setEditTDCSaldo(null)} style={{background:"none",
                                border:"none",color:C.muted,cursor:"pointer"}}>&#10005;</button>
                            </div>
                          ) : (
                            <div onClick={e=>{e.stopPropagation();setEditTDCSaldo(t.id)}}
                              style={{cursor:"pointer"}}>
                              <div style={{fontFamily:"monospace",fontWeight:800,fontSize:18,color:t.color}}>
                                {peso(t.saldo_actual)}
                              </div>
                              {t.limite_credito>0 && (
                                <div style={{fontSize:10,color:C.muted}}>de {peso(t.limite_credito)}</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {t.limite_credito > 0 && (
                        <div style={{marginTop:12}}>
                          <div style={{background:C.s2,borderRadius:99,height:6,overflow:"hidden"}}>
                            <div style={{width:`${Math.min(100,uso*100)}%`,height:"100%",
                              background:uso>0.7?C.red:uso>0.4?C.orange:C.green,
                              borderRadius:99,transition:"width .5s"}}/>
                          </div>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:10,
                            color:C.muted,marginTop:4}}>
                            <span>{(uso*100).toFixed(0)}% utilizado</span>
                            <span>Disponible {peso(t.limite_credito - t.saldo_actual)}</span>
                          </div>
                        </div>
                      )}

                      <div style={{display:"flex",gap:12,marginTop:12}}>
                        <div style={{background:C.s2,borderRadius:8,padding:"6px 10px",flex:1,textAlign:"center"}}>
                          <div style={{fontSize:10,color:C.muted}}>Corte</div>
                          <div style={{fontSize:12,fontWeight:700,color:diasCorte<=3?C.orange:C.text}}>
                            D&iacute;a {t.fecha_corte} <span style={{fontSize:10,color:C.muted}}>({diasCorte}d)</span>
                          </div>
                        </div>
                        <div style={{background:C.s2,borderRadius:8,padding:"6px 10px",flex:1,textAlign:"center"}}>
                          <div style={{fontSize:10,color:C.muted}}>Pago</div>
                          <div style={{fontSize:12,fontWeight:700,color:diasPago<=5?C.red:C.text}}>
                            D&iacute;a {t.fecha_pago} <span style={{fontSize:10,color:C.muted}}>({diasPago}d)</span>
                          </div>
                        </div>
                      </div>

                      <div style={{textAlign:"center",marginTop:10}}>
                        <span style={{fontSize:11,color:C.muted}}>
                          {expanded?"\u25B2 Cerrar":"\u25BC Ver detalle"} &middot; {recTDC.length} rec. &middot; {msiTDC.length} MSI
                        </span>
                      </div>
                    </div>
                  </div>

                  {expanded && (
                    <div style={{borderTop:`1px solid ${C.border}`,padding:18}}>
                      {recTDC.length > 0 && (
                        <div style={{marginBottom:16}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                            <div style={{fontSize:11,color:C.orange,fontWeight:700,textTransform:"uppercase",
                              letterSpacing:.5}}>Cargos recurrentes</div>
                            <span style={{fontSize:11,color:C.muted}}>Total {peso(totalRecTDC)}/mes</span>
                          </div>
                          {recTDC.map(r => {
                            const diasR = r.dia_cargo ? diasHasta(r.dia_cargo) : null;
                            return (
                              <div key={r.id} style={{display:"flex",justifyContent:"space-between",
                                alignItems:"center",padding:"8px 10px",background:C.s2,borderRadius:8,
                                marginBottom:4}}>
                                <div>
                                  <div style={{fontSize:12,fontWeight:500}}>{r.nombre}</div>
                                  <div style={{fontSize:10,color:C.muted}}>
                                    D&iacute;a {r.dia_cargo} &middot; {r.categoria||"general"}
                                    {diasR !== null && diasR <= 7 && (
                                      <span style={{color:C.gold}}> &middot; en {diasR}d</span>
                                    )}
                                  </div>
                                </div>
                                <span style={{fontFamily:"monospace",fontWeight:700,fontSize:13,color:C.orange}}>
                                  {peso(r.monto)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {msiTDC.length > 0 && (
                        <div>
                          <div style={{fontSize:11,color:C.purple,fontWeight:700,textTransform:"uppercase",
                            letterSpacing:.5,marginBottom:10}}>MSI / Diferidos</div>
                          {msiTDC.map(m => {
                            const progreso = m.total_meses > 0 ? m.meses_pagados / m.total_meses : 0;
                            const restantes = m.total_meses - m.meses_pagados;
                            return (
                              <div key={m.id} style={{background:C.s2,borderRadius:10,padding:12,marginBottom:6}}>
                                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                                  <div>
                                    <div style={{fontSize:12,fontWeight:600}}>{m.descripcion}</div>
                                    <div style={{fontSize:10,color:C.muted}}>
                                      {m.con_intereses?`Tasa ${m.tasa_interes}%`:`${m.total_meses} MSI`} &middot; {restantes} meses rest.
                                    </div>
                                  </div>
                                  <div style={{textAlign:"right"}}>
                                    <div style={{fontFamily:"monospace",fontWeight:700,fontSize:14,color:C.purple}}>
                                      {peso(m.mensualidad)}<span style={{fontSize:10,color:C.muted}}>/mes</span>
                                    </div>
                                    <div style={{fontSize:10,color:C.muted}}>de {peso(m.monto_original)}</div>
                                  </div>
                                </div>
                                <div style={{background:C.surface,borderRadius:99,height:5,overflow:"hidden"}}>
                                  <div style={{width:`${progreso*100}%`,height:"100%",
                                    background:m.con_intereses?C.red:C.purple,borderRadius:99,
                                    transition:"width .5s"}}/>
                                </div>
                                <div style={{display:"flex",justifyContent:"space-between",fontSize:10,
                                  color:C.muted,marginTop:3}}>
                                  <span>{m.meses_pagados} de {m.total_meses} pagados</span>
                                  <span>{(progreso*100).toFixed(0)}%</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {recTDC.length === 0 && msiTDC.length === 0 && (
                        <div style={{textAlign:"center",padding:16,color:C.muted,fontSize:13}}>
                          Sin cargos recurrentes ni MSI
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {tarjetas.length > 0 && (
              <Card>
                <div style={{fontSize:11,color:C.muted,fontWeight:700,marginBottom:12,
                  textTransform:"uppercase",letterSpacing:.5}}>Resumen mensual TDC</div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontSize:13}}>Total recurrentes</span>
                  <span style={{fontFamily:"monospace",fontWeight:700,color:C.orange}}>{peso(totalRecurrentesMes)}</span>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <span style={{fontSize:13}}>Total MSI / diferidos</span>
                  <span style={{fontFamily:"monospace",fontWeight:700,color:C.purple}}>{peso(totalMSIMes)}</span>
                </div>
                <div style={{borderTop:`1px solid ${C.border}`,paddingTop:8,marginTop:4,
                  display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:13,fontWeight:700}}>Total mensual TDC</span>
                  <span style={{fontFamily:"monospace",fontWeight:800,color:C.red,fontSize:16}}>
                    {peso(totalRecurrentesMes + totalMSIMes)}
                  </span>
                </div>
              </Card>
            )}
          </div>
        )}

        {tab==="planeacion" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontWeight:700,fontSize:18}}>Planeaci&oacute;n</div>
                <div style={{fontSize:12,color:C.muted,marginTop:2}}>Pr&oacute;ximas 8 semanas</div>
              </div>
              <Btn onClick={()=>setShowAddPlaneado(true)} small>+ Gasto</Btn>
            </div>

            {(() => {
              const weeks = [];
              for (let i = 0; i < 8; i++) {
                const d = new Date(hoyLunes+"T12:00:00");
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
                const recSemana = recurrentes.filter(r => r.activo !== false && dias.includes(r.dia_cargo));
                const pagosTDC = tarjetas.filter(t => dias.includes(t.fecha_pago));
                const gpSemana = gastosPlaneados.filter(g => !g.completado && g.fecha >= w.lunes && g.fecha <= w.domingo);
                const totalRec = recSemana.reduce((a, r) => a + Number(r.monto), 0);
                const totalGP = gpSemana.reduce((a, g) => a + Number(g.monto), 0);
                const totalSemana = totalRec + totalGP;
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
                      {totalSemana > 0 && (
                        <span style={{fontFamily:"monospace",fontWeight:800,fontSize:14,
                          color:totalSemana>15000?C.red:C.orange}}>
                          {peso(totalSemana)}
                        </span>
                      )}
                    </div>

                    {pagosTDC.map(t => (
                      <div key={`pago-${t.id}`} style={{display:"flex",justifyContent:"space-between",
                        alignItems:"center",padding:"7px 10px",background:`${C.red}11`,
                        border:`1px solid ${C.red}22`,borderRadius:8,marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span>{t.emoji}</span>
                          <div>
                            <div style={{fontSize:12,fontWeight:600,color:C.red}}>Pago {t.nombre}</div>
                            <div style={{fontSize:10,color:C.muted}}>D&iacute;a {t.fecha_pago}</div>
                          </div>
                        </div>
                        <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:C.red}}>
                          {peso(t.saldo_actual)}
                        </span>
                      </div>
                    ))}

                    {recSemana.map(r => {
                      const tdc = tarjetas.find(x => x.id === r.tarjeta_id);
                      return (
                        <div key={r.id} style={{display:"flex",justifyContent:"space-between",
                          alignItems:"center",padding:"7px 10px",background:C.s2,borderRadius:8,
                          marginBottom:4}}>
                          <div>
                            <div style={{fontSize:12,fontWeight:500}}>{r.nombre}</div>
                            <div style={{fontSize:10,color:C.muted}}>
                              D&iacute;a {r.dia_cargo} &middot; {tdc?tdc.nombre:""}
                            </div>
                          </div>
                          <span style={{fontFamily:"monospace",fontWeight:700,fontSize:12,color:C.orange}}>
                            {peso(r.monto)}
                          </span>
                        </div>
                      );
                    })}

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

                    {pagosTDC.length===0 && recSemana.length===0 && gpSemana.length===0 && (
                      <div style={{textAlign:"center",padding:8,color:C.muted,fontSize:12}}>
                        Sin eventos esta semana
                      </div>
                    )}
                  </Card>
                );
              });
            })()}
          </div>
        )}
      </div>

      {editSemana&&(
        <ModalSemana semana={editSemana} prevSaldo={getPrevSaldo(editSemana.lunes)}
          onSave={guardarSemana} onClose={()=>setEditSemana(null)}
          tarjetas={tarjetas} recurrentes={recurrentes} msiList={msiList}
          gastosPlaneados={gastosPlaneados} cuentas={cuentas} deudas={deudas}/>
      )}
      {showAddPlaneado && (
        <AddGastoPlaneado onAdd={agregarGastoPlaneado} onClose={()=>setShowAddPlaneado(false)}/>
      )}
    </div>
  );
}
