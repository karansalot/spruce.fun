# Database Migrations

Run these SQL files in your Supabase project to create/update tables.

## How to run

1. Open your Supabase project dashboard
2. Go to **SQL Editor**
3. Run `001_yellow_session_keys.sql` first (creates the table)
4. If you already ran 001 before the private key column was added, run `002_add_session_private_key.sql`

Or use the Supabase CLI: `supabase db push` (if using local Supabase).
