-- Memoji generation schema and function migration

create table if not exists public.memoji_cache (
    id uuid primary key default gen_random_uuid(),
    prompt_hash text not null unique,
    image_url text not null,
    prompt_config jsonb not null,
    generation_cost numeric(10,4) default 0.02,
    usage_count integer default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_used_at timestamptz default now(),
    archived boolean default false
);

create index if not exists idx_memoji_cache_hash on public.memoji_cache(prompt_hash);
create index if not exists idx_memoji_cache_created_at on public.memoji_cache(created_at);
create index if not exists idx_memoji_cache_usage_count on public.memoji_cache(usage_count desc);

alter table public.memoji_cache enable row level security;
create policy memoji_cache_service_all on public.memoji_cache for all to public using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy memoji_cache_read on public.memoji_cache for select to authenticated using (true);

create trigger tr_memoji_cache_set_updated_at
before update on public.memoji_cache
for each row execute function update_updated_at_column();

create table if not exists public.users (
    user_id uuid primary key references auth.users (id) on delete cascade,
    avatar_generation_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.users enable row level security;
create policy users_service_all on public.users for all to public using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create trigger tr_users_set_updated_at
before update on public.users
for each row execute function update_updated_at_column();

create table if not exists public.memoji_jobs (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    prompt jsonb not null,
    status text not null default 'pending',
    failure_reason text,
    image_url text,
    prompt_hash text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_memoji_jobs_user_id on public.memoji_jobs(user_id);
create index if not exists idx_memoji_jobs_status on public.memoji_jobs(status);

alter table public.memoji_jobs enable row level security;
create policy memoji_jobs_self on public.memoji_jobs for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy memoji_jobs_service_all on public.memoji_jobs for all to public using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create trigger tr_memoji_jobs_set_updated_at
before update on public.memoji_jobs
for each row execute function update_updated_at_column();

set check_function_bodies = off;

create or replace function public.increment_memoji_usage(hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
BEGIN
    UPDATE public.memoji_cache
    SET usage_count = COALESCE(usage_count, 0) + 1,
        last_used_at = now(),
        updated_at = now()
    WHERE prompt_hash = hash
      AND archived = false;
END;
$$;

