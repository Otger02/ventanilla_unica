-- Migration: Add assigned_to_label to invoices
-- Allows assigning responsibility per invoice (e.g., "Yo", "Asesor", free text)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'invoices'
      AND column_name = 'assigned_to_label'
  ) THEN
    ALTER TABLE public.invoices ADD COLUMN assigned_to_label text DEFAULT NULL;
  END IF;
END
$$;
