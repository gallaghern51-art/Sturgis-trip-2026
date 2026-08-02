-- Roadbook sync schema.
--
-- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste ->
-- Run. It is safe to run twice; everything is guarded.
--
-- The design follows the app's own architecture: every trip mutation is already
-- an op (src/engine/ops.js), applied by the pure applyOps(). So the thing that
-- syncs is the OP LOG, not the trip document. Each client appends ops and
-- replays everyone else's through the same code path it uses for its own. That
-- gives realtime, attribution and history without a merge algorithm.

-- ---------------------------------------------------------------- trips ----
create table if not exists public.trips (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  -- Compacted trip state. A phone joining on day 6 restores this and replays
  -- only the ops after snapshot_seq, instead of every op since day 1.
  snapshot     jsonb not null,
  snapshot_seq bigint not null default 0,
  owner        uuid not null references auth.users on delete cascade,
  -- What you text the group. Short enough to read out over an intercom.
  join_code    text unique not null default upper(encode(gen_random_bytes(4), 'hex')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- --------------------------------------------------------------- members ----
create table if not exists public.trip_members (
  trip_id   uuid not null references public.trips on delete cascade,
  user_id   uuid not null references auth.users on delete cascade,
  name      text,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

-- ------------------------------------------------------------------- ops ----
-- seq is the canonical order of history. Server-assigned, so two riders editing
-- in the same second get a deterministic order everyone agrees on.
create table if not exists public.trip_ops (
  seq        bigserial primary key,
  trip_id    uuid not null references public.trips on delete cascade,
  ops        jsonb not null,   -- the exact array the client already dispatches
  author     uuid not null references auth.users on delete cascade,
  client_id  text,             -- so a client can ignore the echo of its own write
  created_at timestamptz not null default now()
);

create index if not exists trip_ops_trip_seq_idx on public.trip_ops (trip_id, seq);

-- ------------------------------------------------------------------ RLS ----
-- Nothing is readable by default. Membership is the only key that opens a trip,
-- which is why the publishable key is safe to ship in the app.
alter table public.trips        enable row level security;
alter table public.trip_members enable row level security;
alter table public.trip_ops     enable row level security;

-- SECURITY DEFINER breaks the recursion: a policy on trip_members cannot itself
-- query trip_members without looping.
create or replace function public.is_trip_member(t uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.trip_members m
    where m.trip_id = t and m.user_id = auth.uid()
  );
$$;

drop policy if exists trips_read      on public.trips;
drop policy if exists trips_insert    on public.trips;
drop policy if exists trips_update    on public.trips;
drop policy if exists members_read    on public.trip_members;
drop policy if exists members_join    on public.trip_members;
drop policy if exists members_leave   on public.trip_members;
drop policy if exists ops_read        on public.trip_ops;
drop policy if exists ops_append      on public.trip_ops;

create policy trips_read   on public.trips for select
  using (owner = auth.uid() or public.is_trip_member(id));
create policy trips_insert on public.trips for insert
  with check (owner = auth.uid());
create policy trips_update on public.trips for update
  using (owner = auth.uid() or public.is_trip_member(id));

create policy members_read  on public.trip_members for select
  using (user_id = auth.uid() or public.is_trip_member(trip_id));
-- You add yourself; you cannot add anyone else.
create policy members_join  on public.trip_members for insert
  with check (user_id = auth.uid());
create policy members_leave on public.trip_members for delete
  using (user_id = auth.uid());

create policy ops_read   on public.trip_ops for select
  using (public.is_trip_member(trip_id));
-- Append-only, and you can only sign your own name to an op.
create policy ops_append on public.trip_ops for insert
  with check (author = auth.uid() and public.is_trip_member(trip_id));

-- ------------------------------------------------------------- join code ----
-- Joining needs to read a trip you are not yet a member of, which RLS forbids.
-- This runs as the definer, checks the code, and adds you.
create or replace function public.join_trip(code text, rider_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select id into t from public.trips where join_code = upper(code);
  if t is null then raise exception 'no trip with that code'; end if;
  insert into public.trip_members (trip_id, user_id, name)
  values (t, auth.uid(), rider_name)
  on conflict (trip_id, user_id) do update set name = coalesce(excluded.name, trip_members.name);
  return t;
end;
$$;

-- ------------------------------------------------------------- realtime ----
-- What makes another rider's edit appear on your screen.
alter publication supabase_realtime add table public.trip_ops;
