# System Documentation — Device-Bound Anonymous Authentication

Full technical reference: architecture, data model, API contracts, and the reasoning behind every security decision. The [README](./README.md) covers the summary; this document covers the detail — intended to be enough for another engineer (or an AI assistant) to reimplement the same system from scratch.

---

## 1. Core Principle

Protect the user's identity even if the entire system — server, credentials, source code — is compromised. Every decision below is justified against this single standard.

## 2. Architecture

```
Client (React Native / Expo, iOS + Android)
        |  HTTPS
        v
Cloud Functions (Node.js, Firebase Functions v2)
   |                              |
   v                              v
Main Firestore Project      Logs Firestore Project
- users collection          - logs/{username}/access_logs
- Admin SDK (server only)   - client SDK, write-only rules
```

**Two Firebase projects, not one**, is the load-bearing decision in this system:

- The **main project** needs Admin SDK on the server, because Cloud Functions must query and update user documents (check for existing device hash, verify username uniqueness, update `last_login`, etc.).
- The **logs project** deliberately does **not** use Admin SDK. Admin SDK bypasses Firestore security rules entirely — that's necessary for the main project's normal operation, but it's exactly the property that would make audit logs unsafe. If logs lived in the main project, a full compromise of the server (stolen `.env`, leaked service account credentials, compromised Cloud Functions source) would hand an attacker Admin SDK access to the logs too, meaning they could read every log entry (potentially linking device hashes / IPs to activity, undermining anonymity) and delete the log entirely (destroying the incident's own evidence trail).
- By writing logs through the regular Firebase **client SDK** into a **separate project**, the write path is bound by ordinary Firestore security rules — the same rules that would apply to any external, untrusted caller. Those rules (`firestore-logs-project.rules`) permit `create` only, with structural validation, and hard-deny `read`, `update`, `delete`. No code path in this system — compromised or not — has a way around that, because Admin SDK doesn't exist in this equation at all for the logs project.

## 3. Data Model

### `users/{docId}` (main project)

| Field | Type | Notes |
|---|---|---|
| `username` | string | Unique, chosen by user |
| `device_hash` | string | `HMAC-SHA512(SHA512(androidId+model+brand), DEVICE_SECRET)` |
| `password_hash` | string | Argon2id hash (includes its own salt) |
| `recovery_code_hash` | string | `SHA512(recoveryCode)` |
| `platform` | string | `"android"` \| `"ios"` |
| `user_id` | string | Display ID, format `#XXXXX` |
| `created_at` | timestamp | Server timestamp |
| `last_login` | timestamp \| null | Updated on each successful login |
| `last_password_reset` | timestamp | Set on recovery |

### `logs/{username}/access_logs/{autoId}` (logs project)

| Field | Type | Notes |
|---|---|---|
| `event_type` | string | One of the enum values enforced by Firestore rules |
| `username` | string | Must match the path segment (rule-enforced) |
| `user_id` | string \| null | |
| `platform` | string \| null | |
| `ip_address` | string | Extracted from `x-forwarded-for` / `x-real-ip` |
| `user_agent` | string | |
| `success` | boolean | Rule-enforced type |
| `error_message` | string \| null | |
| `timestamp` | server timestamp | |
| `metadata` | object | |

`event_type` enum (also enforced in Firestore rules, so a write with any other value is rejected outright): `signup_success`, `signup_failed`, `signup_blocked`, `login_success`, `login_failed`, `password_recovery_success`, `password_recovery_failed`.

## 4. Cryptographic Design

### 4.1 Passwords — Argon2id, server-side only

Passwords travel from client to server as **plaintext over HTTPS**. This is intentional, not an oversight: HTTPS already provides transport encryption, so client-side hashing adds no confidentiality. Worse, if a client-side hash were ever intercepted, that hash itself would function as a full password-equivalent credential — the interception risk isn't reduced, just relocated. The server hashes with `argon2.hash(password)` (Argon2id, the library default), which embeds its own random salt in the output string, so no separate salt management is needed. Verification uses `argon2.verify(storedHash, suppliedPassword)`.

**Why not SHA-512 for passwords** (this system's history): the original design used SHA-512. SHA-512 is a fast, general-purpose hash — GPUs compute billions of them per second. Passwords are low-entropy, human-chosen secrets, so a fast hash makes an offline brute-force attack against a leaked hash trivial for common/weak passwords. Argon2id is deliberately slow and memory-hard, which resists both GPU and ASIC acceleration. This is a documented example of the design being revised after recognizing the mismatch between a general-purpose hash and a password-specific threat model.

### 4.2 Device fingerprint — SHA-512 (client) + HMAC-SHA512 (server)

```js
// client (deviceFingerprint.js)
clientHash = SHA512(androidId + model + brand)

// server (crypto.js)
finalHash = HMAC-SHA512(key = DEVICE_SECRET, message = clientHash)
```

Two independent hashing steps, for two different reasons:

- The **client-side SHA-512** means the raw device identifier is never transmitted or stored — only its one-way hash leaves the device.
- The **server-side HMAC-SHA512** is keyed with a secret (`DEVICE_SECRET`) that never leaves the server. HMAC (not a plain concatenate-then-hash) is the correct construction for "hash this value with a secret key" — it's specifically designed to resist the length-extension and related-key issues that a naive `SHA512(clientHash + secret)` construction is more exposed to. Even if a client-side hash were somehow observed, deriving the corresponding stored value requires the server secret.

Device identifiers use SHA-512/HMAC rather than Argon2 deliberately: Argon2's slowness is a defense against brute-forcing *low-entropy* secrets. A device identifier — an Android ID, or (on iOS) a 256-bit CSPRNG-generated value — is already high-entropy. There's no meaningful offline brute-force threat to defend against here, so a fast, standard MAC construction is the right tool, and using Argon2 anyway would just add latency without a corresponding security gain.

`DEVICE_SECRET` fails loudly if missing:
```js
const DEVICE_SECRET = process.env.DEVICE_SECRET;
if (!DEVICE_SECRET) throw new Error('DEVICE_SECRET environment variable is required...');
```
A silent fallback to a hardcoded default (`|| 'some-default'`) would mean a misconfigured deployment degrades to *no real secret at all* while appearing to work normally — the failure needs to be loud and immediate instead.

### 4.3 Recovery codes

Format: `XXXX-XXXX-XXXX`, drawn from a 32-character alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` — visually-confusable characters like `0/O`, `1/I` excluded). Generated with `crypto.randomInt(charsetLength)` per character — **not** `Math.random()`. This distinction matters concretely: `Math.random()` in V8 is implemented with xorshift128+, a fast, non-cryptographic PRNG whose internal state can be reconstructed from a relatively small number of observed outputs, after which all future outputs become predictable. A recovery code is a password-equivalent secret (code + username = full account takeover with no other factor), so it needs a CSPRNG, which `crypto.randomInt()` is.

Stored as `SHA512(code.toUpperCase().trim())`. Verified with `crypto.timingSafeEqual()` (after converting both hex hashes to equal-length buffers) rather than `===`, to avoid a timing side-channel that could otherwise let an attacker infer how many leading bytes of a guess were correct from response-time variance.

Recovery codes are single-use: every successful recovery immediately issues a new code and overwrites the old hash, so a previously-used (or previously-intercepted) code cannot be replayed.

### 4.4 iOS device identity

Apple does not expose a stable, app-readable hardware identifier — that's a deliberate Apple privacy choice, not a gap in this implementation. This system generates a value with `expo-crypto`'s `getRandomBytesAsync(32)` (256 bits from the platform CSPRNG) on first launch, stores it via `expo-secure-store` (backed by iOS Keychain), and reuses the stored value on every subsequent launch. Keychain entries persist across app reinstalls on iOS (unlike, say, app-sandboxed file storage), so this value survives a reinstall the same way Android ID does. At 256 bits of entropy, collision probability across any realistic user base is negligible.

`Math.random()` is deliberately **not** used for this value, for the same reason it's excluded from recovery-code generation: an open-source codebase means the generation algorithm is public by definition, and per Kerckhoffs's principle, security must not depend on that algorithm being secret. A CSPRNG's output remains unpredictable even when the code that calls it is fully public; `Math.random()`'s does not.

## 5. API Contracts

### `signup`
**In:** `{ username, password, client_hash, platform }`
**Validates:** all fields present; `platform` is `"android"` or `"ios"`.
**Flow:** finalize device hash → check for existing device hash (block if found) → check for existing username (block if found) → `argon2.hash(password)` → generate + hash recovery code → write user document → log `signup_success`.
**Out (success):** `{ success, message, user_id, doc_id, recovery_code }` — `recovery_code` is plaintext, shown once, never stored.

### `login`
**In:** `{ username, password }`
**Flow:** look up by username → `argon2.verify` → update `last_login` → log `login_success`.
**Note:** login does **not** check `device_hash` — only signup does. A user can log into an existing account from any device; only *creating a new account* is device-bound. Device loss for an existing account is handled by ordinary login (if the device is new but the account already exists elsewhere, login still works) or by the recovery flow if the password itself is also lost.
**Error codes:** "user not found" and "wrong password" both return the **same** `unauthenticated` code with the **same** message ("Invalid username or password"). Using different codes for these two cases (e.g. `not-found` vs `unauthenticated`) would let a client distinguish "this username doesn't exist" from "this username exists but the password is wrong" purely by inspecting the error code, even with identical message text — enabling account enumeration. Keeping the code identical closes that channel.

### `recoverPassword`
**In:** `{ username, recovery_code, new_password }`
**Flow:** look up by username → hash provided code → `timingSafeCompare` against stored hash → `argon2.hash(new_password)` → generate + hash a **new** recovery code → update user document → log recovery event.
**Out (success):** `{ success, message, new_recovery_code, user_id }` — again, shown once.
**Error codes:** same enumeration-prevention treatment as `login` — "user not found" and "wrong recovery code" both return `unauthenticated`.

## 6. Firestore Security Rules

**Main project** — the `users` collection denies all client writes outright (`allow create, update, delete: if false`); only the Admin SDK, from Cloud Functions, can write. Reads are scoped to `request.auth.uid == userId`, which in practice means "no client reads," since this system doesn't use Firebase Auth sessions — all reads happen server-side inside Cloud Functions.

**Logs project** — writes are allowed only when the payload has the required keys, `event_type` is one of the enumerated values, `username` in the payload matches the document path, and `success` is a boolean. This structural validation exists because the logs project's config (like any Firebase web config) is not a secret — it's the same value embedded in the compiled app — so the write endpoint is technically reachable by anyone with that config. The validation doesn't need to fully stop a determined attacker from writing a *plausible-looking* fake log; it does stop trivial abuse and, combined with `allow read/update/delete: if false`, guarantees the one property that actually matters: **nothing can read or erase what's already there.**

## 7. Threat Model / Known Limitations

- **Rooted Android + Android ID spoofing**, and **Android ID resetting on factory reset**, can both defeat device-hash binding for a technically capable minority of users. A stricter option is Google's **Play Integrity API** (hardware-backed attestation), not implemented here — the accepted trade-off is that bypass requires deliberate technical effort, versus the casual mass multi-accounting this system already prevents for everyone else.
- **Login is not device-bound.** Only account *creation* checks the device hash. This is intentional (a lost/replaced device shouldn't lock a user out of an account they can still authenticate into by password), but worth stating explicitly since it means device-binding is an anti-abuse control on *signup volume*, not a per-session authentication factor.
- **No application-layer rate limiting** is included in this repo. Firebase App Check and/or per-IP rate limiting at the Cloud Functions layer are recommended additions before production use at scale.
- **IP addresses are logged** (for abuse investigation) but live only in the isolated, write-only logs project — this is the entire reason that isolation exists.

## 8. Why This Combination, Not a Claim of Novelty

Every individual technique in this system — Argon2 for passwords, HMAC for keyed hashing, write-only audit logs, device fingerprinting for one-account-per-device — is independently well-established and documented elsewhere. Nothing here claims to invent any of them. The design decision worth explaining is the *combination and reasoning*: specifically, isolating audit logs into a separate trust boundary (separate project + client SDK + rule-enforced write-only access) so that the logs survive a scenario where the main authentication server is fully compromised — which is a stronger guarantee than "logs are access-controlled," and is the direct consequence of taking the stated core principle seriously rather than as a slogan.
