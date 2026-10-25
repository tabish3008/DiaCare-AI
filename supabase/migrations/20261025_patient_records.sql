-- DIACARE AI database foundation for a Supabase-hosted PostgreSQL project.
-- This migration stores only pseudonymous patient labels and confirmed readings.
-- Uploaded PDFs/PNGs and extracted raw document text are intentionally not stored.

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  period_start date,
  period_end date,
  created_at timestamptz not null default now(),
  constraint patient_period_order check (
    period_start is null or period_end is null or period_start <= period_end
  ),
  constraint patients_id_owner_unique unique (id, owner_id)
);

create table if not exists public.patient_readings (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  measurement_date date not null,
  test_type text not null check (test_type in ('glucose', 'hba1c')),
  value numeric(10, 3) not null check (value > 0),
  unit text not null,
  fasting_status text not null default 'unknown'
    check (fasting_status in ('yes', 'no', 'unknown', 'not_applicable')),
  source_type text not null default 'manual'
    check (source_type in ('manual', 'pdf_import')),
  created_at timestamptz not null default now(),
  constraint patient_readings_patient_owner_fk
    foreign key (patient_id, owner_id)
    references public.patients (id, owner_id) on delete cascade,
  constraint patient_readings_unit_matches_test check (
    (test_type = 'glucose' and unit in ('mg/dL', 'mmol/L')) or
    (test_type = 'hba1c' and unit in ('%', 'mmol/mol'))
  )
);

create index if not exists patient_readings_owner_date_idx
  on public.patient_readings (owner_id, measurement_date desc);

create index if not exists patient_readings_patient_date_idx
  on public.patient_readings (patient_id, measurement_date desc);

alter table public.patients enable row level security;
alter table public.patient_readings enable row level security;

-- Signed-out visitors have no access. Signed-in users only receive their rows.
revoke all on table public.patients from anon, authenticated;
revoke all on table public.patient_readings from anon, authenticated;
grant select, insert, update, delete on table public.patients to authenticated;
grant select, insert, update, delete on table public.patient_readings to authenticated;

create policy patients_select_own
  on public.patients for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy patients_insert_own
  on public.patients for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy patients_update_own
  on public.patients for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy patients_delete_own
  on public.patients for delete to authenticated
  using ((select auth.uid()) = owner_id);

create policy patient_readings_select_own
  on public.patient_readings for select to authenticated
  using ((select auth.uid()) = owner_id);

create policy patient_readings_insert_own
  on public.patient_readings for insert to authenticated
  with check ((select auth.uid()) = owner_id);

create policy patient_readings_update_own
  on public.patient_readings for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy patient_readings_delete_own
  on public.patient_readings for delete to authenticated
  using ((select auth.uid()) = owner_id);
