-- ============================================
-- MIGRATION V4: pago_pendiente en tarjetas
-- ============================================

-- Agregar columna pago_pendiente para monto manual del estado de cuenta
alter table tarjetas add column if not exists pago_pendiente numeric default 0;
