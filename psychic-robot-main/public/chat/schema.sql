-- =====================================================================
--  Lunaar Chat — Supabase schema
--  Paste this whole file into Supabase > SQL Editor > New query > Run.
--  Safe to re-run: everything uses "if not exists" / "or replace".
-- =====================================================================

-- ---------- PROFILES -------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique
              check (char_length(username) between 3 and 24
                     and username ~ '^[A-Za-z0-9_.-]+$'),
  avatar_url  text check (avatar_url is null or char_length(avatar_url) <= 500),
  created_at  timestamptz not null default now()
);

-- Usernames are unique regardless of capitalisation (stops "Bob" vs "bob" impersonation).
create unique index if not exists profiles_username_lower_idx on public.profiles (lower(username));

-- Auto-create a profile whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  wanted text;
  final  text;
begin
  wanted := coalesce(
    nullif(regexp_replace(new.raw_user_meta_data->>'username', '[^A-Za-z0-9_.-]', '', 'g'), ''),
    nullif(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^A-Za-z0-9_.-]', '', 'g'), ''),
    'user'
  );
  wanted := left(wanted, 20);
  if char_length(wanted) < 3 then wanted := wanted || 'user'; end if;
  final := wanted;
  -- make it unique by appending random digits if taken
  while exists (select 1 from public.profiles where lower(username) = lower(final)) loop
    final := left(wanted, 18) || floor(random() * 90 + 10)::int::text;
  end loop;
  insert into public.profiles (id, username, avatar_url)
  values (new.id, final, new.raw_user_meta_data->>'avatar_url');
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- SERVERS / MEMBERS / CHANNELS -----------------------------
create table if not exists public.servers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 1 and 40),
  owner_id     uuid not null references public.profiles(id) on delete cascade,
  invite_code  text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  created_at   timestamptz not null default now()
);

create table if not exists public.server_members (
  server_id  uuid not null references public.servers(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at  timestamptz not null default now(),
  primary key (server_id, user_id)
);
create index if not exists server_members_user_idx on public.server_members (user_id);

create table if not exists public.channels (
  id          uuid primary key default gen_random_uuid(),
  server_id   uuid not null references public.servers(id) on delete cascade,
  name        text not null check (name ~ '^[a-z0-9-]{1,30}$'),
  created_at  timestamptz not null default now(),
  unique (server_id, name)
);

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  channel_id  uuid not null references public.channels(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists messages_channel_idx on public.messages (channel_id, id desc);

-- Private 1-to-1 messages
create table if not exists public.dm_messages (
  id            bigint generated always as identity primary key,
  sender_id     uuid not null references public.profiles(id) on delete cascade,
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  content       text not null check (char_length(content) between 1 and 2000),
  created_at    timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists dm_pair_idx on public.dm_messages
  (least(sender_id, recipient_id), greatest(sender_id, recipient_id), id desc);
create index if not exists dm_recipient_idx on public.dm_messages (recipient_id);

-- ---------- HELPER FUNCTIONS (security definer avoids RLS recursion) --
create or replace function public.is_member(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_members where server_id = sid and user_id = auth.uid());
$$;

create or replace function public.is_admin(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from server_members
                 where server_id = sid and user_id = auth.uid() and role in ('owner', 'admin'));
$$;

create or replace function public.is_owner(sid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from servers where id = sid and owner_id = auth.uid());
$$;

create or replace function public.channel_is_member(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from channels c join server_members m on m.server_id = c.server_id
                 where c.id = cid and m.user_id = auth.uid());
$$;

create or replace function public.channel_is_admin(cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from channels c join server_members m on m.server_id = c.server_id
                 where c.id = cid and m.user_id = auth.uid() and m.role in ('owner', 'admin'));
$$;

-- When a server is created: make the creator the owner and add #general.
create or replace function public.on_server_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into server_members (server_id, user_id, role) values (new.id, new.owner_id, 'owner');
  insert into channels (server_id, name) values (new.id, 'general');
  return new;
end $$;

drop trigger if exists server_created on public.servers;
create trigger server_created after insert on public.servers
  for each row execute function public.on_server_created();

-- Join a server with an invite code.
create or replace function public.join_server(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into sid from servers where invite_code = lower(trim(code));
  if sid is null then raise exception 'Invalid invite code'; end if;
  insert into server_members (server_id, user_id, role) values (sid, auth.uid(), 'member')
  on conflict do nothing;
  return sid;
end $$;

-- Simple anti-spam: max 6 messages per 5 seconds per user (server + DM).
create or replace function public.rate_limit_messages()
returns trigger language plpgsql security definer set search_path = public as $$
declare recent int; uid uuid;
begin
  if tg_table_name = 'messages' then
    uid := new.user_id;
    select count(*) into recent from messages
      where user_id = uid and created_at > now() - interval '5 seconds';
  else
    uid := new.sender_id;
    select count(*) into recent from dm_messages
      where sender_id = uid and created_at > now() - interval '5 seconds';
  end if;
  if recent >= 6 then raise exception 'You are sending messages too fast'; end if;
  return new;
end $$;

drop trigger if exists messages_rate_limit on public.messages;
create trigger messages_rate_limit before insert on public.messages
  for each row execute function public.rate_limit_messages();
drop trigger if exists dm_rate_limit on public.dm_messages;
create trigger dm_rate_limit before insert on public.dm_messages
  for each row execute function public.rate_limit_messages();

-- ---------- ROW LEVEL SECURITY ---------------------------------------
alter table public.profiles        enable row level security;
alter table public.servers         enable row level security;
alter table public.server_members  enable row level security;
alter table public.channels        enable row level security;
alter table public.messages        enable row level security;
alter table public.dm_messages     enable row level security;

-- profiles: any signed-in user can see profiles; you can only edit your own.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- servers
drop policy if exists servers_select on public.servers;
create policy servers_select on public.servers for select to authenticated
  using (owner_id = auth.uid() or public.is_member(id));
drop policy if exists servers_insert on public.servers;
create policy servers_insert on public.servers for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists servers_update on public.servers;
create policy servers_update on public.servers for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists servers_delete on public.servers;
create policy servers_delete on public.servers for delete to authenticated
  using (owner_id = auth.uid());

-- server_members: see members of servers you're in. Joining goes through join_server().
drop policy if exists members_select on public.server_members;
create policy members_select on public.server_members for select to authenticated
  using (public.is_member(server_id));
drop policy if exists members_leave on public.server_members;
create policy members_leave on public.server_members for delete to authenticated
  using (user_id = auth.uid() and role <> 'owner');
drop policy if exists members_kick on public.server_members;
create policy members_kick on public.server_members for delete to authenticated
  using (public.is_admin(server_id) and role <> 'owner' and user_id <> auth.uid());
drop policy if exists members_role on public.server_members;
create policy members_role on public.server_members for update to authenticated
  using (public.is_owner(server_id) and role <> 'owner')
  with check (public.is_owner(server_id) and role in ('admin', 'member'));

-- channels
drop policy if exists channels_select on public.channels;
create policy channels_select on public.channels for select to authenticated
  using (public.is_member(server_id));
drop policy if exists channels_insert on public.channels;
create policy channels_insert on public.channels for insert to authenticated
  with check (public.is_admin(server_id));
drop policy if exists channels_update on public.channels;
create policy channels_update on public.channels for update to authenticated
  using (public.is_admin(server_id)) with check (public.is_admin(server_id));
drop policy if exists channels_delete on public.channels;
create policy channels_delete on public.channels for delete to authenticated
  using (public.is_admin(server_id));

-- messages: members read & write; authors delete their own; admins delete any.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.channel_is_member(channel_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.channel_is_member(channel_id));
drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages for delete to authenticated
  using (user_id = auth.uid() or public.channel_is_admin(channel_id));

-- DMs: only the two people involved can see them.
drop policy if exists dm_select on public.dm_messages;
create policy dm_select on public.dm_messages for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());
drop policy if exists dm_insert on public.dm_messages;
create policy dm_insert on public.dm_messages for insert to authenticated
  with check (sender_id = auth.uid());
drop policy if exists dm_delete on public.dm_messages;
create policy dm_delete on public.dm_messages for delete to authenticated
  using (sender_id = auth.uid());

-- Don't let clients tamper with the function-level helpers beyond what's intended.
revoke all on function public.join_server(text) from public, anon;
grant execute on function public.join_server(text) to authenticated;

-- ---------- REALTIME -------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['messages', 'dm_messages', 'channels', 'server_members'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
-- Note: DELETE events only carry primary keys when RLS is on, which is all the
-- app needs (it removes messages / channels / members by id).
