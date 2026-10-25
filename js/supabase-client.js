import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const hasConfig = Boolean(
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY &&
  SUPABASE_PUBLISHABLE_KEY !== 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE'
);

export async function initializeSupabase() {
  if (!hasConfig) return { client: null, configured: false, needsKey: true, error: '' };
  try {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    return { client: createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY), configured: true, needsKey: false, error: '' };
  } catch (error) {
    return { client: null, configured: false, needsKey: false, error: 'The Supabase browser library could not load. Check the internet connection and reload.' };
  }
}
