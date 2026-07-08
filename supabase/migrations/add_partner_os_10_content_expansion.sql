-- Migration: Partner OS V3 (10) — Marketplace profile fields + expanded Marketing library.
-- Idempotent. Run after 1–9.

-- ── Marketplace: richer public profile ──
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS projects_completed int NOT NULL DEFAULT 0;
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS response_time text;   -- e.g. 'Within an hour'
ALTER TABLE marketplace_profiles ADD COLUMN IF NOT EXISTS countries text[] NOT NULL DEFAULT '{}';

-- ── Marketing Center: seed a broad, categorized library ──
INSERT INTO marketing_assets (title, description, category, file_url, tags, active)
SELECT v.title, v.description, v.category, v.file_url, v.tags::text[], true
FROM (VALUES
  ('Follow-up Sequence (5 emails)', 'A proven 5-touch follow-up cadence after a demo.', 'follow_up', 'https://scalix26.com/assets/follow-up-sequence.pdf', ARRAY['email','sequence']),
  ('Cold Email Templates', 'High-reply cold email templates by niche.', 'cold_email', 'https://scalix26.com/assets/cold-emails.pdf', ARRAY['email','cold']),
  ('Facebook Ad Pack', 'Ad copy + creative concepts for Facebook.', 'facebook_ad', 'https://scalix26.com/assets/facebook-ads.pdf', ARRAY['ads','facebook']),
  ('Instagram Ad Pack', 'Story + feed ad concepts for Instagram.', 'instagram_ad', 'https://scalix26.com/assets/instagram-ads.pdf', ARRAY['ads','instagram']),
  ('Google Ads Keywords', 'Starter keyword + ad-copy sheet.', 'google_ad', 'https://scalix26.com/assets/google-ads.pdf', ARRAY['ads','google']),
  ('LinkedIn Post Templates', 'Authority-building posts to attract businesses.', 'linkedin', 'https://scalix26.com/assets/linkedin-posts.pdf', ARRAY['social','linkedin']),
  ('Demo Video Script', 'A tight script for a screen-share walkthrough.', 'video_script', 'https://scalix26.com/assets/video-script.pdf', ARRAY['video','script']),
  ('Landing Page Template', 'A conversion-focused landing page you can clone.', 'landing_page', 'https://scalix26.com/assets/landing-page.pdf', ARRAY['web','landing']),
  ('Case Study — Locksmith', 'How a locksmith recovered missed-call revenue.', 'case_study', 'https://scalix26.com/assets/case-study-locksmith.pdf', ARRAY['proof','case']),
  ('Testimonials Pack', 'Ready-to-share customer quotes.', 'testimonial', 'https://scalix26.com/assets/testimonials.pdf', ARRAY['proof','social']),
  ('Objection Handling Guide', 'Answers to the 12 most common objections.', 'objection', 'https://scalix26.com/assets/objections.pdf', ARRAY['sales','objections']),
  ('Battle Card', 'Scalix26 vs. voicemail / answering services.', 'battle_card', 'https://scalix26.com/assets/battle-card.pdf', ARRAY['sales','compete']),
  ('Pricing Sheet', 'Clean pricing one-pager for prospects.', 'pricing', 'https://scalix26.com/assets/pricing.pdf', ARRAY['pricing']),
  ('Brand Assets & Logos', 'Logos, colors, and usage guidelines.', 'brand', 'https://scalix26.com/assets/brand-kit.zip', ARRAY['brand','logo']),
  ('Email Signature', 'A partner email signature template.', 'email_signature', 'https://scalix26.com/assets/email-signature.html', ARRAY['brand','email'])
) AS v(title, description, category, file_url, tags)
WHERE NOT EXISTS (SELECT 1 FROM marketing_assets WHERE title = v.title);
