# Device-Bound Anonymous Authentication

An authentication system for anonymous platforms: users get an account with **zero personal information** — no email, no phone number, no name — while a device-binding mechanism keeps a single device from spinning up unlimited accounts.

It was built as the auth backend for my own app, and is shared here as a standalone, reusable system.

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

That second point is the core of the design: **Admin SDK bypasses Firestore security rules.** If audit logs lived in the same project as user data, a full compromise of the Cloud Functions codebase (stolen credentials, leaked `.env`, whatever) would hand an attacker Admin SDK access — meaning they could read every log entry, including the IP address tied to each event. IP address is the one field in this whole system that could deanonymize a user by linking a device to a real network identity, so it's the one thing that must never be readable under any compromise scenario. Writing logs through the client SDK instead means the write path is bound by ordinary Firestore rules (`firestore-logs-project.rules`): `allow read: if false`, no exceptions — no code path in this system, compromised or not, has a way around it. Deletion is blocked too, so an attacker can't quietly erase the trail either, but that's secondary; the main guarantee is that the IP simply never comes back out. The application can write logs, but no client, user, or compromised process can read them back — they're only viewable through a separate, restricted dashboard.

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

## Performance tuning (optional)

The defaults in this repo favor correctness and security margin over raw speed — that's a deliberate choice, not an oversight, so read the trade-off before changing anything. If signup/login latency matters more for your use case, here's what's safe to tune and what to be careful with:

**Argon2id parameters.** The shipped config uses the library's stronger defaults. OWASP's published *minimum* acceptable interactive-login parameters (`memoryCost: 19456` / 19 MiB, `timeCost: 2`, `parallelism: 1`) will noticeably cut hashing time at the cost of some brute-force resistance margin. This is a legitimate, citable trade-off — just make it deliberately:

```js
await argon2.hash(password, {
  type: argon2.argon2id,   // node-argon2 already defaults to argon2id; stating it keeps the choice explicit
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});
```

No migration step needed either way — Argon2's hash string embeds its own parameters, so `argon2.verify()` keeps working on hashes generated under any prior settings.

**Cloud Function memory.** Firebase (2nd-gen) allocates CPU proportional to memory. Bumping from the default to 512MB roughly doubles available CPU, which directly speeds up Argon2's CPU-bound hashing. Total compute cost (GB-seconds) is close to a wash, since the function also finishes faster.

**Run the post-auth writes concurrently, not sequentially — but keep them awaited.** `last_login` and the audit-log write don't depend on each other, so running them together saves a round-trip:

```js
await Promise.all([
  userDoc.ref.update({ last_login: admin.firestore.FieldValue.serverTimestamp() }),
  logLogin(username, userData.user_id, userData.platform, context)
]);
```

Do **not** turn this into fire-and-forget (returning the response before this resolves). Cloud Functions can freeze the execution environment immediately after a response is sent, which can silently kill an in-flight write before it lands — for most apps that's a minor annoyance, but for this system specifically, the isolated audit log *is* the mechanism behind the "protected even under full compromise" guarantee. A log that sometimes silently fails to write undermines that claim without any visible error. Concurrent-but-awaited gets the latency win without that risk.

**Function region.** Firestore's location is set via `firebase.json` (`asia-south1` in this repo), but that does **not** automatically pin where the Cloud Functions themselves execute — functions can end up deployed to a different default region, making every Firestore round-trip (signup alone does two reads, a write to the main project, and a write to the separate logs project) cross regions on every call. Check your deployed functions' actual region and pin it to match your Firestore location if they don't already line up; this is often a larger, and easily missed, contributor to latency than the Argon2 parameters above.

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

No license has been added yet, so by default **all rights are reserved** by the author. The code is public so it can be read, studied and discussed, but it is not yet licensed for reuse, copying or redistribution. A license may be added later; if you'd like to use this work in the meantime, please get in touch with the author.
