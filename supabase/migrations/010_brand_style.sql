-- Add brand_style column to users table
-- Stores the extracted visual style profile from user's cover examples
alter table users add column brand_style jsonb;
