-- Run once in Supabase -> SQL Editor, after 20261103000000_prompt_chain_tool.sql.
--
-- Lets a prompt chain step generate an image:
-- 1. prompt_chain_steps.output_format can be 'image'. Such a step calls an
--    image-capable Gemini model; later steps that send the image get the
--    newest generated one instead of the run's upload.
-- 2. llm_models.purpose can be 'image'. The prompt chain tool adds image
--    models here the first time an admin picks one (it lists the ones the
--    Gemini key can use). The meme board only reads 'caption' and
--    'background' models, so it's unaffected.
-- 3. llm_responses.image_url keeps each generated image (stored in the
--    cracks bucket under prompt-chains/generated/), and
--    generation_requests.output_image_url the run's last one.

alter table public.prompt_chain_steps
  drop constraint if exists prompt_chain_steps_output_format_check;
alter table public.prompt_chain_steps
  add constraint prompt_chain_steps_output_format_check
  check (output_format in ('text', 'list', 'image'));

alter table public.llm_models
  drop constraint if exists llm_models_purpose_check;
alter table public.llm_models
  add constraint llm_models_purpose_check
  check (purpose in ('caption', 'background', 'image'));

alter table public.llm_responses
  add column if not exists image_url text;

alter table public.generation_requests
  add column if not exists output_image_url text;

notify pgrst, 'reload schema';
