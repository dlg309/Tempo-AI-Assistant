-- Apply to a new Supabase project. No migration of the retired database is implicit.
create extension if not exists pgcrypto;

create table public.preferences (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 timezone text not null default 'America/New_York', focus_minutes integer not null default 50 check(focus_minutes between 15 and 240),
 break_minutes integer not null default 10 check(break_minutes between 0 and 60), buffer_minutes integer not null default 0 check(buffer_minutes between 0 and 60),
 all_day_busy boolean not null default false, onboarded boolean not null default false,
 availability jsonb not null default '[{"day":1,"start":"09:00","end":"18:00"},{"day":2,"start":"09:00","end":"18:00"},{"day":3,"start":"09:00","end":"18:00"},{"day":4,"start":"09:00","end":"18:00"},{"day":5,"start":"09:00","end":"18:00"}]',
 revision bigint not null default 0, updated_at timestamptz not null default now()
);
create table public.tasks (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.preferences(owner_id) on delete cascade,
 title text not null check(length(title) between 1 and 200), description text not null default '' check(length(description)<=4000),
 category text not null default 'personal' check(category in ('school','work','personal')),
 priority text not null default 'medium' check(priority in ('high','medium','low')),
 deadline timestamptz, estimated_minutes integer not null check(estimated_minutes between 5 and 10080),
 remaining_minutes integer not null check(remaining_minutes between 0 and estimated_minutes),
 status text not null default 'open' check(status in ('open','done','archived')), splittable boolean not null default true,
 min_session integer not null default 25 check(min_session between 5 and 480), version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.calendar_sources (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.preferences(owner_id) on delete cascade,
 name text not null check(length(name) between 1 and 200), kind text not null check(kind in ('file','feed')), url text,
 timezone text not null,
 enabled boolean not null default true, all_day_busy boolean not null default false,
 raw_ics text check(octet_length(raw_ics)<=1048576), last_success timestamptz, last_attempt timestamptz, refresh_error text,
 refresh_lease timestamptz, version integer not null default 1, updated_at timestamptz not null default now(), unique(id,owner_id),
 check((kind='file' and url is null) or (kind='feed' and url like 'https://%'))
);
create table public.events (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.preferences(owner_id) on delete cascade,
 title text not null check(length(title) between 1 and 200), description text not null default '' check(length(description)<=4000),
 category text not null default 'personal' check(category in ('school','work','personal')),
 kind text not null check(kind in ('commitment','focus')), starts_at timestamptz, ends_at timestamptz, start_date date, end_date date,
 timezone text not null, all_day boolean not null default false, busy boolean not null default true, locked boolean not null default true,
 task_id uuid, source_id uuid, uid text not null, recurrence_id text not null default '', recurrence jsonb,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,owner_id), unique(owner_id,source_id,uid,recurrence_id),
 foreign key(task_id,owner_id) references public.tasks(id,owner_id),
 foreign key(source_id,owner_id) references public.calendar_sources(id,owner_id) on delete cascade,
 check((all_day and starts_at is null and ends_at is null and start_date is not null and end_date>start_date) or
       (not all_day and starts_at is not null and ends_at>starts_at and start_date is null and end_date is null)),
 check(kind!='focus' or (task_id is not null and not all_day)), check(source_id is null or (locked and kind='commitment'))
);
create table public.proposals (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.preferences(owner_id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','applied','rejected','undone')),
 base_revision bigint not null, payload jsonb not null, created_at timestamptz not null default now(), unique(id,owner_id)
);
create table public.change_batches (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.preferences(owner_id) on delete cascade,
 proposal_id uuid not null unique, created_ids uuid[] not null default '{}', before_events jsonb not null default '[]',
 task_before jsonb not null default '[]', task_after jsonb not null default '[]', event_after jsonb not null default '[]',
 undone boolean not null default false, created_at timestamptz not null default now(),
 foreign key(proposal_id,owner_id) references public.proposals(id,owner_id)
);
create table public.messages (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.preferences(owner_id) on delete cascade,
 role text not null check(role in ('user','assistant')), content text not null check(length(content)<=8000), created_at timestamptz not null default now()
);
create table public.feed_tokens (
 owner_id uuid primary key references public.preferences(owner_id) on delete cascade, token_hash text not null unique,
 include_commitments boolean not null default true, include_focus boolean not null default true, created_at timestamptz not null default now()
);
create table public.rate_limits (
 owner_id uuid not null references auth.users(id) on delete cascade, bucket text not null, period timestamptz not null,
 count integer not null default 0, primary key(owner_id,bucket)
);
create index tasks_owner_deadline on public.tasks(owner_id,deadline);
create index events_owner_start on public.events(owner_id,starts_at);
create index messages_owner_time on public.messages(owner_id,created_at desc);
create index sources_refresh on public.calendar_sources(enabled,last_attempt) where kind='feed';

-- Direct table writes are denied. All mutations use validated RPCs with a common
-- per-user lock. Every schedule-affecting write increments one workspace revision.
do $$ declare t text; begin
 foreach t in array array['preferences','tasks','calendar_sources','events','proposals','change_batches','messages','feed_tokens','rate_limits'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy owner_read on public.%I for select to authenticated using (owner_id=auth.uid())',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated, service_role',t);
 end loop;
end $$;

create function public.ensure_preferences() returns public.preferences language plpgsql security definer set search_path=public,pg_temp as $$
declare result preferences; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into preferences(owner_id) values(auth.uid()) on conflict do nothing;
 select * into result from preferences where owner_id=auth.uid(); return result;
end $$;

create function public.lock_workspace(u uuid) returns void language sql set search_path=public,pg_temp as $$
 select pg_advisory_xact_lock(hashtextextended(u::text,0));
$$;
create function public.bump_record() returns trigger language plpgsql set search_path=public,pg_temp as $$
declare u uuid; begin
 if TG_OP='DELETE' then u=OLD.owner_id; else u=NEW.owner_id; end if;
 perform lock_workspace(u);
 if TG_OP='UPDATE' then
  if NEW.owner_id<>OLD.owner_id then raise exception 'Ownership cannot change'; end if;
  NEW.version=OLD.version+1; NEW.updated_at=now();
 end if;
 update preferences set revision=revision+1, updated_at=now() where owner_id=u;
 if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;
create trigger tasks_revision before insert or update or delete on public.tasks for each row execute function public.bump_record();
create trigger events_revision before insert or update or delete on public.events for each row execute function public.bump_record();
create trigger sources_revision before insert or update or delete on public.calendar_sources for each row execute function public.bump_record();

create function public.save_preferences(p jsonb, expected bigint) returns public.preferences language plpgsql security definer set search_path=public,pg_temp as $$
declare r preferences; a jsonb; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform lock_workspace(auth.uid());
 if not exists(select from preferences where owner_id=auth.uid() and revision=expected) then raise exception 'Stale preferences; reload'; end if;
 if not exists(select from pg_timezone_names where name=p->>'timezone') then raise exception 'Invalid time zone'; end if;
 if jsonb_typeof(p->'availability')<>'array' or jsonb_array_length(p->'availability')>35 then raise exception 'Invalid availability'; end if;
 for a in select value from jsonb_array_elements(p->'availability') loop
  if (a->>'day')::int not between 1 and 7 or (a->>'start')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or (a->>'end')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or a->>'end'<=a->>'start' then raise exception 'Invalid availability'; end if;
 end loop;
 update preferences set timezone=p->>'timezone',focus_minutes=(p->>'focus_minutes')::int,break_minutes=(p->>'break_minutes')::int,
 buffer_minutes=(p->>'buffer_minutes')::int, all_day_busy=(p->>'all_day_busy')::boolean,onboarded=(p->>'onboarded')::boolean,
 availability=p->'availability',revision=revision+1,updated_at=now() where owner_id=auth.uid() returning * into r; return r;
end $$;

create function public.write_task(p jsonb, record_id uuid default null, expected integer default null, remove boolean default false) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r uuid; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform lock_workspace(auth.uid());
 if record_id is not null and not exists(select from tasks where id=record_id and owner_id=auth.uid() and version=expected) then raise exception 'Stale task or access denied'; end if;
 if remove then
  if record_id is null then raise exception 'Task required'; end if;
  delete from events where owner_id=auth.uid() and task_id=record_id;
  delete from tasks where id=record_id and owner_id=auth.uid(); return record_id;
 end if;
 if record_id is null then
  if (select count(*) from tasks where owner_id=auth.uid())>=500 then raise exception 'Task limit reached; delete unused tasks first'; end if;
  insert into tasks(owner_id,title,description,category,priority,deadline,estimated_minutes,remaining_minutes,status,splittable,min_session)
  values(auth.uid(),p->>'title',coalesce(p->>'description',''),p->>'category',p->>'priority',(p->>'deadline')::timestamptz,(p->>'estimated_minutes')::int,(p->>'remaining_minutes')::int,p->>'status',(p->>'splittable')::boolean,(p->>'min_session')::int) returning id into r;
 else
  update tasks set title=p->>'title',description=coalesce(p->>'description',''),category=p->>'category',priority=p->>'priority',deadline=(p->>'deadline')::timestamptz,
   estimated_minutes=(p->>'estimated_minutes')::int, remaining_minutes=(p->>'remaining_minutes')::int,status=p->>'status',splittable=(p->>'splittable')::boolean,min_session=(p->>'min_session')::int
  where id=record_id and owner_id=auth.uid() returning id into r;
 end if; return r;
end $$;

create function public.write_event(p jsonb, record_id uuid default null, expected integer default null, remove boolean default false) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r uuid; s timestamptz; e timestamptz; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform lock_workspace(auth.uid());
 if record_id is not null and not exists(select from events where id=record_id and owner_id=auth.uid() and source_id is null and version=expected) then raise exception 'Stale event, read-only source, or access denied'; end if;
 if remove then delete from events where id=record_id and owner_id=auth.uid(); return record_id; end if;
 if not exists(select from pg_timezone_names where name=p->>'timezone') then raise exception 'Invalid time zone'; end if;
 if p->>'kind'='focus' then
  s=(p->>'starts_at')::timestamptz; e=(p->>'ends_at')::timestamptz;
  if exists(select from events where owner_id=auth.uid() and id is distinct from record_id and busy and
    (source_id is null or exists(select from calendar_sources s where s.id=events.source_id and s.enabled)) and
    ((not all_day and starts_at<e and ends_at>s) or (all_day and ((source_id is not null) or (select all_day_busy from preferences where owner_id=auth.uid())) and
      start_date::timestamp at time zone timezone<e and end_date::timestamp at time zone timezone>s))) then raise exception 'Focus block conflicts with an existing event'; end if;
  if exists(select from tasks where id=(p->>'task_id')::uuid and owner_id=auth.uid() and deadline<e) then raise exception 'Focus block exceeds task deadline'; end if;
 end if;
 if record_id is null then
  r=gen_random_uuid();
  insert into events(id,owner_id,title,description,category,kind,starts_at,ends_at,start_date,end_date,timezone,all_day,busy,locked,task_id,uid)
  values(r,auth.uid(),p->>'title',coalesce(p->>'description',''),p->>'category',p->>'kind',(p->>'starts_at')::timestamptz,(p->>'ends_at')::timestamptz,
   (p->>'start_date')::date,(p->>'end_date')::date,p->>'timezone',(p->>'all_day')::boolean,(p->>'busy')::boolean,(p->>'locked')::boolean,(p->>'task_id')::uuid,r::text||'@tempo');
 else
  update events set title=p->>'title',description=coalesce(p->>'description',''),category=p->>'category',kind=p->>'kind',starts_at=(p->>'starts_at')::timestamptz,ends_at=(p->>'ends_at')::timestamptz,
   start_date=(p->>'start_date')::date,end_date=(p->>'end_date')::date,timezone=p->>'timezone',all_day=(p->>'all_day')::boolean,busy=(p->>'busy')::boolean,locked=(p->>'locked')::boolean,task_id=(p->>'task_id')::uuid
  where id=record_id and owner_id=auth.uid(); r=record_id;
 end if; return r;
end $$;

create function public.create_proposal(p jsonb, expected bigint) returns public.proposals language plpgsql security definer set search_path=public,pg_temp as $$
declare r proposals; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform lock_workspace(auth.uid());
 if not exists(select from preferences where owner_id=auth.uid() and revision=expected) then raise exception 'Schedule changed; generate a new proposal'; end if;
 if octet_length(p::text)>262144 or jsonb_array_length(p->'blocks')>500 then raise exception 'Proposal too large'; end if;
 insert into proposals(owner_id,base_revision,payload) values(auth.uid(),expected,p) returning * into r; return r;
end $$;

create function public.apply_proposal(proposal uuid) returns public.change_batches language plpgsql security definer set search_path=public,pg_temp as $$
declare pr proposals; batch change_batches; item jsonb; rid uuid; created uuid[]='{}'; before_e jsonb='[]'; before_t jsonb='[]'; after_t jsonb='[]'; after_e jsonb='[]'; r events; t tasks; total numeric; pref preferences; local_start timestamp; local_end timestamp; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform lock_workspace(auth.uid());
 select * into pr from proposals where id=proposal and owner_id=auth.uid() for update;
 if pr.id is null then raise exception 'Proposal unavailable'; end if;
 if pr.status='applied' then select * into batch from change_batches where proposal_id=pr.id; return batch; end if;
 if pr.status<>'pending' then raise exception 'Proposal is no longer pending'; end if;
 select * into pref from preferences where owner_id=auth.uid();
 if pr.base_revision<>pref.revision then raise exception 'Stale proposal; generate a new plan'; end if;
 for item in select value from jsonb_array_elements(coalesce(pr.payload->'task_changes','[]')) loop
  if item ? 'id' then
   select * into t from tasks where id=(item->>'id')::uuid and owner_id=auth.uid();
   if t.id is null or t.version<>(item->>'version')::int then raise exception 'Stale task'; end if;
   before_t=before_t||jsonb_build_array(to_jsonb(t));
  end if;
  rid=write_task(item->'data',(item->>'id')::uuid,(item->>'version')::int,false);
  select * into t from tasks where id=rid; after_t=after_t||jsonb_build_array(to_jsonb(t));
 end loop;
 for item in select value from jsonb_array_elements(pr.payload->'remove_ids') loop
  select * into r from events where id=(item#>>'{}')::uuid and owner_id=auth.uid() and source_id is null and not locked and kind='focus';
  if r.id is null then raise exception 'Cannot remove locked or unavailable event'; end if;
  before_e=before_e||jsonb_build_array(to_jsonb(r)); delete from events where id=r.id;
 end loop;
 for item in select value from jsonb_array_elements(pr.payload->'blocks') loop
  local_start=(item->>'starts_at')::timestamptz at time zone pref.timezone;
  local_end=(item->>'ends_at')::timestamptz at time zone pref.timezone;
  if (item->>'starts_at')::timestamptz<now() or local_start::date<>local_end::date or not exists(
   select from jsonb_array_elements(pref.availability) a where (a->>'day')::int=extract(isodow from local_start) and (a->>'start')::time<=local_start::time and (a->>'end')::time>=local_end::time
  ) then raise exception 'Proposed block is outside future availability'; end if;
  if exists(select from tasks where id=(item->>'task_id')::uuid and owner_id=auth.uid() and status<>'open') then raise exception 'Task is no longer open'; end if;
  rid=write_event(item || jsonb_build_object('kind','focus','description',coalesce(item->>'reason',''),'all_day',false,'busy',true,'locked',false,'start_date',null,'end_date',null),null,null,false);
  created=array_append(created,rid);
  select * into r from events where id=rid; after_e=after_e||jsonb_build_array(to_jsonb(r));
 end loop;
 for t in select * from tasks where owner_id=auth.uid() and id in (select distinct (value->>'task_id')::uuid from jsonb_array_elements(pr.payload->'blocks')) loop
  select coalesce(sum(extract(epoch from (ends_at-greatest(starts_at,now())))/60),0) into total from events where owner_id=auth.uid() and task_id=t.id and kind='focus' and ends_at>now();
  if total>t.remaining_minutes then raise exception 'Scheduled effort exceeds remaining task effort'; end if;
 end loop;
 insert into change_batches(owner_id,proposal_id,created_ids,before_events,task_before,task_after,event_after)
 values(auth.uid(),pr.id,created,before_e,before_t,after_t,after_e) returning * into batch;
 update proposals set status='applied' where id=pr.id; return batch;
end $$;

create function public.undo_proposal(proposal uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare batch change_batches; item jsonb; t tasks; r events; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform lock_workspace(auth.uid());
 select * into batch from change_batches where proposal_id=proposal and owner_id=auth.uid() for update;
 if batch.id is null then raise exception 'Change batch unavailable'; end if;
 if batch.undone then return; end if;
 for item in select value from jsonb_array_elements(batch.event_after) loop
  if not exists(select from events where id=(item->>'id')::uuid and owner_id=auth.uid() and version=(item->>'version')::int) then raise exception 'Undo conflicts with a later event edit'; end if;
 end loop;
 for item in select value from jsonb_array_elements(batch.task_after) loop
  if not exists(select from tasks where id=(item->>'id')::uuid and owner_id=auth.uid() and version=(item->>'version')::int) then raise exception 'Undo conflicts with a later task edit'; end if;
  if not exists(select from jsonb_array_elements(batch.task_before) x where x->>'id'=item->>'id') and exists(select from events where task_id=(item->>'id')::uuid and not(id=any(batch.created_ids))) then raise exception 'Undo conflicts with later scheduled work'; end if;
 end loop;
 -- Validate restoration conflicts before changing anything.
 for item in select value from jsonb_array_elements(batch.before_events) loop
  if exists(select from events where owner_id=auth.uid() and not(id=any(batch.created_ids)) and busy and
   (source_id is null or exists(select from calendar_sources s where s.id=events.source_id and s.enabled)) and
   ((not all_day and starts_at<(item->>'ends_at')::timestamptz and ends_at>(item->>'starts_at')::timestamptz) or
    (all_day and (source_id is not null or (select all_day_busy from preferences where owner_id=auth.uid())) and start_date::timestamp at time zone timezone<(item->>'ends_at')::timestamptz and end_date::timestamp at time zone timezone>(item->>'starts_at')::timestamptz))) then raise exception 'Undo conflicts with newer commitments'; end if;
 end loop;
 delete from events where owner_id=auth.uid() and id=any(batch.created_ids);
 for item in select value from jsonb_array_elements(batch.task_after) loop
  if exists(select from jsonb_array_elements(batch.task_before) x where x->>'id'=item->>'id') then
   select (jsonb_populate_record(null::tasks,x)).* into t from jsonb_array_elements(batch.task_before) x where x->>'id'=item->>'id';
   perform write_task(to_jsonb(t),t.id,(item->>'version')::int,false);
  else delete from tasks where id=(item->>'id')::uuid and owner_id=auth.uid(); end if;
 end loop;
 for item in select value from jsonb_array_elements(batch.before_events) loop
  r=jsonb_populate_record(null::events,item); r.version=r.version+1; r.updated_at=now(); insert into events select (r).*;
 end loop;
 update change_batches set undone=true where id=batch.id; update proposals set status='undone' where id=proposal;
end $$;

create function public.reject_proposal(proposal uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if auth.uid() is null then raise exception 'Authentication required'; end if;
 update proposals set status='rejected' where id=proposal and owner_id=auth.uid() and status='pending';
end $$;

create function public.write_source(p jsonb, record_id uuid default null, expected integer default null, remove boolean default false) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare r uuid; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 perform lock_workspace(auth.uid());
 if record_id is not null and not exists(select from calendar_sources where id=record_id and owner_id=auth.uid() and version=expected) then raise exception 'Stale source or access denied'; end if;
 if remove then delete from calendar_sources where id=record_id and owner_id=auth.uid(); return record_id; end if;
 if record_id is null then
  if (select count(*) from calendar_sources where owner_id=auth.uid())>=20 then raise exception 'Calendar source limit reached'; end if;
  insert into calendar_sources(owner_id,name,kind,url,timezone,enabled,all_day_busy) values(auth.uid(),p->>'name',p->>'kind',p->>'url',(select timezone from preferences where owner_id=auth.uid()),true,coalesce((p->>'all_day_busy')::boolean,false)) returning id into r;
 else update calendar_sources set name=p->>'name',enabled=(p->>'enabled')::boolean,all_day_busy=(p->>'all_day_busy')::boolean where id=record_id and owner_id=auth.uid() returning id into r;
  update events set busy=(p->>'all_day_busy')::boolean and not coalesce((recurrence->>'transparent')::boolean,false) where source_id=record_id and owner_id=auth.uid() and all_day;
 end if; return r;
end $$;

-- Import reconciliation only upserts recognized identities and removes explicit
-- cancellations. Absence never deletes an old event (partial feeds are common).
create function public.reconcile_source(source uuid, raw text, entries jsonb, canceled jsonb, expected integer, job_owner uuid default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid; item jsonb; src calendar_sources; begin
 u=auth.uid(); if job_owner is not null then
  if auth.role() is distinct from 'service_role' then raise exception 'Access denied'; end if; u=job_owner;
 end if;
 if u is null then raise exception 'Authentication required'; end if;
 perform lock_workspace(u);
 select * into src from calendar_sources where id=source and owner_id=u;
 if src.id is null or src.version<>expected then raise exception 'Stale source or access denied'; end if;
 if octet_length(raw)>1048576 or jsonb_array_length(entries)>2000 then raise exception 'Calendar too large'; end if;
 for item in select value from jsonb_array_elements(entries) loop
  insert into events(owner_id,source_id,title,description,category,kind,starts_at,ends_at,start_date,end_date,timezone,all_day,busy,locked,uid,recurrence_id,recurrence)
  values(u,source,item->>'title',coalesce(item->>'description',''),'personal','commitment',(item->>'starts_at')::timestamptz,(item->>'ends_at')::timestamptz,(item->>'start_date')::date,(item->>'end_date')::date,item->>'timezone',(item->>'all_day')::boolean,(item->>'busy')::boolean,true,item->>'uid',coalesce(item->>'recurrence_id',''),item->'recurrence')
  on conflict(owner_id,source_id,uid,recurrence_id) do update set title=excluded.title,description=excluded.description,starts_at=excluded.starts_at,ends_at=excluded.ends_at,start_date=excluded.start_date,end_date=excluded.end_date,timezone=excluded.timezone,all_day=excluded.all_day,busy=excluded.busy,recurrence=excluded.recurrence;
 end loop;
 for item in select value from jsonb_array_elements(canceled) loop
  delete from events where owner_id=u and source_id=source and uid=item->>'uid' and (item->>'recurrence_id' is null or recurrence_id=item->>'recurrence_id');
 end loop;
 update calendar_sources set raw_ics=raw,last_success=now(),last_attempt=now(),refresh_error=null,refresh_lease=null where id=source;
end $$;

create function public.claim_refresh(source uuid, job_owner uuid default null) returns public.calendar_sources language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid; r calendar_sources; begin
 u=auth.uid(); if job_owner is not null then if auth.role() is distinct from 'service_role' then raise exception 'Access denied'; end if; u=job_owner; end if;
 if u is null then raise exception 'Authentication required'; end if;
 perform lock_workspace(u);
 update calendar_sources set refresh_lease=now()+interval '2 minutes',last_attempt=now()
 where id=source and owner_id=u and kind='feed' and enabled and (refresh_lease is null or refresh_lease<now()) and (last_attempt is null or last_attempt<now()-interval '1 minute') returning * into r;
 if r.id is null then raise exception 'Refresh already running, disabled, or rate limited'; end if; return r;
end $$;
create function public.fail_refresh(source uuid, job_owner uuid default null) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid; begin
 u=auth.uid(); if job_owner is not null then if auth.role() is distinct from 'service_role' then raise exception 'Access denied'; end if; u=job_owner; end if;
 if u is null then raise exception 'Authentication required'; end if;
 update calendar_sources set refresh_error='Refresh failed. Last successful events have been kept.',refresh_lease=null where id=source and owner_id=u;
end $$;
create function public.set_feed(hash text default null, commitments boolean default true, focus boolean default true) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if hash is null then delete from feed_tokens where owner_id=auth.uid(); else
  if hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid token hash'; end if;
  insert into feed_tokens(owner_id,token_hash,include_commitments,include_focus) values(auth.uid(),hash,commitments,focus)
  on conflict(owner_id) do update set token_hash=excluded.token_hash,include_commitments=excluded.include_commitments,include_focus=excluded.include_focus,created_at=now();
 end if;
end $$;
create function public.append_message(message_role text, text_content text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin if auth.uid() is null then raise exception 'Authentication required'; end if;
 insert into messages(owner_id,role,content) values(auth.uid(),message_role,text_content);
 delete from messages where owner_id=auth.uid() and id not in(select id from messages where owner_id=auth.uid() order by created_at desc limit 100);
end $$;
create function public.take_rate_limit(bucket_name text, max_count int, seconds int) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare n integer; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if not ((bucket_name='ai' and max_count=10 and seconds=3600) or (bucket_name='import' and max_count=10 and seconds=60) or (bucket_name='mutation' and max_count=120 and seconds=60)) then raise exception 'Invalid rate bucket policy'; end if;
 insert into rate_limits(owner_id,bucket,period,count) values(auth.uid(),bucket_name,now(),1)
 on conflict(owner_id,bucket) do update set count=case when rate_limits.period<now()-make_interval(secs=>seconds) then 1 else rate_limits.count+1 end,
 period=case when rate_limits.period<now()-make_interval(secs=>seconds) then now() else rate_limits.period end returning count into n;
 return n<=max_count;
end $$;

-- Functions default to PUBLIC execute; explicitly close every entry point first.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in
 ('ensure_preferences','lock_workspace','bump_record','save_preferences','write_task','write_event','create_proposal','apply_proposal','undo_proposal','reject_proposal','write_source','reconcile_source','claim_refresh','fail_refresh','set_feed','append_message','take_rate_limit') loop
  execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  if f.signature::text not like 'lock_workspace(%' and f.signature::text not like 'bump_record(%' then execute format('grant execute on function %s to authenticated, service_role',f.signature); end if;
 end loop;
end $$;
