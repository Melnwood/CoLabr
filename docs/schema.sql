-- ============================================================================
-- Co·labr — Postgres schema (Supabase)
--
-- Written to be read. Every table says what it is for, and every constraint
-- exists because something went wrong without it. Where a rule encodes a
-- product decision rather than a technical one, the comment says which.
--
-- Two principles throughout, both from the fact that one or two people run this:
--   1. The database refuses bad states rather than trusting the code.
--   2. Nothing destructive happens without something else having to agree.
-- ============================================================================

create extension if not exists "pgcrypto";     -- gen_random_uuid()
create extension if not exists "citext";       -- case-insensitive email


-- ---------------------------------------------------------------------------
-- ORGANISATIONS
-- Josiah Venture and its national partners. Supplies the brand a page wears.
-- ---------------------------------------------------------------------------
create table orgs (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,             -- JV, KAM, PL
  name            text not null,
  country         text,
  website         text,
  give_url        text,
  tagline         text,
  logo_url        text,
  ink_color       text,
  accent_color    text,
  background_color text,
  text_on_brand   text not null default 'Light'
                    check (text_on_brand in ('Light','Dark')),
  house_header    text check (house_header in ('Dark','Light','Brand')),
  headline_font   text check (headline_font in ('Sans','Serif')),
  -- An organisation that pays for its people. Their staff never meet the
  -- trial clock. This replaces the per-page "Org Covered" checkbox, which
  -- had to be remembered by hand for every new staff member.
  covers_seats    boolean not null default false,
  created_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- PAGES  (Airtable: "Missionaries")
--
-- A page, not a person. "Mel & Amy" is one page with two people on it, which
-- is why emails live in their own table below rather than in a comma-separated
-- string. That string is what let two rows share an address and put a live
-- account one arbitrary sort-order away from a page called "delete me".
-- ---------------------------------------------------------------------------
create table pages (
  id              uuid primary key default gen_random_uuid(),
  slug            citext not null unique,            -- stable, used in URLs
  name            text not null,                     -- display name, may change
  org_id          uuid references orgs(id) on delete set null,
  location        text,
  photo_url       text,
  sign_off        text,
  give_url        text,
  style           text not null default 'Field Notes',
  -- National staff write in their own language; their own people see their own
  -- organisation's brand, and English readers see the JV co-brand mark.
  is_national     boolean not null default false,
  -- Emails are armed. Off means publishing never reaches a subscriber.
  is_live         boolean not null default false,
  hide_highlights boolean not null default false,
  hide_team_picks boolean not null default false,
  -- A demonstration page. The wall shows a visible notice, so real photographs
  -- on it are never mistaken for somebody's genuine ministry.
  is_sample       boolean not null default false,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz                        -- soft delete; see billing
);

-- Old links must never die. Renames push the previous slug in here instead of
-- into a free-text "Former Names" box that had to be parsed on every request.
create table page_slugs (
  slug            citext primary key,
  page_id         uuid not null references pages(id) on delete cascade,
  retired_at      timestamptz not null default now()
);

-- Who may sign in to a page. One address, one page: the constraint that would
-- have made the ZZ Export Test incident impossible rather than merely unlikely.
create table page_members (
  page_id         uuid not null references pages(id) on delete cascade,
  email           citext not null unique,
  role            text not null default 'owner' check (role in ('owner','editor')),
  added_at        timestamptz not null default now(),
  primary key (page_id, email)
);


-- ---------------------------------------------------------------------------
-- BILLING
-- Split from pages because it changes on a different clock and is read by a
-- scheduled job that should not be able to touch anything else.
-- ---------------------------------------------------------------------------
create table page_billing (
  page_id           uuid primary key references pages(id) on delete cascade,
  trial_started_on  date,
  paid_until        date,
  hidden_on         date,
  archive_sent_on   date,
  archive_url       text,
  notified          text[] not null default '{}',   -- t7, t12, froze, archive…
  stripe_customer   text unique,
  stripe_subscription text unique,
  -- A page is never hidden or deleted until its owner holds their archive.
  constraint archive_before_hiding
    check (hidden_on is null or archive_sent_on is not null)
);


-- ---------------------------------------------------------------------------
-- UPDATES
-- ---------------------------------------------------------------------------
create type update_status as enum ('Draft','Scheduled','Published','Processing');

create table updates (
  id              uuid primary key default gen_random_uuid(),
  page_id         uuid not null references pages(id) on delete cascade,
  title           text not null,
  slug            text,
  published_on    date,
  status          update_status not null default 'Draft',
  -- The composer's block array. jsonb, not text: it can be queried, indexed and
  -- validated, instead of being JSON.parse'd in fifteen different functions.
  blocks          jsonb not null default '[]'::jsonb,
  excerpt         text,
  body            text,                              -- legacy plain text
  cover_url       text,
  cover_focus     text default '50% 35%',
  video_url       text,
  archive_url     text,                              -- original Mailchimp copy
  tags            text[] not null default '{}',
  audiences       text[] not null default '{}',      -- National / International
  opens           integer not null default 0,
  recipients      integer not null default 0,
  source          text,
  -- Imported history must never be emailed to anybody, ever.
  claimed_sent    boolean not null default false,
  is_highlight    boolean not null default false,
  -- Which language it was written in, and what it has been translated into.
  source_lang     text not null default 'en',
  translations    jsonb not null default '{}'::jsonb,
  external_id     text,                              -- Mailchimp campaign id
  created_at      timestamptz not null default now(),
  -- One import, however many times the wizard is run, and whichever route was
  -- used: the API knows a campaign by its API id and an export names files by
  -- web id, so identity has to be the page plus the title plus the date.
  unique (page_id, title, published_on)
);
create unique index updates_external_id_uniq
  on updates (page_id, external_id) where external_id is not null;
create index updates_page_published on updates (page_id, published_on desc);
create index updates_blocks_gin on updates using gin (blocks);


-- ---------------------------------------------------------------------------
-- SUPPORTERS
--
-- In Airtable a subscriber row pointed at a missionary by NAME, as text. Rename
-- the page and every supporter quietly detaches. Here it is a foreign key.
-- ---------------------------------------------------------------------------
create type follow_pref as enum ('Full email','Link email','Site only');
-- Deliberately three. "Monthly digest" and "Text" were offered for months with
-- nothing on the platform able to send either. An option nobody can deliver
-- does not belong in the type.

create table supporters (
  id              uuid primary key default gen_random_uuid(),
  email           citext not null unique,
  name            text,
  phone           text,
  -- One cadence for everybody they follow, so six missionaries are one email
  -- rather than six. Null means per-page preferences apply unchanged.
  digest_cadence  text check (digest_cadence in ('weekly','fortnightly','monthly')),
  digest_last_sent_at timestamptz,
  created_at      timestamptz not null default now()
);

create table follows (
  id              uuid primary key default gen_random_uuid(),
  supporter_id    uuid not null references supporters(id) on delete cascade,
  page_id         uuid not null references pages(id) on delete cascade,
  preference      follow_pref not null default 'Full email',
  audience        text not null default 'International'
                    check (audience in ('International','National','Both')),
  token           text not null unique,              -- the key in every email link
  active          boolean not null default true,
  source          text,
  email_issue     text,
  last_visit_at   timestamptz,
  created_at      timestamptz not null default now(),
  -- Somebody can follow a page once. Twice was possible before, and produced
  -- duplicate emails nobody could explain.
  unique (supporter_id, page_id)
);
create index follows_page_active on follows (page_id) where active;


-- ---------------------------------------------------------------------------
-- CONVERSATIONS
-- Nothing a supporter writes is public. There is no comment wall, so there is
-- no "public" column to get wrong.
-- ---------------------------------------------------------------------------
create type response_kind as enum ('Prayer','Note');

create table responses (
  id              uuid primary key default gen_random_uuid(),
  page_id         uuid not null references pages(id) on delete cascade,
  update_id       uuid references updates(id) on delete set null,
  supporter_id    uuid references supporters(id) on delete set null,
  kind            response_kind not null,
  message         text,
  thread          jsonb not null default '[]'::jsonb,
  thread_key      text unique,                       -- lets them reply with no account
  read_at         timestamptz,
  acked_at        timestamptz,
  created_at      timestamptz not null default now(),
  -- A prayer is a tap and carries no words. A note without words is a mistake.
  constraint note_has_words
    check (kind <> 'Note' or coalesce(trim(message),'') <> '')
);
create index responses_page_created on responses (page_id, created_at desc);


-- ---------------------------------------------------------------------------
-- PRAYER
-- ---------------------------------------------------------------------------
create type prayer_status as enum ('Open','Answered','Still praying','Went another way');

create table prayer_requests (
  id              uuid primary key default gen_random_uuid(),
  page_id         uuid not null references pages(id) on delete cascade,
  update_id       uuid references updates(id) on delete set null,
  block_index     integer,
  text            text not null,
  status          prayer_status not null default 'Open',
  outcome         text,
  resolved_on     date,                              -- a date, not a text field
  told_count      integer not null default 0,
  created_at      timestamptz not null default now(),
  unique (update_id, block_index),
  -- A resolution means something happened. Recording one without saying what
  -- leaves everybody who prayed with nothing.
  constraint resolved_has_outcome
    check (status = 'Open' or coalesce(trim(outcome),'') <> '')
);

create table prayer_profile (
  id              uuid primary key default gen_random_uuid(),
  page_id         uuid not null references pages(id) on delete cascade,
  category        text not null check (category in
                    ('Mission & vision','Our work','Family','Personal & spiritual')),
  text            text not null,
  sort_order      integer not null default 0,
  active          boolean not null default true,
  updated_on      date not null default current_date   -- drives the freshness badge
);


-- ---------------------------------------------------------------------------
-- SMALLER TABLES
-- Kept as-is in shape; listed so the migration is complete rather than partial.
-- ---------------------------------------------------------------------------
create table events (               -- Give-button clicks: interest, not gifts
  id            uuid primary key default gen_random_uuid(),
  page_id       uuid references pages(id) on delete cascade,
  update_id     uuid references updates(id) on delete set null,
  supporter_id  uuid references supporters(id) on delete set null,
  kind          text not null,
  created_at    timestamptz not null default now()
);

create table feature_shares (       -- peer share-and-approve across the movement
  id            uuid primary key default gen_random_uuid(),
  update_id     uuid not null references updates(id) on delete cascade,
  requester_page_id uuid not null references pages(id) on delete cascade,
  status        text not null default 'Pending'
                  check (status in ('Pending','Approved','Declined')),
  created_at    timestamptz not null default now(),
  unique (update_id, requester_page_id)
);

create table templates (
  id            uuid primary key default gen_random_uuid(),
  owner_page_id uuid references pages(id) on delete cascade,
  name          text not null,
  blocks        jsonb not null default '[]'::jsonb,
  mode          text not null default 'Full copy',
  scope         text not null default 'Personal' check (scope in ('Personal','Shared')),
  banner_url    text
);

create table platform_settings (    -- exactly one row
  id            boolean primary key default true check (id),
  pause_all_email      boolean not null default true,
  billing_enforcement  boolean not null default false,
  hide_field_notes     boolean not null default false,
  history_translate_price numeric(10,2)
);
insert into platform_settings default values;

create table waitlist (
  email         citext primary key,
  name          text,
  notes         text,
  notified      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table support_messages (
  id            uuid primary key default gen_random_uuid(),
  email         citext not null,
  name          text,
  message       text not null,
  ai_reply      text,
  status        text not null default 'New',
  page          text,
  created_at    timestamptz not null default now()
);

create table feedback (             -- sandbox tester reports
  id            uuid primary key default gen_random_uuid(),
  note          text not null,
  name          text,
  email         citext,
  page_url      text,
  screenshot_url text,
  context       text,
  project       text,
  status        text not null default 'New',
  created_at    timestamptz not null default now()
);

create table sandbox_testers (
  id            uuid primary key default gen_random_uuid(),
  name          text,
  email         citext not null unique,
  partner_email citext,
  perspectives  text[] not null default '{}',
  devices       text[] not null default '{}',
  status        text not null default 'Invited',
  notes         text
);

create table care_followups (
  update_id       uuid primary key references updates(id) on delete cascade,
  categories      text[] not null default '{}',
  note            text,
  followed_up_by  text,
  followed_up_on  date not null default current_date
);


-- ---------------------------------------------------------------------------
-- WHAT THIS SCHEMA REFUSES THAT AIRTABLE ALLOWED
--
--   · two pages sharing a sign-in address        page_members.email unique
--   · a supporter following one page twice       follows unique (supporter,page)
--   · the same newsletter imported twice         updates unique (page,title,date)
--   · a page hidden before its archive was sent  check archive_before_hiding
--   · a prayer resolved with no word to those
--     who prayed                                 check resolved_has_outcome
--   · an empty note                              check note_has_words
--   · a follow preference nothing can deliver    enum follow_pref
--   · orphaned rows after a deletion             foreign keys + cascade
--   · a rename detaching a page's supporters     foreign keys, not name strings
--
-- Deleting a page is now one statement inside one transaction, and it either
-- happens completely or not at all. The billing sweep currently deletes updates,
-- then subscribers, then the page, in three separate calls with no transaction:
-- fail in the middle and the leftovers are invisible to everything.
-- ---------------------------------------------------------------------------
