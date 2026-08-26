import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Null when the env vars are unset. Every call site branches on this and falls
// back to LocalStorage, so the app stays fully usable offline and static builds
// succeed without any Supabase configuration.
//
// Only the URL and the anon/publishable key belong here. The service_role key
// bypasses Row Level Security and must never appear in a NEXT_PUBLIC_ variable,
// in client code, or in this repository.
export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          // PKCE completes the ?code= exchange in the browser, so no server
          // route is required and the same bundle works on a static export.
          flowType: 'pkce',
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      })
    : null;

export const isCloudEnabled = Boolean(supabase);
