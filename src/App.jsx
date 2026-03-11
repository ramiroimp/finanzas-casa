import { useState, useEffect } from "react";
import {
  loadSemanas,
  upsertSemana,
  loadCubetas,
  saveCubetas,
  loadDeudas,
  saveDeudas,
} from "./supabase";

const P = {
  buffer_inicial: 109000, minimo_op: 25000,
  banorte_semanal: 5642, sura_semanal: 1200,
  sura_fin: "2026-07-10", hip_mensual: 16149, hip_dia: 3,
};

const CUBETAS_DEF = [
  { id:"salud",       nombre:"Fondo de Salud",    emoji:"\u{1F3E5}", meta:600000, color:"#059669", pct:30 },
  { id:"bebe",        nombre:"Educaci\u00f3n Beb\u00e9",     emoji:"\u{1F476}", meta:300000, color:"#7c3aed", pct:25 },
  { id:"viajes",      nombre:"Vacaciones / Jap\u00f3n", emoji:"\u2708\uFE0F", meta:200000, color:"#d97706", pct:25 },
  { id:"acelerador",  nombre:"Mata Banorte / ETF", emoji:"\u{1F525}", meta:836435, color:"#dc2626", pct:20 },
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

function CubetaCard({cub, saldo, onDeposit, onWithdraw}) {
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

function AddGasto({onAdd, onClose}) {
  const [cat, setCat] = useState("super");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0,10));
  const [desc, setDesc] = useState("");
  const selCat = CATS.find(c=>c.id===cat);
  useEffect(()=>{ if(selCat?.def>0) setMonto(String(selCat.def)); }, [cat]);
  const add = () => {
    const n = parseFloat(monto);
    if (!n || n <= 0) return;
    onAdd({id:uid(), cat, desc, monto:n, fecha});
    onClose();
  };
  return (
    <div style={{position:"fixed",inset:0,background:"#000000cc",display:"flex",
      alignItems:"flex-end",justifyContent:"center",zIndex:300}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:C.surface,borderRadius:"20px 20px 0 0",padding:22,
        width:"100%",maxWidth:480,border:`1px solid ${C.border}`}}>
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

function ModalSemana({semana, prevSaldo, onSave, onClose}) {
  const critica = esSemanaCritica(semana.lunes);
  const suraON = semana.lunes <= P.sura_fin;
  const [ramiro, setRamiro] = useState(semana.ramiro ?? 14500);
  const [carolina, setCarolina] = useState(semana.carolina ?? 7500);
  const [banorteDesc, setBanorteDesc] = useState(semana.banorte_descontado ?? false);
  const [items, setItems] = useState(semana.items || []);
  const [nota, setNota] = useState(semana.nota || "");
  const [showAdd, setShowAdd] = useState(false);
  const calc = calcSemana({lunes:semana.lunes,ramiro,carolina,banorte_descontado:banorteDesc,items}, prevSaldo);
  const dist = CUBETAS_DEF.map(c=>({...c, monto: calc.sobrante>0 ? calc.sobrante*c.pct/100 : 0}));
  const guardar = () => onSave({
    ...semana, ramiro:Number(ramiro), carolina:Number(carolina),
    banorte_descontado:banorteDesc, items, nota,
    sobrante:calc.sobrante, saldo_acumulado:calc.saldo,
  });
  const catLabel = (id) => CATS.find(c=>c.id===id) || {emoji:"\u{1F4CC}",label:"Otro"};

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
            return (
              <div key={item.id} style={{display:"flex",alignItems:"center",gap:10,
                padding:"9px 12px",background:C.s2,borderRadius:10,marginBottom:6}}>
                <span style={{fontSize:18,width:26}}>{c.emoji}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:500}}>{c.label}{item.desc?` \u00b7 ${item.desc}`:""}</div>
                  <div style={{fontSize:11,color:C.muted}}>{item.fecha}</div>
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

        {calc.sobrante > 0 && (
          <div style={{background:`${C.gold}0d`,border:`1px solid ${C.gold}33`,
            borderRadius:14,padding:14,marginBottom:14}}>
            <div style={{fontSize:11,color:C.goldL,fontWeight:700,marginBottom:10,
              textTransform:"uppercase",letterSpacing:.5}}>&#9889; Mover a Nu esta semana</div>
            {dist.map(c=>(
              <div key={c.id} style={{display:"flex",justifyContent:"space-between",
                alignItems:"center",marginBottom:7}}>
                <span style={{fontSize:13}}>{c.emoji} {c.nombre}</span>
                <span style={{fontFamily:"monospace",fontWeight:800,fontSize:15,color:c.color}}>
                  {peso(c.monto)}
                </span>
              </div>
            ))}
            <div style={{borderTop:`1px solid ${C.border}`,marginTop:8,paddingTop:8,
              display:"flex",justifyContent:"space-between"}}>
              <span style={{fontSize:12,color:C.muted}}>Total a transferir</span>
              <span style={{fontFamily:"monospace",fontWeight:800,color:C.goldL,fontSize:15}}>
                {peso(dist.reduce((a,c)=>a+c.monto,0))}
              </span>
            </div>
          </div>
        )}

        <div style={{marginBottom:14}}>
          <input value={nota} onChange={e=>setNota(e.target.value)}
            placeholder="Nota de la semana..."
            style={{background:C.s2,border:`1px solid ${C.border}`,borderRadius:10,
              padding:"9px 12px",color:C.text,outline:"none",width:"100%",fontFamily:"inherit"}}/>
        </div>
        <Btn onClick={guardar} full>Guardar semana &#10003;</Btn>
      </div>
      {showAdd && <AddGasto onAdd={item=>setItems(p=>[...p,item])} onClose={()=>setShowAdd(false)}/>}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("home");
  const [semanas, setSemanas] = useState([]);
  const [cubetas, setCubetas] = useState({salud:0,bebe:0,viajes:0,acelerador:0});
  const [deudas, setDeudas] = useState({banorte:836435,hipoteca:1400898});
  const [ready, setReady] = useState(false);
  const [editSemana, setEditSemana] = useState(null);
  const [editDeudas, setEditDeudas] = useState(false);

  useEffect(()=>{
    (async()=>{
      const [s, c, d] = await Promise.all([
        loadSemanas(),
        loadCubetas(),
        loadDeudas(),
      ]);
      if(s && s.length > 0) setSemanas(s);
      if(c) setCubetas(c);
      if(d) setDeudas(d);
      setReady(true);
    })();
  },[]);

  const saveCub = async(v)=>{setCubetas(v); await saveCubetas(v);};
  const saveDeu = async(v)=>{setDeudas(v); await saveDeudas(v);};

  const hoyLunes = getMondayOf();
  const sorted = [...semanas].sort((a,b)=>a.lunes.localeCompare(b.lunes));

  const getPrevSaldo = (lunesStr) => {
    const idx = sorted.findIndex(s=>s.lunes===lunesStr);
    return idx<=0 ? P.buffer_inicial : (sorted[idx-1]?.saldo_acumulado ?? P.buffer_inicial);
  };

  const bufferActual = sorted.length>0 ? sorted[sorted.length-1].saldo_acumulado : P.buffer_inicial;
  const totalCubetas = Object.values(cubetas).reduce((a,b)=>a+b,0);
  const patrimonioNeto = bufferActual + totalCubetas - deudas.banorte - deudas.hipoteca;
  const semanaHoy = semanas.find(s=>s.lunes===hoyLunes);
  const critHoy = esSemanaCritica(hoyLunes);

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

  if(!ready) return (
    <div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",
      justifyContent:"center",color:C.muted,fontSize:14}}>Cargando...</div>
  );

  const TABS=[{id:"home",label:"Dashboard"},{id:"semana",label:"Semana"},{id:"cubetas",label:"Cubetas"}];

  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"system-ui,sans-serif"}}>
      <div style={{position:"sticky",top:0,zIndex:50,background:`${C.bg}f0`,
        backdropFilter:"blur(12px)",borderBottom:`1px solid ${C.border}33`}}>
        <div style={{maxWidth:560,margin:"0 auto",padding:"11px 16px",
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontWeight:800,fontSize:14,color:C.goldL,letterSpacing:1}}>MARRO&middot;FINANZAS</div>
            <div style={{fontSize:10,color:C.muted,fontFamily:"monospace",marginTop:1}}>
              buffer {peso(bufferActual)}
            </div>
          </div>
          <div style={{display:"flex",gap:4}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                background:tab===t.id?`${C.gold}22`:"transparent",
                border:`1px solid ${tab===t.id?`${C.gold}77`:C.border}`,
                color:tab===t.id?C.goldL:C.muted,
                borderRadius:8,padding:"6px 12px",fontSize:12,fontWeight:700,
                cursor:"pointer",fontFamily:"inherit"
              }}>{t.label}</button>
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
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
                {[
                  ["&#x1F4B0;","Buffer",bufferActual,bufferActual>=P.minimo_op?C.green:C.red],
                  ["&#x1FA63;","Cubetas",totalCubetas,C.purple],
                  ["&#x1F4C9;","Deudas",-deudas.banorte-deudas.hipoteca,C.red],
                ].map(([e,l,v,c])=>(
                  <div key={l}>
                    <div style={{fontSize:10,color:C.muted}} dangerouslySetInnerHTML={{__html:`${e} ${l}`}}/>
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
                  {semanaHoy.sobrante>0 && (
                    <div style={{background:`${C.gold}0d`,border:`1px solid ${C.gold}22`,
                      borderRadius:12,padding:14}}>
                      <div style={{fontSize:11,color:C.goldL,fontWeight:700,marginBottom:10,
                        textTransform:"uppercase",letterSpacing:.5}}>&#9889; Mover a Nu hoy</div>
                      {CUBETAS_DEF.map(c=>(
                        <div key={c.id} style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                          <span style={{fontSize:13}}>{c.emoji} {c.nombre}</span>
                          <span style={{fontFamily:"monospace",fontWeight:700,color:c.color,fontSize:13}}>
                            {peso(semanaHoy.sobrante*c.pct/100)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
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

        {tab==="cubetas" && (
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div>
              <div style={{fontWeight:700,fontSize:18}}>Cubetas Nu</div>
              <div style={{fontSize:12,color:C.muted,marginTop:2}}>
                Total: <span style={{color:C.goldL,fontWeight:700}}>{peso(totalCubetas)}</span>
              </div>
            </div>

            {semanaHoy&&semanaHoy.sobrante>0&&(
              <div style={{background:`${C.gold}0d`,border:`1px solid ${C.gold}33`,
                borderRadius:16,padding:18}}>
                <div style={{fontSize:11,color:C.goldL,fontWeight:700,marginBottom:12,
                  textTransform:"uppercase",letterSpacing:.5}}>&#9889; Transferir a Nu esta semana</div>
                {CUBETAS_DEF.map(c=>(
                  <div key={c.id} style={{display:"flex",justifyContent:"space-between",
                    alignItems:"center",marginBottom:8}}>
                    <span style={{fontSize:13}}>{c.emoji} {c.nombre}</span>
                    <span style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:c.color}}>
                      {peso(semanaHoy.sobrante*c.pct/100)}
                    </span>
                  </div>
                ))}
                <div style={{borderTop:`1px solid ${C.border}`,marginTop:8,paddingTop:8,
                  display:"flex",justifyContent:"space-between"}}>
                  <span style={{fontSize:12,color:C.muted}}>Total a transferir</span>
                  <span style={{fontFamily:"monospace",fontWeight:800,color:C.goldL}}>
                    {peso(semanaHoy.sobrante)}
                  </span>
                </div>
              </div>
            )}

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              {CUBETAS_DEF.map(c=>(
                <CubetaCard key={c.id} cub={c} saldo={cubetas[c.id]||0}
                  onDeposit={async(id,n)=>await saveCub({...cubetas,[id]:(cubetas[id]||0)+n})}
                  onWithdraw={async(id,n)=>await saveCub({...cubetas,[id]:Math.max(0,(cubetas[id]||0)-n)})}
                />
              ))}
            </div>

            <Card>
              <div style={{fontSize:11,color:C.muted,fontWeight:700,marginBottom:12,
                textTransform:"uppercase",letterSpacing:.5}}>&#x1F3E6; Sistema poka-yoke</div>
              {[
                {b:"Banorte",r:"Buffer operativo",n:"$109K viven aqu\u00ed. Hipoteca y Banorte domiciliados.",c:C.red},
                {b:"Nu \u2014 4 Cajas",r:"Cubetas patrimoniales",n:"Una caja por meta. ~14% anual. Fricci\u00f3n = poka-yoke.",c:"#a855f7"},
                {b:"GNP",r:"Retiro $8,139/mes",n:"Cargo a TDC. Deducible fiscal. No tocar.",c:C.green},
                {b:"Sura (Carolina)",r:"Ya descontado",n:"Se libera jul-2026. +$1,200/sem a cubetas.",c:C.orange},
              ].map(x=>(
                <div key={x.b} style={{display:"flex",marginBottom:10,background:C.s2,
                  borderRadius:12,padding:"12px 14px",borderLeft:`3px solid ${x.c}`}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:700,color:x.c}}>{x.b}</div>
                    <div style={{fontSize:11,color:C.text,marginTop:1}}>{x.r}</div>
                    <div style={{fontSize:10,color:C.muted,marginTop:3,lineHeight:1.5}}>{x.n}</div>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        )}
      </div>

      {editSemana&&(
        <ModalSemana semana={editSemana} prevSaldo={getPrevSaldo(editSemana.lunes)}
          onSave={guardarSemana} onClose={()=>setEditSemana(null)}/>
      )}
    </div>
  );
}
