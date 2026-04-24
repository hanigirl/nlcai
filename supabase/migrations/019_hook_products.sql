-- Hook → products tagging. A hook can match multiple products (or none, in which
-- case it's a "general" hook). Populated by a Haiku classifier at the end of
-- hook generation, used by the /hooks page filter.
alter table hooks add column product_ids uuid[] not null default '{}';
create index hooks_product_ids_idx on hooks using gin(product_ids);
