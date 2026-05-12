-- Persist the product + trigger-word controls that the user fills in on the
-- /project workflow card alongside the body. Until now they only lived in
-- React state + localStorage, so coming back to a draft (different browser,
-- cleared cache, etc.) wiped them — even though the user explicitly chose
-- them and we use them in the AI prompt that generates the post body.
--
-- product_id: nullable, ON DELETE SET NULL so deleting a product doesn't
-- cascade and remove the post that referenced it. The user can always
-- re-link to a different product later.
alter table core_posts add column product_id uuid references products on delete set null;
alter table core_posts add column trigger_word text;
