# Workspace scan - 2026-10-06

## Resolved code and configuration gaps

| Original gap | Implementation |
| --- | --- |
| Missing JWT verification and ownership/roles | Shared HS256 verification with issuer/audience/expiry checks; customer ownership checks, admin catalog/fulfillment guards, separate internal service authentication, customer-only registration and operator admin provisioning. |
| Partial stock deductions and missing recovery | Transactional multi-product reservations on a replica set; durable order saga, stable order idempotency keys, compensation tombstones, restart workers, soft deletion and safe checkout expiry. |
| Client-controlled payments and missing reconciliation | Server-side authenticated order lookup, immutable minor-unit price snapshots, one payment/intent per order, persistent creation keys, signed raw-body webhooks, event deduplication, provider-truth reconciliation, retry workers and verified payment cancellation. |
| Concurrent cart updates lost | Unique user index plus optimistic version checks and bounded conflict/duplicate-insert retries. |
| Deployment configuration and fake infrastructure access | Required runtime Secret references, internal service ConfigMap, registry auth, probes/resource limits, gateway, immutable images, real kubeconfig authentication and rollout checks. Swarm deployment targets a labeled self-hosted manager and checks rollout instead of running on an ephemeral runner. |
| Node 18 and unaudited dependencies | Node 24 containers/CI/engine contract, updated pinned dependencies and lockfiles, compatible security fixes, Node watch mode replacing vulnerable Nodemon, and production/development audits. |

Previous startup/env, routing, notification failure and input-validation fixes
remain incorporated. Docker builds use the repository root to include shared
code, omit development dependencies, run application services as non-root and
include readiness health checks.

## Verification

- 58 tests: 31 service tests plus 27 system/deployment checks.
- Real temporary MongoDB replica-set transactions and real HTTP service calls
  exercised rollback, concurrent reservations, cart races, ownership/admin
  restrictions, idempotent order/payment retries, lost-response recovery,
  signed webhook deduplication/retry, cancellation and expiry compensation.
- Stripe transport is mocked; signature generation/verification uses the actual
  SDK. No live charges, SMS or email were sent.
- Npm audits report zero vulnerabilities across production and development
  dependencies in the root and all six services after compatible lockfile fixes.
- Clean service dependency rebuild and tests completed through `npm run build`.
- Deployment renderer/YAML checks passed. No real cluster rollout was performed.

## Environment blockers

- Docker Engine/Desktop is not installed here. `npm run build` reaches the image
  phase and fails explicitly; six image builds remain unexecuted. Install/start
  Docker, then rerun `npm run build` and `docker compose up -d --wait`.
- Real provider credentials, database URIs and deployment infrastructure must be
  supplied by the operator. GitHub workflows now use those credentials, but no
  kubeconfig, Swarm manager or production account was available in this session.

## Operational contract

- Public registration creates customers. Provision administrators with the
  user-service CLI; existing tokens retain claims until their one-hour expiry.
- Orders reserve integer minor-unit NPR snapshots. Stripe.js confirms the single
  returned intent; client amounts and totals cannot change the charge.
- Unpaid orders expire in 15 minutes; provider-pending payments are cancelled
  after 30 minutes when Stripe allows it. Inventory remains held until provider
  cancellation is confirmed; completed payments require a separate refund flow.
- Reservation tombstones are intentionally retained. Do not TTL-delete them or
  reuse order/payment idempotency keys while old requests may still arrive.
- Ambiguous intent creation older than 23 hours stops in Review to avoid a second
  charge after provider key expiry. The reconciliation CLI verifies the original
  Stripe intent before applying its state. Recovery needs databases/services to
  become available and requires monitoring of pending/review records.
- Existing databases need backup and duplicate-record checks before unique-index
  rollout. Historical orders without snapshots and duplicate payments require
  operator reconciliation, not automatic deletion/repricing.

See [README.md](README.md) for setup, API transitions, reconciliation commands,
required GitHub secrets, real deployment targets and rebuild instructions.
