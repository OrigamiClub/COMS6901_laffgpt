# laffgpt: the Crackd prompt chain tool

The third Crackd app, alongside the meme board
([crackd_COMS4901](https://github.com/OrigamiClub/crackd_COMS4901)) and the
admin area ([crackd_COMS4901_admin](https://github.com/OrigamiClub/crackd_COMS4901_admin)).
It uses the same Supabase project and Gemini key. Only accounts with
`profiles.is_superadmin = true` can get in.

## What it does

- Create, edit and delete prompt chains.
- Add, edit, delete and reorder a chain's steps (↑/↓ or "Move to position").
  Each step has its own prompt, Gemini model, temperature (0–2), output
  format (text or a list), and can send the run's image.
- Run a chain on an image, some text, or both. Steps run one at a time and
  each output is shown as it arrives. `{{input}}` in a prompt is the previous
  step's output (the run's text for step 1); `{{original_text}}` is always the
  run's text.
- Browse the media each chain produced: image, input, final output and every
  step's output.
- Light, dark or system theme.

The meme board's three hard-coded chains (caption, tag, humor-summary) are
listed read-only, with their runs from the board under Media.

## Setup

1. Run `supabase/migrations/20261103000000_prompt_chain_tool.sql` once in the
   Supabase SQL editor. It needs the admin repo's migrations first.
2. Copy `.env.example` to `.env.local` and fill it in.
3. Add `http://localhost:3000/auth/callback` and
   `https://<vercel-domain>/auth/callback` to Supabase → Authentication → URL
   Configuration → Redirect URLs.
4. `npm install && npm run dev`.

Runs are logged in `generation_requests` (source `prompt-chain-tool`), with
every model attempt in `llm_responses`. They also show up on the admin area's
Generations page. Uploaded images go to the `cracks` bucket under
`prompt-chains/`.
