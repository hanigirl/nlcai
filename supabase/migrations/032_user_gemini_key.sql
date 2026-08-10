-- Per-user Gemini API key. Hook generation (both /api/hooks and the homepage
-- batch) runs on Gemini, so every user connects their own key the same way
-- they already connect Anthropic/OpenAI/Apify/HeyGen.
alter table users add column if not exists gemini_api_key text;
