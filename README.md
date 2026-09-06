# Device-Bound Anonymous Authentication

An authentication system for anonymous platforms: users get an account with **zero personal information** — no email, no phone number, no name — while a device-binding mechanism keeps a single device from spinning up unlimited accounts.

It was built as the auth backend for my own app, [and is now shared here as a standalone, reusable system].

## The problem this solves

Anonymous platforms usually have to pick one of two bad options:

- **Verify identity** (email/phone) — this stops fake accounts, but it also ends anonymity before it starts.
- **Verify nothing** — this keeps anonymity, but opens the door to unlimited bot/spam accounts.

This system takes a third path: **the device itself is the identity.** One account per device, enforced with a cryptographic device fingerprint, with no personal data collected at any point.

## Design principle

> Protect the user's identity even if the entire system is compromised.

Every security decision in this repo traces back to that one sentence — including the choice to keep audit logs in a completely separate Firebase project (more on that below), since logs are the one thing that could otherwise link a device to its activity.

## Architecture

```
Mobile App (Expo/React Native)
        |  HTTPS
        v
Cloud Functions (Node.js)
   |                    |
   v                    v
Main Firestore     Logs Firestore
(users, Admin SDK) (separate project,
                    client SDK, write-only)
```

Two **separate Firebase projects**, on purpose:

- **Main project** — stores user records (device hash, password hash, recovery code hash). Cloud Functions use the Admin SDK here, because they need it to read/write user documents.
- **Logs project** — stores security audit logs *only*, in a project of its own, written to with the regular Firebase **client SDK**, not the Admin SDK.

That second point is the core of the design: **Admin SDK bypasses Firestore security rules.** If audit logs lived in the same project as user data, a full compromise of the Cloud Functions codebase (stolen credentials, leaked `.env`, whatever) would hand an attacker Admin SDK access — meaning they could read every log entry, including the IP address tied to each event. IP address is the one field in this whole system that could deanonymize a user by linking a device to a real network identity, so it's the one thing that must never be readable under any compromise scenario. Writing logs through the client SDK instead means the write path is bound by ordinary Firestore rules (`firestore-logs-project.rules`): `allow read: if false`, no exceptions — no code path in this system, compromised or not, has a way around it. Deletion is blocked too, so an attacker can't quietly erase the trail either, but that's secondary; the main guarantee is that the IP simply never comes back out.

### Hardening the logs rules for your fork

The shipped `firestore-logs-project.rules` isn't a loose, generic template — it's locked to the **exact field set and types** that this repo's `logsProjectLogger.js` sends (`hasOnly`, not just `hasAll`, a type check on every individual field, and `timestamp == request.time` so entries can't be backdated). That precision is the point: a rule that only checks a few required fields exist still leaves room for extra fields to be smuggled into a write.

If you fork this and change what the logger sends — add a field, rename one, add a new `event_type` — **update the rule to match exactly**, don't just widen it to "anything goes." The security property this system relies on (an attacker can write a log, but can never read one back, no matter what's in it) holds regardless of the field shape — but a rule that's looser than what your logger actually sends is doing less than it could.

## How signup works

1. **Collect** — Android ID (or a securely-generated UUID on iOS, see below) + device model + brand.
2. **Hash (client)** — SHA-512 of the combined identifiers. One-way, so the raw identifier never has to be reconstructed.
3. **Hash again (server)** — HMAC-SHA512 keyed with a server-side secret (`DEVICE_SECRET`). This is a second, independent layer: even if the client-side hash were somehow intercepted, it can't be used to forge a valid stored hash without the server secret.
4. **Check & store** — if the final hash already exists, signup is blocked ("one account per device"). Otherwise it's stored and the account is created.

## Password security — and why it changed

Passwords are hashed with **Argon2id**, server-side only. That wasn't the first version.

The original design ran passwords through SHA-512. That's a mistake worth naming directly: SHA-512 is *fast* — a GPU can compute billions of SHA-512 hashes per second — which is exactly wrong for a password, because human-chosen passwords are low-entropy and a fast hash makes brute-forcing a leaked hash trivial. Argon2id is deliberately slow and memory-hard, which makes GPU/ASIC brute-forcing impractical. It also handles its own random salting internally, so there's no separate salt to manage.

Passwords are sent to the server as plaintext over HTTPS, not pre-hashed on the client. Client-side password hashing is a common but ultimately pointless pattern here: HTTPS already encrypts the password in transit, and if an attacker could intercept the client-side hash, that hash would simply become the new "password" — hashing it again server-side is required either way. Client-side hashing adds complexity without adding real security.

## Device identity: SHA-512, not Argon2

Device fingerprints use SHA-512 + HMAC, not Argon2. This isn't an inconsistency — it's deliberate. Argon2's slowness defends against brute-forcing *low-entropy, human-chosen* secrets. A device identifier (an Android ID, or a 256-bit random UUID on iOS) is already high-entropy and not something anyone is brute-forcing offline — the threat model is different, so the right primitive is different.

## Recovery codes

A 12-character code (`XXXX-XXXX-XXXX`) is generated at signup and shown to the user exactly once. It's generated with `crypto.randomInt()`, not `Math.random()` — `Math.random()`'s underlying generator (xorshift128+ in V8) is not cryptographically secure and can be predicted after observing enough outputs, which matters for anything that functions as a password-equivalent secret. The code is hashed with SHA-512 before storage, and recovery-code comparisons use `crypto.timingSafeEqual()` to avoid leaking information through response-time differences. Every successful recovery issues a brand-new code and invalidates the old one.

## iOS device identity

Apple doesn't expose a stable, app-accessible hardware identifier (by design, for privacy). This system generates a 256-bit cryptographically secure random value with `expo-crypto`'s `getRandomBytesAsync()`, stores it in the iOS Keychain (`expo-secure-store`), and reuses it on every subsequent launch — including after app reinstalls, since Keychain data outlives the app itself on iOS. Collision probability at that entropy is astronomically low regardless of how many users the app has.

## Known limitations

This is deliberately documented rather than hidden:

- **Rooted Android devices** can spoof their Android ID, and Android ID **changes on factory reset** — both can bypass the one-device-per-account check. A stricter alternative is Google's **Play Integrity API**, which adds hardware-backed attestation at the cost of extra complexity and platform dependency. This repo doesn't implement it; the trade-off accepted here is that bypassing requires deliberate, technical effort (rooting + spoofing), which is a small minority case compared to the casual multi-accounting this system already prevents for everyone else.
- **Device loss** is handled by the recovery-code flow, and login itself is **not** device-bound (only signup is) — a user can log into their existing account from any device once they know their password.
- **No rate limiting** is implemented at the application layer in this repo; add Firebase App Check and/or Cloud Functions rate limiting before production use.

## Setup

### 1. Create two Firebase projects
One for user data ("main"), one for audit logs ("logs"). They must be genuinely separate projects, not two databases in one project — the isolation is the point.

### 2. Apply Firestore rules
- Main project: `firestore.rules`
- Logs project: `firestore-logs-project.rules`

### 3. Configure the server
```bash
cd functions
npm install
cp .env.example .env
# generate a secret and paste it into .env:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Fill in your Firebase config
- `device-auth-app/firebaseConfig.js` — your **main** project's web config
- `functions/logsProjectLogger.js` — your **logs** project's web config

Both are public client identifiers (the same values embedded in any compiled app), not secrets — but they should point to your own projects, not a placeholder.

### 5. Deploy and run
```bash
firebase deploy --only functions

cd ../device-auth-app
npm install
npx expo start
```

## Tech stack

Firebase Cloud Functions (Node.js) · Firestore · Argon2 · React Native / Expo

## A note on how this was built

I designed the architecture and made every security decision in this system — the device-binding approach, the Argon2 migration, the isolated-logs model, and the trade-offs documented above. AI tools were used to help write the implementation code against that design. Further technical detail is in [`system-documentation.md`](./system-documentation.md).

## License

**Polyform Noncommercial 1.0.0** — see [`LICENSE`](./LICENSE).

Free to use, study, modify, and share for personal, academic, and other noncommercial purposes. **Commercial use requires a separate license from the author** — reach out if that's what you need. This is a deliberate choice: the device-binding and isolated-logging design here is the core mechanism behind a commercial product of mine, so this repo is shared to be read, learned from, and built on for noncommercial work — not folded into a competing paid product without permission.
