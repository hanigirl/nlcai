-- BYOK: each user brings their own Apify token, used by the ideas pipeline
-- to scrape cross-platform creator posts (Instagram + YouTube + TikTok).
alter table users add column apify_api_key text;
