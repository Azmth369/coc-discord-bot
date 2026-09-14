import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

export const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export async function upsert(table, rows) {
  const { error } = await db.from(table).upsert(rows);
  if (error) throw error;
}
