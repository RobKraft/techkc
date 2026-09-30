# Fix Netlify secrets-scan build failure

- **Date:** 2026-09-30
- **Status:** Completed

## Request (from a failed deploy)

Netlify build failed after the previous push:

```
Secret env var "PUBLIC_AUTH0_AUDIENCE"'s value detected: found value at line 5 in .env.example
```

## What happened

`.env.example` documented `PUBLIC_AUTH0_AUDIENCE=https://techkc.org/api` as the example value — which is exactly the real value Rob configured in Netlify's environment variables. Netlify's build-time secrets scanner flags any repo/build-output content that literally matches a configured environment variable's value, regardless of whether that variable is actually sensitive. It doesn't know `PUBLIC_*` vars are meant to be public.

## What changed

- [netlify.toml](../netlify.toml) — added `SECRETS_SCAN_OMIT_KEYS` for `PUBLIC_AUTH0_DOMAIN`, `PUBLIC_AUTH0_CLIENT_ID`, and `PUBLIC_AUTH0_AUDIENCE`. This is the root-cause fix: these three are deliberately sent to the browser (Astro's `PUBLIC_*` convention), so they were never secrets to begin with.
- [.env.example](../.env.example) — changed the audience placeholder from the real-looking `https://techkc.org/api` to a clearly generic `https://your-site.example/api`, so a future documented example is less likely to accidentally collide with a real configured value again.

## Verification

`npm run build` passes locally. Actual resolution of the Netlify build failure will be confirmed on the next deploy.
