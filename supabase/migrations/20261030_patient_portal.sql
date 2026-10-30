-- Add patient portal visit tracking and a care-team-entered medication note.
-- This is display-only information; it is not generated as medical advice.
alter table public.patients
  add column if not exists last_visited_at timestamptz,
  add column if not exists care_team_medication text not null default ''
    check (char_length(care_team_medication) <= 1000);

create index if not exists patients_owner_last_visited_idx
  on public.patients (owner_id, last_visited_at desc);
