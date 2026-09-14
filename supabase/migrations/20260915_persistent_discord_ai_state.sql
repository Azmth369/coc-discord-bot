-- Persistent Discord AI state migration.
-- Run this once in the NEW Supabase project's SQL Editor.

alter table if exists public.ai_answers
  add column if not exists elapsed_seconds text;

create index if not exists ai_answers_message_idx
  on public.ai_answers(message_id);
