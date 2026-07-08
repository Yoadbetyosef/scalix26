-- Migration: Growth OS Sprint 4 (Marketing OS polish) — content-based asset library + favorites.
-- The old seeded assets pointed at non-existent scalix26.com/*.pdf files (broken downloads). We move
-- to CONTENT-based assets: real copy the partner can preview in-app and download as a file (never a
-- 404). Adds collections + favorites. Idempotent. Run after growth_os_3.

ALTER TABLE marketing_assets ALTER COLUMN file_url DROP NOT NULL;           -- content-based assets have no external file
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS content text;         -- the actual copy (preview + download)
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS collection text;      -- Sales | Marketing | Ads | Follow-up | Brand | Case Studies | Vertical Kits
ALTER TABLE marketing_assets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_marketing_assets_collection ON marketing_assets(collection) WHERE active;

-- Retire the old placeholder-URL assets (their downloads 404).
UPDATE marketing_assets SET active = false WHERE file_url LIKE 'https://scalix26.com/%' AND content IS NULL;

-- Favorites (per partner).
CREATE TABLE IF NOT EXISTS partner_asset_favorites (
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES marketing_assets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (partner_id, asset_id)
);
ALTER TABLE partner_asset_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Asset favorites" ON partner_asset_favorites;
CREATE POLICY "Asset favorites" ON partner_asset_favorites FOR ALL USING (partner_id = get_partner_id()) WITH CHECK (partner_id = get_partner_id());

-- Curated, content-based library (real copy). Each row is an independent, idempotent INSERT
-- (guarded by title) so a partial paste can never corrupt the batch.
INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Cold Call Script', 'A proven opener + objection pivot for phone outreach.', 'Call Script', 'Sales', ARRAY['calling','script'], E'OPENER\n"Hi [Name], this is [You]. Quick reason for the call — I help [industry] businesses stop losing customers to missed calls. Do you ever miss calls when you''re on a job?"\n\nHOOK\n"Most [industry] owners lose 20–30% of leads to missed or after-hours calls. Scalix26 is an AI employee that answers every call and text 24/7, books the job, and hands off to you only when needed."\n\nCLOSE\n"I can send you a free demo tailored to your business — you can literally talk to it. What''s the best number to text it to?"\n\nOBJECTION: "I already have voicemail."\n"Voicemail loses ~80% of callers. This one actually books the appointment while you work."', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Cold Call Script');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Discovery Questions', 'Qualify any prospect in five questions.', 'Checklist', 'Sales', ARRAY['discovery','qualify'], E'1. How many calls/texts come in on a busy day?\n2. What happens to calls when you''re on a job or after hours?\n3. Roughly what is one new customer worth to you?\n4. How are you following up with leads today?\n5. If an AI booked those missed jobs automatically, what would that be worth per month?', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Discovery Questions');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Objection Handling Guide', 'Answers to the 12 most common objections.', 'Guide', 'Sales', ARRAY['sales','objections'], E'"Too expensive" -> It costs less than one missed job/month, and it books the jobs you''re missing now.\n"I don''t trust AI" -> It uses your real business info and always offers a human handoff.\n"Setup sounds hard" -> Onboarding is minutes, not weeks — we do it with you.\n"I''m too busy" -> That''s exactly the point — it works while you''re on the job.\n"Let me think about it" -> Fair — let me send a free live demo so you can decide with it in front of you.', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Objection Handling Guide');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'LinkedIn Post Templates', 'Authority posts that attract local businesses.', 'Social', 'Marketing', ARRAY['linkedin','social'], E'POST 1 (problem)\n"Local businesses lose thousands every month to missed calls. Here''s the math: [X] missed calls x [Y]% close x $[Z] job = $[N]/mo gone. AI receptionists fix this. DM me ''DEMO''."\n\nPOST 2 (proof)\n"A locksmith I work with was missing 15 calls/week. After adding an AI employee that answers 24/7, he booked 6 extra jobs in week one. Want the same? Comment ''AI''."', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'LinkedIn Post Templates');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Referral One-Pager', 'A concise overview to send prospects.', 'One-Pager', 'Marketing', ARRAY['overview','pitch'], E'SCALIX26 — YOUR AI EMPLOYEE\nAnswers every call & text 24/7. Books jobs. Captures leads. Hands off to you only when needed.\n\nWHY IT MATTERS\n- Never miss a lead again\n- Works nights & weekends\n- Sets appointments automatically\n\nHOW TO START\nTry a free, personalized demo — talk to it live. Ask me for your link.', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Referral One-Pager');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Facebook Ad Copy Pack', 'High-converting ad angles for Meta.', 'Ad Copy', 'Ads', ARRAY['ads','facebook'], E'ANGLE 1 (fear of loss)\n"Every missed call is a lost customer. Your AI employee answers 24/7 and books the job. See a free demo."\n\nANGLE 2 (time)\n"Stop answering the phone on the job. Let AI handle calls, texts, and bookings. Try it free."\n\nANGLE 3 (proof)\n"Local businesses book 20–30% more jobs with a 24/7 AI receptionist. Watch a live demo."', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Facebook Ad Copy Pack');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Google Ads Starter', 'Keywords + ad copy to launch fast.', 'Ad Copy', 'Ads', ARRAY['ads','google'], E'KEYWORDS: ai receptionist, answering service for [industry], 24/7 call answering, missed call solution\n\nHEADLINE 1: 24/7 AI Receptionist\nHEADLINE 2: Never Miss A Call Again\nDESCRIPTION: AI answers every call & text, books jobs automatically. Free live demo. Set up in minutes.', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Google Ads Starter');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Post-Demo Follow-up Sequence', 'A proven 5-touch cadence after a demo.', 'Email Sequence', 'Follow-up', ARRAY['email','sequence'], E'DAY 0 (same day): "Great chatting — here''s your live demo again: [link]. Reply with any question."\nDAY 1: "Did you get a chance to try the demo? Most owners are surprised how natural it sounds."\nDAY 3: "Quick math on what missed calls cost you: [X]/mo. This pays for itself in one job."\nDAY 5: "Happy to set it up with you in 15 minutes — when works?"\nDAY 8: "Closing the loop — want me to hold your number/setup slot, or should I check back next month?"', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Post-Demo Follow-up Sequence');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'SMS Follow-up Templates', 'Ready-to-send texts.', 'SMS', 'Follow-up', ARRAY['sms','follow-up'], E'"Hey [Name], it''s [You] — here''s your free AI demo: [link]. Try texting it like a customer would!"\n"Just checking in — any questions on the demo? Happy to set it up for you."\n"Your AI could be booking jobs by tomorrow. Want me to turn it on?"', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'SMS Follow-up Templates');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Positioning & Messaging', 'How to describe Scalix26 in one line.', 'Guide', 'Brand', ARRAY['brand','messaging'], E'ONE-LINER: "Scalix26 is an AI employee that answers every call and text 24/7, books jobs, and never lets a lead slip."\n\nDON''T SAY: "chatbot", "software".\nDO SAY: "AI employee", "AI receptionist", "always-on".\n\nPROOF POINT: "Businesses miss 20–30% of calls. Scalix26 catches every one."', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Positioning & Messaging');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Email Signature', 'A partner email signature you can paste.', 'Template', 'Brand', ARRAY['brand','email'], E'[Your Name] — Certified Scalix26 Partner\nHelping [industry] businesses never miss a customer.\nBook a free AI demo: [your link]', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Email Signature');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Case Study — Locksmith', 'How a locksmith recovered missed-call revenue.', 'Case Study', 'Case Studies', ARRAY['proof','locksmith'], E'CHALLENGE: A 2-van locksmith missed ~15 calls/week while on jobs.\nSOLUTION: Added a Scalix26 AI employee to answer calls & texts 24/7 and book appointments.\nRESULT: 6 extra booked jobs in week one; ~$3,200 in recovered revenue in month one.\nUSE IT: Share this outcome when a prospect says "I already have voicemail."', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Case Study — Locksmith');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'Locksmith Vertical Kit', 'Everything to sell Scalix26 to locksmiths.', 'Kit', 'Vertical Kits', ARRAY['locksmith','kit'], E'PAIN: Emergency calls come at all hours; missed = lost job to a competitor.\nPITCH: "Your AI answers every 2am lockout call, quotes, and books it — while you sleep."\nBEST CHANNELS: Google Ads ("24/7 locksmith"), local FB groups.\nDEMO TIP: Generate the demo with their real business name + hours.', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'Locksmith Vertical Kit');

INSERT INTO marketing_assets (title, description, category, collection, tags, content, active)
SELECT 'HVAC Vertical Kit', 'Everything to sell Scalix26 to HVAC companies.', 'Kit', 'Vertical Kits', ARRAY['hvac','kit'], E'PAIN: Peak-season call volume overwhelms the office; after-hours calls go to voicemail.\nPITCH: "Your AI books tune-ups and captures emergency no-heat calls 24/7."\nBEST CHANNELS: Google Ads ("AC repair near me"), seasonal FB ads.\nDEMO TIP: Load their service area + hours into the demo before sending.', true
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = 'HVAC Vertical Kit');
