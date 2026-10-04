# web-console-next

Next.js 15 + opennextjs/cloudflare delivery of the Orun QA web console (per-environment, Workers + Static Assets)

The orun-qa console UI — Next.js compiled to a Cloudflare Worker with
Static Assets, configured against the API edge. Public at
`https://orun-qa-web-console-next-{stage,prod}.rahulvarghesepullely.workers.dev`.

## Depends on

- **api-edge** — Cloudflare Worker for the API edge Runtime
