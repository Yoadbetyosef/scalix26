-- Migration: Partner OS (7) — enable Supabase Realtime on partner_notifications so the portal's
-- notification bell updates live (a 60s poll remains as fallback). Idempotent. Run after 1–6.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'partner_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE partner_notifications;
  END IF;
END $$;
