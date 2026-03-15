-- v6: Add tarjeta_id to movimientos for TDC payment tracking
ALTER TABLE movimientos ADD COLUMN IF NOT EXISTS tarjeta_id text;
