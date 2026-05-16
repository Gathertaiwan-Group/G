# RealReal Go-Live Readiness — Action Checklist

Compiled from an end-to-end analysis (payment / DNS / email). Goal: RealReal
can take real orders on `realreal.cc`. Each item is tagged **[OWNER]**
(needs your credentials / DNS / accounts — cannot be automated for safety) or
**[AUTOMATABLE]** (an agent can apply once you supply the secret/approval).

Status legend: ☐ todo · ✅ done.

---

## 0. Code blocker — FIXED

- ✅ **GAP#1 (PR #62, merged):** PChomePay/JKOPay webhooks queried a
  non-existent `payment_transactions` table → customers paid but orders
  stayed unpaid. Repointed to the real `payments` table (verified against
  live tenant DB `ozwftlkgqmewtadypsfi`; mirrors the working LINE Pay path).
  realreal `api` redeployed with the fix.
- ⚠️ **GAP#2 (not blocking one-off sales):** subscription *recurring* charge
  is a stub (`apps/api/src/lib/subscription-billing.ts` — decrypts token then
  `TODO`, marks success without charging). One-off checkout unaffected;
  recurring billing non-functional until implemented.
- ⚠️ **GAP#3:** token-encryption env name mismatch — code reads
  `TOKEN_ENCRYPTION_KEY`, `.env.example` documents
  `PAYMENT_TOKEN_ENCRYPTION_KEY`. Only affects card-binding/subscriptions,
  not one-off checkout. Set the env as `TOKEN_ENCRYPTION_KEY` on the realreal
  `api` service if subscriptions are used.

## 1. Payment — collect money  [OWNER provides keys]

`site_contents` row `key='payment_config'` (jsonb), edited via the admin UI:
**`https://<storefront>/admin/settings/payments`** (admin login required;
`PUT /admin/payment-config`; blank field = keep, `__CLEAR__` = clear). No SQL.

Full field set the code reads (15 keys):

```json
{
  "pchomepay_app_id": "<PChomePay App ID>",
  "pchomepay_secret": "<PChomePay Secret>",
  "pchomepay_hash_key": "<PChomePay HashKey>",
  "pchomepay_hash_iv": "<PChomePay HashIV>",
  "linepay_channel_id": "<LINE Pay Channel ID>",
  "linepay_channel_secret": "<LINE Pay Channel Secret>",
  "jkopay_store_id": "<JKOPay Store ID>",
  "jkopay_api_key": "<JKOPay API Key>",
  "jkopay_secret_key": "<JKOPay Secret Key>",
  "ecpay_merchant_id": "<ECPay Merchant ID>",
  "ecpay_hash_key": "<ECPay HashKey>",
  "ecpay_hash_iv": "<ECPay HashIV>",
  "amego_tax_id": "60515111",
  "amego_app_key": "<Amego App Key>",
  "amego_webhook_secret": "<Amego Webhook Secret>"
}
```

- ☐ **[OWNER]** Obtain PChomePay production keys (covers card/ATM/CVS) — the
  minimum to take a first order. LINE Pay / JKOPay / Amego optional for v1.
- ☐ **[OWNER]** Paste into `/admin/settings/payments`.
- ☐ **[OWNER]** Register webhook URLs in each provider's back-office
  (use the current API host now; switch to `api.realreal.cc` after §2 DNS):
  - PChomePay: `https://api-production-ed3c.up.railway.app/webhooks/pchomepay`
    and `/webhooks/pchomepay-token`
  - JKOPay: `…/webhooks/jkopay`
  - LINE Pay: `…/webhooks/linepay/confirm` and `/webhooks/linepay/cancel`
  - ECPay logistics: `…/webhooks/ecpay-logistics`
  - Amego: `…/webhooks/amego`
- ☐ Place one real low-value order → confirm `orders.payment_status` flips
  to `paid` and an Amego invoice is issued.

## 2. DNS cutover — `realreal.cc` → new platform  [OWNER edits Cloudflare]

Provider domains are NOT yet attached (must pre-stage):

- ☐ **[AUTOMATABLE pre-stage]** Add `realreal.cc` + `www.realreal.cc` to
  Vercel project `agent-web`
  (`POST /v10/projects/prj_VMy1ma8iCzJSljGQilMCMiLD7ohi/domains?teamId=team_h33wAW81MwFMqsZoBDQkNj1M`).
- ☐ **[AUTOMATABLE pre-stage]** Create Railway custom domain
  `api.realreal.cc` on service `e61cf527-…` — **capture the CNAME target
  Railway returns** (do not guess it).
- ☐ **[OWNER]** Lower current `realreal.cc` Cloudflare TTL to 120s; wait.
- ☐ **[OWNER]** Set Cloudflare records (all **DNS-only / grey cloud**):

  | Host | Type | Target | TTL |
  |---|---|---|---|
  | `realreal.cc` | A | `76.76.21.21` | 120 |
  | `www.realreal.cc` | CNAME | `cname.vercel-dns.com` | 120 |
  | `api.realreal.cc` | CNAME | *(value Railway returned above)* | 120 |

- ☐ Verify: `dig +short realreal.cc` → `76.76.21.21`;
  `curl -sI https://realreal.cc/` 200; `curl -s https://api.realreal.cc/health` 200; green padlock.
- ☐ **[AUTOMATABLE]** Supabase Auth `site_url`
  `https://agent-web-xi.vercel.app` → `https://realreal.cc`
  (allow-list already includes realreal.cc/www/platform).
- **Rollback:** restore Cloudflare `realreal.cc` A → `104.21.72.81` +
  `172.67.177.138` (**proxied/orange**), delete new CNAMEs, revert
  `site_url`. Low TTL makes this ~2 min.

## 3. Email — customer signup confirmation  [OWNER confirms Resend]

Auth currently: `mailer_autoconfirm:false` (confirmation required),
`smtp_host` empty → Supabase built-in sender, `rate_limit_email_sent:2/hr`
(unusable for production). `RESEND_API_KEY` + `RESEND_FROM_EMAIL` are already
SET on the realreal `api` Railway service (app email works; Auth email does not).

- ☐ **[OWNER]** In Resend dashboard confirm sending domain
  **`mail.platform.realreal.cc`** is **Verified** (SPF+DKIM published).
- ☐ **[OWNER]** Provide the Resend API key value (same secret as Railway
  `RESEND_API_KEY`, or mint one with Send permission).
- ☐ **[AUTOMATABLE]** `PATCH https://api.supabase.com/v1/projects/ozwftlkgqmewtadypsfi/config/auth`:

  ```json
  {
    "smtp_host": "smtp.resend.com",
    "smtp_port": 465,
    "smtp_user": "resend",
    "smtp_pass": "<Resend API key>",
    "smtp_admin_email": "noreply@mail.platform.realreal.cc",
    "smtp_sender_name": "誠真生活 RealReal",
    "rate_limit_email_sent": 100,
    "site_url": "https://realreal.cc"
  }
  ```

- ☐ Smoke: register a real address on `realreal.cc` → confirmation email
  from `誠真生活 RealReal <noreply@mail.platform.realreal.cc>` → link works;
  test password reset.
- Interim only (security tradeoff — not recommended): `mailer_autoconfirm:true`
  skips confirmation but still needs SMTP for password reset and allows
  unverified-email account takeover.

## Fastest path to "sell today"

1. **[OWNER]** PChomePay keys → paste in admin → register PChomePay webhook
   (§1). Without this, selling is impossible.
2. In parallel: pre-stage Vercel/Railway domains + apply the two
   **[AUTOMATABLE]** PATCHes (Supabase `site_url`, Auth SMTP) once the Resend
   key is confirmed.
3. **[OWNER]** Flip Cloudflare DNS (§2) + verify SSL.
4. Smoke: one real order paid end-to-end + one real signup confirmed.

Everything not marked **[OWNER]** can be executed by the agent on request
once the corresponding secret/approval is supplied.
