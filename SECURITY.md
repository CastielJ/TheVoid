# Security Policy

Void handles real user accounts, session credentials, and organization data.
We take security reports seriously and will respond promptly.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately using one of these channels:

1. **[GitHub Private Vulnerability Reporting](../../security/advisories/new)**
   (preferred) — go to the **Security** tab of this repository → **Advisories**
   → **Report a vulnerability**. This creates a private discussion visible
   only to maintainers.
2. If that's unavailable to you, open a regular issue with the title
   `Security: please contact me privately` and no other details — a
   maintainer will follow up to arrange a private channel.

Please include as much of the following as you can:

- A clear description of the vulnerability and its potential impact.
- Step-by-step reproduction instructions (a minimal example is ideal).
- The affected component (e.g. auth/session handling, a specific tRPC
  procedure, canvas realtime sync, the authorization/capability layer).
- Any suggested remediation, if you have one.

## What to Expect

- **Acknowledgment** within 3 business days.
- We'll work with you to understand and validate the issue, and keep you
  updated as a fix is developed.
- Once a fix is released, we'll credit you in the advisory (unless you'd
  prefer to remain anonymous).
- Please give us a reasonable window to ship a fix before any public
  disclosure — coordinated disclosure protects users in the meantime.

## Scope

In scope:

- Authentication and session handling (`packages/server/src/domains/auth`)
- Authorization / capability checks (`packages/server/src/authorization`)
- Cross-tenant data isolation (Organization → Void → Group/Task scoping)
- The realtime WebSocket layer
- Injection, XSS, CSRF, SSRF, and similar classes of issue anywhere in the
  stack
- Dependency vulnerabilities with a credible exploit path in this project's
  actual usage

Out of scope:

- Findings that require physical access to a user's device
- Social engineering against maintainers or users
- Denial-of-service via sheer traffic volume (rate-limiting/infra concern,
  not an application vulnerability) — but a logic bug that lets a single
  request cause disproportionate load **is** in scope
- Issues only reproducible on an out-of-date fork or an unsupported/modified
  deployment

## Supported Versions

Void does not yet have tagged releases — `main` is the actively maintained
branch and the only one receiving security fixes. Once versioned releases
begin, this section will list which lines still receive patches.

## Security-Relevant Design Notes

For context when evaluating a report, a few deliberate design decisions are
documented in [`docs/decisions.md`](docs/decisions.md):

- Sessions are opaque, server-side, hashed-at-rest tokens — never JWTs.
- Void access is **never** inferred from Organization role alone (an Org
  Owner/Admin does not automatically get access to every Void) — see "C1"
  in `docs/project-context.md`.
- Every mutation resolves its parent resource IDs (Organization/Void/Team)
  server-side from the target resource, never trusting a client-supplied
  parent ID directly.

Understanding these invariants helps explain why certain things work the way
they do, and helps you spot a real violation of them.
