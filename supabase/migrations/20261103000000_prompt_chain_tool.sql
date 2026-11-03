-- Run once in Supabase -> SQL Editor (the same project as the meme board
-- and the admin area), after the admin repo's
-- 20261027000000_ai_pipeline_and_signup_rules.sql.
--
-- Makes prompt chains editable and runnable for the prompt chain tool:
-- 1. prompt_chains.is_builtin marks the board's three chains (caption, tag,
--    humor-summary). Those only document code, so they stay read-only.
-- 2. prompt_chain_steps gets what a runnable step needs: a prompt template,
--    a model, a temperature, whether the run's image goes with it, and
--    whether it answers in plain text or as a list.
-- 3. step_order uniqueness is checked at commit, so a reorder can renumber
--    every step in one statement. reorder_prompt_chain_steps() and
--    delete_prompt_chain_step() keep the numbering 1..n.
-- 4. generation_requests can come from 'prompt-chain-tool' and stores the
--    run's input (text and/or image) and final output.
-- 5. RLS: admins can create, edit and delete chains and steps that aren't
--    built-in.
-- Everything is additive; the board and the admin area keep working.

-- 1. Chains

alter table public.prompt_chains
  add column if not exists is_builtin boolean not null default false,
  add column if not exists created_by uuid references auth.users (id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.prompt_chains
set is_builtin = true
where slug in ('caption', 'tag', 'humor-summary');

-- 2. Steps

alter table public.prompt_chain_steps
  alter column description set default '',
  -- {{input}} is the previous step's output (the run's text for step 1);
  -- {{original_text}} is always the run's text.
  add column if not exists prompt text check (prompt is null or length(prompt) <= 4000),
  add column if not exists model_id bigint references public.llm_models (id) on delete set null,
  add column if not exists temperature numeric(3, 2) not null default 1.0
    check (temperature between 0 and 2),
  add column if not exists include_image boolean not null default false,
  add column if not exists output_format text not null default 'text'
    check (output_format in ('text', 'list'));

-- 3. Ordering

alter table public.prompt_chain_steps
  drop constraint if exists prompt_chain_steps_chain_id_step_order_key;
alter table public.prompt_chain_steps
  drop constraint if exists prompt_chain_steps_order_key;
alter table public.prompt_chain_steps
  add constraint prompt_chain_steps_order_key
  unique (chain_id, step_order) deferrable initially deferred;

-- Sets step_order to each id's position in p_step_ids (1-based). The ids
-- must be exactly the chain's steps. Runs as the caller, so RLS decides
-- who may reorder.
create or replace function public.reorder_prompt_chain_steps(
  p_chain_id bigint,
  p_step_ids bigint[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_ids bigint[];
  updated int;
begin
  select coalesce(array_agg(id order by id), '{}')
  into current_ids
  from prompt_chain_steps
  where chain_id = p_chain_id;

  if current_ids is distinct from (
    select coalesce(array_agg(x order by x), '{}') from unnest(p_step_ids) as x
  ) then
    raise exception 'The step list doesn''t match the chain''s steps.'
      using errcode = '22023';
  end if;

  update prompt_chain_steps s
  set step_order = o.position
  from unnest(p_step_ids) with ordinality as o (id, position)
  where s.id = o.id and s.chain_id = p_chain_id;
  get diagnostics updated = row_count;

  if updated <> coalesce(array_length(p_step_ids, 1), 0) then
    raise exception 'Not allowed to reorder these steps.' using errcode = '42501';
  end if;

  update prompt_chains set updated_at = now() where id = p_chain_id;
end;
$$;

-- Deletes a step and closes the gap it leaves in the numbering.
create or replace function public.delete_prompt_chain_step(p_step_id bigint)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted_chain bigint;
  deleted_order int;
begin
  delete from prompt_chain_steps
  where id = p_step_id
  returning chain_id, step_order into deleted_chain, deleted_order;

  if deleted_chain is null then
    raise exception 'Not allowed to delete this step.' using errcode = '42501';
  end if;

  update prompt_chain_steps
  set step_order = step_order - 1
  where chain_id = deleted_chain and step_order > deleted_order;

  update prompt_chains set updated_at = now() where id = deleted_chain;
end;
$$;

revoke execute on function public.reorder_prompt_chain_steps(bigint, bigint[]) from public, anon;
revoke execute on function public.delete_prompt_chain_step(bigint) from public, anon;
grant execute on function public.reorder_prompt_chain_steps(bigint, bigint[]) to authenticated;
grant execute on function public.delete_prompt_chain_step(bigint) to authenticated;

-- 4. Runs

alter table public.generation_requests
  drop constraint if exists generation_requests_source_check;
alter table public.generation_requests
  add constraint generation_requests_source_check
  check (source in ('meme-board', 'admin', 'prompt-chain-tool'));

alter table public.generation_requests
  add column if not exists input_text text,
  add column if not exists image_url text,
  add column if not exists output text,
  add column if not exists output_json jsonb;

create index if not exists generation_requests_chain_idx
  on public.generation_requests (chain_id, created_at desc);

-- 5. Row-level security (admins can already read both tables)

drop policy if exists "Admins can add" on public.prompt_chains;
create policy "Admins can add"
on public.prompt_chains for insert
to authenticated
with check (public.is_superadmin() and not is_builtin);

drop policy if exists "Admins can edit" on public.prompt_chains;
create policy "Admins can edit"
on public.prompt_chains for update
to authenticated
using (public.is_superadmin() and not is_builtin)
with check (public.is_superadmin() and not is_builtin);

drop policy if exists "Admins can delete" on public.prompt_chains;
create policy "Admins can delete"
on public.prompt_chains for delete
to authenticated
using (public.is_superadmin() and not is_builtin);

create or replace function public.is_editable_chain(p_chain_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_superadmin() and exists (
    select 1 from prompt_chains where id = p_chain_id and not is_builtin
  );
$$;

revoke execute on function public.is_editable_chain(bigint) from public, anon;
grant execute on function public.is_editable_chain(bigint) to authenticated;

drop policy if exists "Admins can add" on public.prompt_chain_steps;
create policy "Admins can add"
on public.prompt_chain_steps for insert
to authenticated
with check (public.is_editable_chain(chain_id));

drop policy if exists "Admins can edit" on public.prompt_chain_steps;
create policy "Admins can edit"
on public.prompt_chain_steps for update
to authenticated
using (public.is_editable_chain(chain_id))
with check (public.is_editable_chain(chain_id));

drop policy if exists "Admins can delete" on public.prompt_chain_steps;
create policy "Admins can delete"
on public.prompt_chain_steps for delete
to authenticated
using (public.is_editable_chain(chain_id));

notify pgrst, 'reload schema';
