create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_chapter integer not null default 1 check (selected_chapter between 1 and 9),
  mode text not null default 'learn' check (mode in ('learn', 'reference', 'verse', 'review', 'quiz')),
  updated_at timestamptz not null default now()
);

create table if not exists public.verse_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  verse_id text not null,
  confidence integer not null default 0 check (confidence between 0 and 7),
  attempts integer not null default 0 check (attempts >= 0),
  correct integer not null default 0 check (correct >= 0),
  streak integer not null default 0 check (streak >= 0),
  last_reviewed timestamptz,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, verse_id)
);

create table if not exists public.quiz_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter integer not null check (chapter between 1 and 9),
  score integer not null,
  correct integer not null default 0 check (correct >= 0),
  incorrect integer not null default 0 check (incorrect >= 0),
  no_responses integer not null default 0 check (no_responses >= 0),
  details jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.study_state enable row level security;
alter table public.verse_progress enable row level security;
alter table public.quiz_sessions enable row level security;

create policy "Users can read their profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert their profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can read their study state"
  on public.study_state for select
  using (auth.uid() = user_id);

create policy "Users can insert their study state"
  on public.study_state for insert
  with check (auth.uid() = user_id);

create policy "Users can update their study state"
  on public.study_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can read their verse progress"
  on public.verse_progress for select
  using (auth.uid() = user_id);

create policy "Users can insert their verse progress"
  on public.verse_progress for insert
  with check (auth.uid() = user_id);

create policy "Users can update their verse progress"
  on public.verse_progress for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their verse progress"
  on public.verse_progress for delete
  using (auth.uid() = user_id);

create policy "Users can read their quiz sessions"
  on public.quiz_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert their quiz sessions"
  on public.quiz_sessions for insert
  with check (auth.uid() = user_id);
