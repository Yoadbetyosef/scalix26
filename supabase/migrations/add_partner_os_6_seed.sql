-- Migration: Partner OS (6/6) — Seed Academy + Marketing starter content, partition helper.
-- Idempotent. Run in Supabase SQL Editor AFTER migrations 1–5.

-- ── Referral clicks: next-month partition helper (called by /api/partner/cron) ──
CREATE OR REPLACE FUNCTION ensure_referral_clicks_partition()
RETURNS void AS $$
DECLARE m date := date_trunc('month', now() + interval '1 month')::date;
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS referral_clicks_%s PARTITION OF referral_clicks FOR VALUES FROM (%L) TO (%L)',
    to_char(m, 'YYYY_MM'), m, (m + interval '1 month')::date);
END $$ LANGUAGE plpgsql;

-- ── Seed a starter certification course ──
INSERT INTO courses (id, title, description, sort, cert_on_complete, active)
SELECT '00000000-0000-4000-a000-000000000001', 'Scalix26 Sales Certification',
       'Learn to position, demo, and close Scalix26. Pass the exam to earn your Certified Partner badge.', 0, true, true
WHERE NOT EXISTS (SELECT 1 FROM courses WHERE id = '00000000-0000-4000-a000-000000000001');

INSERT INTO lessons (course_id, title, body, sort, quiz)
SELECT '00000000-0000-4000-a000-000000000001', v.title, v.body, v.sort, v.quiz::jsonb
FROM (VALUES
  ('What is Scalix26?', 'Scalix26 gives every small business an AI employee that answers calls, texts, and messages 24/7 — booking jobs and capturing leads so owners never miss revenue.', 0, NULL),
  ('Who to sell to', 'Target local service businesses (locksmiths, HVAC, salons, clinics) that miss calls and lose leads. Your referral link + a personalized demo is all you need.', 1, NULL),
  ('Running a killer demo', 'Generate a branded demo from the prospect''s website in seconds, then let them chat with their own AI receptionist live. Seeing is believing — the demo closes the deal.', 2, NULL),
  ('Handling objections', 'Price: it costs less than one missed job/month. Trust: it uses their real business info and always offers a human handoff. Setup: onboarding is minutes, not weeks.', 3, NULL),
  ('Certification exam', 'Answer the questions to earn your badge.', 4,
   '[{"q":"What core problem does Scalix26 solve?","options":["Missed calls & lost leads","Bookkeeping","Payroll"],"answer_index":0},{"q":"What is the fastest way to close a prospect?","options":["A cold email","A personalized live demo","A long PDF"],"answer_index":1},{"q":"Best-fit customer?","options":["Fortune 500","Local service business that misses calls","Software startups"],"answer_index":1}]')
) AS v(title, body, sort, quiz)
WHERE NOT EXISTS (SELECT 1 FROM lessons WHERE course_id = '00000000-0000-4000-a000-000000000001' AND title = v.title);

-- ── Seed a few starter marketing assets ──
INSERT INTO marketing_assets (title, description, category, file_url, tags, active)
SELECT v.title, v.description, v.category, v.file_url, v.tags::text[], true
FROM (VALUES
  ('Scalix26 One-Pager', 'A concise overview to send prospects.', 'one_pager', 'https://scalix26.com/one-pager.pdf', ARRAY['overview','pdf']),
  ('Cold Call Script', 'Proven opener + objection handling for phone outreach.', 'script', 'https://scalix26.com/cold-call-script.pdf', ARRAY['calling','script']),
  ('Sales Deck', 'The core pitch deck for meetings.', 'deck', 'https://scalix26.com/sales-deck.pdf', ARRAY['deck','pitch']),
  ('SMS Templates', 'Ready-to-send follow-up texts.', 'template', 'https://scalix26.com/sms-templates.pdf', ARRAY['sms','follow-up'])
) AS v(title, description, category, file_url, tags)
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = v.title);
