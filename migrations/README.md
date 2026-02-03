# Migrations

Place SQL migration files in this folder when you need schema changes.

Recommended workflow (Supabase CLI):
1. Create a new migration: `supabase migration new <name>`
2. Move or copy the generated SQL file into `migrations/` if needed.
3. Apply locally: `supabase db reset` or `supabase db push`

Manual workflow:
- Add a timestamped `.sql` file to this folder.
- Apply it to your Supabase database using the SQL editor or CLI.

This repo does not include migrations yet; keep this folder as the canonical place for future schema changes.
