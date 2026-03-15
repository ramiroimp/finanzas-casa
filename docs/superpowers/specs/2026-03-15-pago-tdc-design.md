# Pago TDC — Registro de pagos a tarjetas de crédito

## Problema

Cuando el usuario paga una TDC, debe hacer dos pasos manuales desconectados: ajustar el saldo de la cuenta en el tab Cuentas y poner `pago_pendiente` en 0 en la tarjeta. No queda registro de qué cuenta pagó qué tarjeta, ni cuándo, ni por cuánto. Si hace pagos parciales (caso activo: un amigo paga parte de una tarjeta durante 10 meses), no hay forma de llevar el tracking.

## Solución

Agregar un botón **"Abonar"** en la vista expandida de cada tarjeta que ejecuta 3 operaciones atómicas: descuenta de una cuenta bancaria, registra un movimiento tipo `pago_tdc`, y reduce el `pago_pendiente` de la tarjeta. La tarjeta muestra un historial de abonos del ciclo actual.

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

### Campos del movimiento `pago_tdc`

| Campo | Valor |
|---|---|
| `id` | UUID generado con `uid()` |
| `fecha` | Fecha actual ISO `YYYY-MM-DD` |
| `tipo` | `"pago_tdc"` |
| `cuenta_origen` | ID de la cuenta desde donde se paga |
| `cuenta_destino` | `null` |
| `tarjeta_id` | ID de la tarjeta pagada |
| `monto` | Cantidad pagada |
| `descripcion` | `"Pago {nombre_tarjeta} desde {nombre_cuenta}"` |

### No se necesitan nuevas tablas

Se reutiliza `movimientos` (ya existe) y `pago_pendiente` (ya existe en `tarjetas`).

## Flujo de usuario

1. Usuario abre el tab **Deudas** y expande una tarjeta
2. Toca botón **"Abonar"**
3. Aparece formulario inline (no modal) debajo del botón:
   - **Dropdown "De"**: cuentas bancarias con saldo visible (excluye cubetas)
   - **Monto**: pre-llenado con `pago_pendiente` actual, editable
   - **Texto informativo**: "Pago total — se marcará como saldada" o "Pago parcial — quedarán $X pendientes"
   - **Botones**: "Registrar pago" (dorado) + "Cancelar"
4. Al confirmar, se ejecutan 3 operaciones:
   - `updateSaldoCuenta(cuentaId, saldoActual - monto)`
   - `insertMovimiento({id, fecha, tipo: "pago_tdc", cuenta_origen, tarjeta_id, monto, descripcion})`
   - `upsertTarjeta({...tarjeta, pago_pendiente: Math.max(0, pendienteActual - monto)})`
5. UI se actualiza inmediatamente (estados locales + Supabase)

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

El ciclo de facturación va de `fecha_corte + 1` (mes anterior) a `fecha_corte` (mes actual). Los abonos se filtran client-side de los movimientos ya cargados:

```js
const abonosCiclo = movimientos
  .filter(m => m.tipo === "pago_tdc" && m.tarjeta_id === tarjeta.id)
  .filter(m => m.fecha > fechaInicioCorte && m.fecha <= fechaFinCorte);
```

Se usa la lista de movimientos existente (últimos 50, ya cargados en `useEffect`). 50 es suficiente para cubrir 1-2 ciclos.

### Si no hay abonos

No se muestra la sección "Abonos este ciclo".

## Interacción con el motor de recomendación

Cuando `pago_pendiente` llega a 0 tras un pago total, `calcRecomendacion` dejará de incluir esa tarjeta en los apartados semanales (`montoMensual` será 0 porque no hay recurrentes pendientes ni monto manual). Esto ya funciona con la lógica existente:

```js
const pagoMensual = Number(t.pago_pendiente) > 0 ? Number(t.pago_pendiente) : autoCalc;
```

Si es pago parcial, el `pago_pendiente` reducido se usa como nuevo monto mensual para el cálculo de semanas restantes.

## UI — Ubicación del botón "Abonar"

En la vista expandida de cada tarjeta, después de la sección de `pago_pendiente` y antes de la lista de recurrentes:

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

## Supabase functions nuevas

```js
// En supabase.js — NO se agrega función nueva
// Se reutiliza insertMovimiento existente, solo con tipo "pago_tdc" y tarjeta_id
```

No se necesita `loadMovimientos` nuevo — la función actual ya carga los últimos 50 movimientos que incluirán los de tipo `pago_tdc`.

## Componentes afectados

| Componente | Cambio |
|---|---|
| Vista expandida de tarjeta (~línea 1649) | Agregar botón "Abonar", formulario inline, historial de abonos |
| `App()` estado | Ninguno — `movimientos` ya se cargan |
| `supabase.js` | Ninguno — se reutiliza `insertMovimiento` |
| Migración SQL | Un `ALTER TABLE` para agregar `tarjeta_id` |

## Fuera de alcance

- Automatización de gastos vía email (proyecto separado)
- Reset automático de `pago_pendiente` al inicio de nuevo ciclo (manual por ahora)
- Notificaciones de pago
