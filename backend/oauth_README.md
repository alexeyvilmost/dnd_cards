# Google and Yandex OAuth login (local implementation)

The same button signs in a known provider identity or creates a new account.
No provider application or credentials were created. No production database,
deployment, commit, or push is part of this change.

## Configuration and migration coordination

Migration **263** is defined by `migrations/oauth_263.go`, version
`263_oauth_identities`, registered in `GetAllMigrations()` and applied to the
local database on 2026-09-24 after a backup. The registry entry is:

```go
OAuth263Migration(),
```

Do not renumber other pending migrations. The migration adds three tables and
makes `users.email` nullable; existing addresses, password hashes, and unique
email constraints remain intact. It is transactional and safe to rerun.
`Down` deliberately preserves identities and accounts instead of deleting login
data. It is not a destructive rollback. Integration tests apply it directly to
a fresh, isolated schema; the main local database has also been migrated.

Backend environment variables (credentials must stay on the server):

| Variable | Required value |
| --- | --- |
| `OAUTH_FRONTEND_ORIGIN` | Exact frontend origin, currently `http://localhost:3001`; no query, fragment, or path |
| `OAUTH_GOOGLE_CLIENT_ID` | Google web application's client ID |
| `OAUTH_GOOGLE_CLIENT_SECRET` | Google web application's client secret |
| `OAUTH_GOOGLE_REDIRECT_URI` | Exact registered backend callback, e.g. `http://localhost:8080/api/auth/oauth/google/callback` |
| `OAUTH_YANDEX_CLIENT_ID` | Yandex application's client ID |
| `OAUTH_YANDEX_CLIENT_SECRET` | Yandex application's client secret |
| `OAUTH_YANDEX_REDIRECT_URI` | Exact registered backend callback, e.g. `http://localhost:8080/api/auth/oauth/yandex/callback` |
| `JWT_SECRET` | Existing application JWT secret, at least 32 bytes |

HTTP is accepted only on `localhost`, `127.0.0.1`, or `::1`; other origins and
callbacks require HTTPS. Use the same frontend hostname before and after the
provider redirect: `localhost` and `127.0.0.1` have different sessionStorage.
Configure the existing `CORS_ALLOWED_ORIGINS` allowlist for the exact frontend origin when
frontend and API origins differ. `VITE_API_URL` remains the existing frontend
API setting; no provider secret belongs in a `VITE_*` variable. Restart the
backend after changing OAuth configuration.

Google needs a **Web application** OAuth client and the exact redirect URI above.
The requested scopes are `openid profile`. Configure consent-screen audience
and test users as appropriate in the provider console.
Yandex needs a web application with that provider's exact redirect URI and the
`login:info` permission (user name/profile). Both client ID and secret are
required by this implementation, in addition to PKCE. Enabling a provider in
its console requires a separate authorized setup step.

Only variable **names** in the repository `.env` were inspected. OAuth variables
are absent there; Yandex Cloud storage variables are not Yandex ID credentials.
The existing local development configuration was inspected for key names and a
loopback database check; its database value was passed privately to local tests.
Credentials and tokens were not printed.

`GET /api/auth/oauth/providers` reports both providers with `enabled` and a
non-sensitive reason: `unconfigured` for absent/invalid OAuth settings, or
`unavailable` for missing schema/JWT configuration or database failure. Buttons
remain disabled until their provider and backend prerequisites are ready. The
password form remains available. Availability is checked again when starting
and completing a login.

## Security and behavior

- Authorization code flow with PKCE **S256** for both providers. Token exchange
  and UserInfo requests happen only on the backend at fixed provider endpoints.
  Requests have a timeout, bounded JSON responses, and reject HTTP redirects.
  Provider access/refresh/ID tokens are neither persisted nor returned. The
  implementation authenticates through the code exchange and HTTPS UserInfo;
  it does not parse or trust an unsigned ID token. Yandex `client_id` is checked.
- 256-bit random state, a separate random HttpOnly/SameSite=Lax cookie, a
  provider binding, a ten-minute lifetime, and an atomic database deletion guard
  the callback. HTTPS uses host-only `__Host-` cookies with `Secure`. A callback
  with a wrong state, browser cookie, or provider never reaches token exchange.
- Flow state is stored in PostgreSQL, so callback handling survives backend
  restarts and works across replicas. Expired flow/handoff rows are removed on
  subsequent starts. Multiple tabs have separate flow cookies.
- A successful callback redirects to the fixed frontend `/login` with a random
  one-minute handoff code in the fragment. This is not a JWT. Redemption also
  needs the matching verifier saved in that initiating tab's sessionStorage.
  The frontend removes the fragment immediately and makes one POST exchange,
  including under React StrictMode. Handoff redemption and JWT creation are
  transactional; concurrent redemptions succeed only once. Wrong proofs do not
  consume a legitimate pending code.
- Neither Host/Forwarded headers nor browser input determines the provider
  callback or frontend origin. Return destinations accept only safe internal
  paths, including their query and invite fragment. External/network paths,
  encoded slash/backslash bypasses, dot segments, controls, and auth loops are
  rejected. The default for password and OAuth sign-in/registration is **`/`**.
- Accounts are identified by the database-unique `(provider, subject)` pair.
  Concurrent first logins are serialized and account/identity/handoff creation
  is atomic. Provider names or email addresses never select an existing user.
  Email is not requested. OAuth-only accounts have a NULL email and an invalid
  password hash that disables password login. Existing password accounts and
  the other provider create separate accounts; account linking is not exposed.
  Soft-deleted accounts cannot sign in or be recreated through that identity.
- OAuth routes use the existing auth rate limiter, no-store responses, and
  no-referrer headers. Provider errors are reduced to fixed UI messages.
  Sensitive OAuth SQL parameters are excluded from application SQL logs, and
  OAuth paths are excluded from Gin's global query-string access logger.

## Local verification

Backend tests use an explicitly supplied **loopback-only** `OAUTH_TEST_DSN`.
They create a unique `oauth_test_*` PostgreSQL schema, apply migration 263 twice,
and drop only that schema afterwards. They never run global migrations.

```text
cd backend
go test . -run '^TestOAuth' -count=1 -v

cd frontend
node node_modules/vitest/vitest.mjs run src/auth src/contexts/AuthContext.test.tsx src/pages/Login.production.test.ts src/authReturnPath.test.ts
```

Covered: both server-side provider adapters; unconfigured state; fixed redirect
and PKCE values; malformed/oversized/upstream error responses; HTTP redirect
refusal; state/cookie/provider mismatch; cancellation; TTL; replay; wrong
frontend proof; restart between start and callback; existing-account retention;
no email linking; concurrent first login and redemption; deleted accounts;
frontend disabled/error states; StrictMode completion; JWT session persistence;
and preserved explicit return paths.

Backend unit/integration tests and frontend auth tests pass locally. Auth
entrypoints also pass an isolated TypeScript compilation. The repository-wide
`tsc -b` reports unrelated existing test metadata type errors in `rules-core`
(`TaskMeta.basicPrimitive` / `semanticProtocol`); those files were not changed.

## Remaining operational limits

### Local credentials check — 2026-09-24

The local launcher now reads the explicit OAuth settings from the root `.env`
(without importing production DB configuration), defaults the frontend origin
to `http://localhost:3001`, and requires loopback OAuth URLs. After restarting
the local API, both providers report `enabled: true`.

Live browser checks reached both providers, but both rejected the configured
local callback: Google returned `redirect_uri_mismatch`, and Yandex reported
that `redirect_uri` does not match the registered Callback URL. The provider
consoles must allow these exact URLs before live authentication can complete:

- Google: `http://localhost:8080/api/auth/oauth/google/callback`
- Yandex: `http://localhost:8080/api/auth/oauth/yandex/callback`

No provider-console configuration, production settings, account consent, or
production deployment was changed during this check. Real token exchange and
end-to-end login remain unverified until the callback mismatch is resolved.

Complete live Google/Yandex consent and callbacks require matching provider
console configuration in addition to credentials. Buttons are deliberately
disabled when local configuration or migration prerequisites are missing, but
their enabled state cannot validate the remote console settings or secrets.
Local integration tests use real PostgreSQL and HTTP provider test servers.

The final application JWT uses the existing 24-hour/localStorage session model;
this change does not convert every API consumer to HttpOnly application-session
cookies. If a callback or handoff response is lost after its single use, start
login again. Account linking, adding a password to an OAuth account, email
collection, and provider token refresh are outside this implementation.

Any reverse proxy's access logger must also omit OAuth callback query strings
and avoid capturing request bodies. Upstream configuration was not changed by
this local task. The application suppresses OAuth query-string access logs;
callback query strings can include a short-lived authorization code and state,
but never provider access tokens or application JWTs.

## Official protocol references checked

- [Google OpenID Connect: UserInfo, subject identity, and discovery PKCE support](https://developers.google.com/identity/openid-connect/openid-connect)
- [Google OAuth code verifier / S256 explanation](https://developers.google.com/identity/protocols/oauth2/native-app#step1-code-verifier)
- [Yandex authorization-code flow and PKCE](https://yandex.ru/dev/id/doc/ru/codes/code-url)
- [Yandex UserInfo and client_id](https://yandex.ru/dev/id/doc/ru/user-information)
