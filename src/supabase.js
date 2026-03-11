import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- Semanas ---

export async function loadSemanas() {
  const { data, error } = await supabase
    .from("semanas")
    .select("*")
    .order("lunes", { ascending: true });
  if (error) {
    console.error("loadSemanas error:", error);
    return [];
  }
  return data.map((row) => ({
    lunes: row.lunes,
    ramiro: row.ramiro,
    carolina: row.carolina,
    banorte_descontado: row.banorte_descontado,
    items: row.items || [],
    nota: row.nota || "",
    sobrante: row.sobrante,
    saldo_acumulado: row.saldo_acumulado,
  }));
}

export async function upsertSemana(semana) {
  const { error } = await supabase.from("semanas").upsert(
    {
      lunes: semana.lunes,
      ramiro: semana.ramiro,
      carolina: semana.carolina,
      banorte_descontado: semana.banorte_descontado,
      items: semana.items || [],
      nota: semana.nota || "",
      sobrante: semana.sobrante,
      saldo_acumulado: semana.saldo_acumulado,
    },
    { onConflict: "lunes" }
  );
  if (error) console.error("upsertSemana error:", error);
}

// --- Cubetas ---

export async function loadCubetas() {
  const { data, error } = await supabase.from("cubetas").select("*");
  if (error) {
    console.error("loadCubetas error:", error);
    return null;
  }
  if (!data || data.length === 0) return null;
  const row = data[0];
  return {
    salud: row.salud,
    bebe: row.bebe,
    viajes: row.viajes,
    acelerador: row.acelerador,
  };
}

export async function saveCubetas(cubetas) {
  // Always upsert row with id=1 (singleton)
  const { error } = await supabase.from("cubetas").upsert(
    {
      id: 1,
      salud: cubetas.salud,
      bebe: cubetas.bebe,
      viajes: cubetas.viajes,
      acelerador: cubetas.acelerador,
    },
    { onConflict: "id" }
  );
  if (error) console.error("saveCubetas error:", error);
}

// --- Deudas ---

export async function loadDeudas() {
  const { data, error } = await supabase.from("deudas").select("*");
  if (error) {
    console.error("loadDeudas error:", error);
    return null;
  }
  if (!data || data.length === 0) return null;
  const row = data[0];
  return {
    banorte: row.banorte,
    hipoteca: row.hipoteca,
  };
}

export async function saveDeudas(deudas) {
  const { error } = await supabase.from("deudas").upsert(
    {
      id: 1,
      banorte: deudas.banorte,
      hipoteca: deudas.hipoteca,
    },
    { onConflict: "id" }
  );
  if (error) console.error("saveDeudas error:", error);
}
