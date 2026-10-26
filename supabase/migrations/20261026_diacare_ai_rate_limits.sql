-- Server-side rate limits for public Ask Direct AI requests.
create table if not exists public.diacare_ai_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

alter table public.diacare_ai_rate_limits enable row level security;
revoke all on table public.diacare_ai_rate_limits from public, anon, authenticated;

create or replace function public.consume_diacare_ai_rate_limit(
  p_ip_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit parameters';
  end if;

  insert into public.diacare_ai_rate_limits as limits (ip_hash, window_started_at, request_count)
  values (p_ip_hash, pg_catalog.now(), 1)
  on conflict (ip_hash) do update set
    window_started_at = case
      when limits.window_started_at <= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds)
        then pg_catalog.now()
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= pg_catalog.now() - pg_catalog.make_interval(secs => p_window_seconds)
        then 1
      else limits.request_count + 1
    end
  returning request_count into current_count;

  delete from public.diacare_ai_rate_limits
  where window_started_at < pg_catalog.now() - interval '1 day';

  return current_count <= p_limit;
end;
$$;

revoke all on function public.consume_diacare_ai_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_diacare_ai_rate_limit(text, integer, integer) to service_role;
