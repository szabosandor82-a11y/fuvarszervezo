# send-delivery-report Edge Function

A `functions/send-delivery-report/index.ts` fájlt telepítsd `send-delivery-report` néven.

Szükséges secrets:

```text
RESEND_API_KEY=re_...
RESEND_FROM=Fuvarszervező <fuvar@hitelesitett-domain.hu>
```

Supabase CLI példa:

```bash
supabase login
supabase link --project-ref SAJAT_PROJECT_REF
supabase secrets set RESEND_API_KEY=re_... RESEND_FROM="Fuvarszervező <fuvar@hitelesitett-domain.hu>"
supabase functions deploy send-delivery-report
```

A funkció a bejelentkezett felhasználó JWT-jét ellenőrzi, a privát Storage fájlokat rövid életű aláírt URL-lel tölti le, és a képeket mellékletként küldi.
