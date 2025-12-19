-- Enable useful extensions (optional)
-- create extension if not exists pg_trgm;

-- 1) Pages we've seen (canonical Wikipedia page_id)
create table if not exists pages (
  page_id           bigint primary key,
  title             text not null,
  namespace         int not null default 0,
  is_redirect       boolean not null default false,
  redirect_target_id bigint null,

  -- cached UI enrichments (optional; filled on demand)
  summary           text null,
  thumbnail_url     text null,

  -- metrics (can be updated incrementally)
  out_degree        int not null default 0,
  in_degree         int not null default 0,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists pages_title_idx on pages (title);

-- 2) Directed links: from -> to (main namespace only, if you choose)
create table if not exists links (
  from_page_id bigint not null references pages(page_id) on delete cascade,
  to_page_id   bigint not null references pages(page_id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (from_page_id, to_page_id)
);

create index if not exists links_from_idx on links (from_page_id);
create index if not exists links_to_idx on links (to_page_id);

-- 3) Crawl jobs / status for fetching ALL outbound links for a page
create table if not exists page_fetch (
  page_id         bigint primary key references pages(page_id) on delete cascade,
  status          text not null check (status in ('queued','running','done','error','paused','discovered')) default 'queued',
  priority        int not null default 0,

  -- progress tracking
  started_at      timestamptz null,
  finished_at     timestamptz null,
  last_error      text null,
  last_cursor     jsonb null,  -- for resume; store MediaWiki "continue" blob

  -- bookkeeping
  requested_by    text null,
  updated_at      timestamptz not null default now()
);

create index if not exists page_fetch_status_idx on page_fetch (status);
create index if not exists page_fetch_priority_idx on page_fetch (priority desc);

-- 4) Categories (optional but handy)
create table if not exists categories (
  category_id bigserial primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);

create table if not exists page_categories (
  page_id     bigint not null references pages(page_id) on delete cascade,
  category_id bigint not null references categories(category_id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (page_id, category_id)
);

create index if not exists page_categories_page_idx on page_categories (page_id);
create index if not exists page_categories_cat_idx on page_categories (category_id);

-- updated_at trigger helper
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_pages_updated_at on pages;
create trigger trg_pages_updated_at
before update on pages
for each row execute function set_updated_at();

drop trigger if exists trg_page_fetch_updated_at on page_fetch;
create trigger trg_page_fetch_updated_at
before update on page_fetch
for each row execute function set_updated_at();

