# Utility App Demo
NextJS demo app to calculate monthly utilities usage (WIP)

Hosted on [Vercel](https://yh-utility-app.vercel.app/).

The GitHub Pages deployment was retired: a static export has no server, so the
`/api/tariff` route could never run there and the SP tariff lookup was
permanently dead on that URL.

## Storage

The app is offline-first. With no environment variables set it runs entirely on
LocalStorage — every feature works except cross-device sync. Setting the two
Supabase variables below activates Google sign-in and cloud sync.

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
```

Only the anon key belongs in a `NEXT_PUBLIC_` variable. The `service_role` key
bypasses Row Level Security and must never appear in client code, in a
`NEXT_PUBLIC_` variable, or in this repository.

## Supabase setup

1. Apply `supabase/migrations/0001_init.sql` (SQL editor, or `supabase db push`).
2. **Authentication → Providers → Google**: enable, paste the OAuth client ID and
   secret from Google Cloud. The only redirect URI Google needs is
   `https://<project-ref>.supabase.co/auth/v1/callback` — new frontend domains
   never require a Google Cloud change.
3. **Authentication → URL Configuration**:
   - Site URL: `https://yh-utility-app.vercel.app`
   - Additional Redirect URLs:
     - `http://localhost:3000/**`
     - `https://yh-utility-app.vercel.app/**`
     - `https://yh-utility-app-*.vercel.app/**` (covers Vercel previews)
