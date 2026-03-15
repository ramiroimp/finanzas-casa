# Pago TDC — Registro de pagos a tarjetas de crédito

## Problema

Cuando el usuario paga una TDC, debe hacer dos pasos manuales desconectados: ajustar el saldo de la cuenta en el tab Cuentas y poner `pago_pendiente` en 0 en la tarjeta. No queda registro de qué cuenta pagó qué tarjeta, ni cuándo, ni por cuánto. Si hace pagos parciales (caso activo: un amigo paga parte de una tarjeta durante 10 meses), no hay forma de llevar el tracking.

## Solución

Agregar un botón **"Abonar"** en la vista expandida de cada tarjeta que ejecuta 3 operaciones secuenciales: descuenta de una cuenta bancaria, registra un movimiento tipo `pago_tdc`, y reduce el `pago_pendiente` de la tarjeta. La tarjeta muestra un historial de abonos del ciclo actual.

Las 3 operaciones NO son atómicas (son llamadas Supabase independientes). Si alguna falla, se muestra un alert con el error y se revierte el estado local optimista. No se usa RPC/transacción para mantener la simplicidad del proyecto (single-file app sin backend propio).

## Filosofía

Los movimientos estratégicos (pagos de TDC, transferencias) los registra el usuario manualmente para mantener atención y disciplina. La herramienta es para planear y auditar, no para automatizar todo.

## Modelo de datos

### Cambio a tabla existente

```sql
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS tarjeta_id text;
```

- Nullable — solo se usa para movimientos de tipo `pago_tdc`
- Referencia al `id` de la tarjeta pagada
- No se agrega FK formal para mantener simplicidad
- `cuenta_destino` ya es nullable en la tabla existente

### Campos del movimiento `pago_tdc`

| Campo | Valor |
|---|---|
| `id` | ID corto generado con `uid()` (7 chars alfanuméricos, patrón existente en el proyecto) |
| `fecha` | Fecha actual ISO `YYYY-MM-DD` |
| `tipo` | `"pago_tdc"` |
| `cuenta_origen` | ID de la cuenta desde donde se paga |
| `cuenta_destino` | se omite del insert (nullable, no aplica para pagos TDC) |
| `tarjeta_id` | ID de la tarjeta pagada |
| `monto` | Cantidad pagada |
| `descripcion` | `"Pago {nombre_tarjeta} desde {nombre_cuenta}"` |

### No se necesitan nuevas tablas

Se reutiliza `movimientos` (ya existe) y `pago_pendiente` (ya existe en `tarjetas`).

## Migración

La migración SQL (`ALTER TABLE`) debe ejecutarse manualmente en el SQL Editor de Supabase **antes** de deployar el código. Misma mecánica que migraciones anteriores (v4, v5).

## Flujo de usuario

1. Usuario abre el tab **TDC** y expande una tarjeta
2. Toca botón **"Abonar"**
3. Aparece formulario inline (no modal) debajo del botón:
   - **Dropdown "De"**: cuentas bancarias con saldo visible, filtradas por `c.tipo !== "cubeta"` (excluye cubetas)
   - **Monto**: pre-llenado con `pago_pendiente` actual, editable
   - **Texto informativo**:
     - Si monto === pendiente: *"Pago total — se marcará como saldada"*
     - Si monto < pendiente: *"Pago parcial — quedarán $X pendientes"*
     - Si monto > pendiente: *"Sobrepago — el excedente de $X no se registra como crédito"*
   - **Botones**: "Registrar pago" (dorado) + "Cancelar"
4. Al confirmar, se ejecutan 3 operaciones secuenciales con manejo de error:
   ```js
   try {
     // 1. Actualizar estado local optimista
       // 2. updateSaldoCuenta(cuentaId, saldoActual - monto) — verificar error
     // 3. insertMovimiento({...}) — verificar error
     // 4. upsertTarjeta({...pago_pendiente: Math.max(0, pendiente - monto)}) — verificar error
   } catch (e) {
     // Revertir estado local, mostrar alert("Error al registrar pago")
   }
   ```
5. UI se actualiza inmediatamente (optimista), se revierte si falla

## Validaciones

- Monto > 0
- Monto <= saldo de la cuenta origen (no permitir sobregiro)
- Cuenta seleccionada
- Si monto > pago_pendiente: permitir pero pago_pendiente queda en 0

## Historial de abonos en la tarjeta

Debajo de la sección `pago_pendiente`, se muestra "Abonos este ciclo":

```
Abonos este ciclo
  15-mar  Santander Débito    $5,000
  22-mar  Santander Débito    $3,000
  Total abonado: $8,000
```

### Cálculo del ciclo actual

El ciclo de facturación va de `fecha_corte + 1` (mes anterior) a `fecha_corte` (mes actual). `fecha_corte` es un entero (día del mes). Para derivar las fechas ISO del ciclo:

```js
function cicloActualTDC(fechaCorte) {
  const hoy = new Date();
  const y = hoy.getFullYear(), m = hoy.getMonth();
  // Si hoy <= fecha_corte, el ciclo empezó el mes pasado y termina este mes
  // Si hoy > fecha_corte, el ciclo empezó este mes y termina el próximo
  let inicioAnio, inicioMes, finAnio, finMes;
  if (hoy.getDate() <= fechaCorte) {
    inicioMes = m - 1; inicioAnio = y;
    if (inicioMes < 0) { inicioMes = 11; inicioAnio--; }
    finMes = m; finAnio = y;
  } else {
    inicioMes = m; inicioAnio = y;
    finMes = m + 1; finAnio = y;
    if (finMes > 11) { finMes = 0; finAnio++; }
  }
  const inicio = new Date(inicioAnio, inicioMes, fechaCorte + 1).toISOString().slice(0,10);
  const fin = new Date(finAnio, finMes, fechaCorte).toISOString().slice(0,10);
  return { inicio, fin };
}
```

Los abonos se consultan con un query dedicado filtrado por `tipo = 'pago_tdc'` y `tarjeta_id`, sin depender del límite de 50 movimientos generales:

```js
// Nueva función en supabase.js
export async function loadAbonosTDC(tarjetaId, fechaInicio, fechaFin) {
  const { data, error } = await supabase
    .from("movimientos")
    .select("*")
    .eq("tipo", "pago_tdc")
    .eq("tarjeta_id", tarjetaId)
    .gte("fecha", fechaInicio)
    .lte("fecha", fechaFin)
    .order("fecha", { ascending: true });
  if (error) { console.error("loadAbonosTDC error:", error); return []; }
  return data || [];
}
```

Esto evita que el límite de 50 movimientos generales oculte abonos en escenarios de pagos parciales frecuentes.

### Si no hay abonos

No se muestra la sección "Abonos este ciclo".

## Manejo de errores

Las funciones existentes (`updateSaldoCuenta`, `insertMovimiento`, `upsertTarjeta`) hacen `console.error` pero no lanzan excepciones ni retornan el error. Para este flujo, se crean variantes que retornan `{ error }` o se modifica el handler de pago para llamar directo a `supabase.from(...)` con verificación de `error`. Si cualquier paso falla:

1. Se revierte el estado local (cuentas, tarjetas) al snapshot previo
2. Se muestra `alert("Error al registrar el pago. Verifica tu conexión.")`
3. No se intenta rollback en Supabase (el usuario puede corregir manualmente si hay inconsistencia parcial — escenario muy raro)

## Interacción con el motor de recomendación

Cuando `pago_pendiente` llega a 0 tras un pago total, `calcRecomendacion` dejará de incluir esa tarjeta en los apartados semanales (`montoMensual` será 0 porque no hay recurrentes pendientes ni monto manual). Esto ya funciona con la lógica existente:

```js
const pagoMensual = Number(t.pago_pendiente) > 0 ? Number(t.pago_pendiente) : autoCalc;
```

Si es pago parcial, el `pago_pendiente` reducido se usa como nuevo monto mensual para el cálculo de semanas restantes.

## UI — Ubicación del botón "Abonar"

En la vista expandida de cada tarjeta (tab TDC), después de la sección de `pago_pendiente` y antes de la lista de recurrentes:

```
Pago pendiente del corte: $8,642  [Limpiar]
[Abonar]  ← NUEVO

Abonos este ciclo          ← NUEVO (si hay abonos)
  15-mar  Santander  $5,000
  Total abonado: $5,000

Recurrentes que se cargan:
  Totalplay (día 19)    $770
  ...
```

## Supabase functions

```js
// Nueva en supabase.js:
export async function loadAbonosTDC(tarjetaId, fechaInicio, fechaFin) { ... }

// Se reutiliza insertMovimiento existente, solo con tipo "pago_tdc" y tarjeta_id
```

## Componentes afectados

| Componente | Cambio |
|---|---|
| Vista expandida de tarjeta (tab TDC) | Agregar botón "Abonar", formulario inline, historial de abonos |
| `App()` estado | Agregar estado para abonos por tarjeta, cargar con `loadAbonosTDC` |
| `supabase.js` | Agregar `loadAbonosTDC` |
| Migración SQL | Un `ALTER TABLE` para agregar `tarjeta_id` |

## Fuera de alcance

- Automatización de gastos vía email (proyecto separado)
- Reset automático de `pago_pendiente` al inicio de nuevo ciclo (manual por ahora)
- Notificaciones de pago
- Transacciones atómicas vía RPC (no justificado para este proyecto)
