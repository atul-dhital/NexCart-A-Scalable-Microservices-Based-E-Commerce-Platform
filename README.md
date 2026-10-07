# Scalable E-commerce Backend

Six Node.js 24 services with Express, MongoDB, JWT authentication, Stripe,
email/SMS notifications, Nginx, Docker Compose and Kubernetes/Swarm deployment.

## Run locally

Install Node.js 24 and Docker Engine/Desktop with Compose. Copy `.env.example`
to `.env`, then supply all credentials. Generate **independent** JWT and service
secrets with at least 32 characters:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npm ci
npm run build
docker compose up -d --wait
```

`npm run build` performs clean service dependency installs, all unit/integration
checks and six Docker image builds. It fails explicitly if Docker is unavailable.
Compose uses an isolated single-node MongoDB replica set for transactions and
exposes only Nginx on port 80. Local MongoDB is development-only; production
requires authenticated replica-set or Atlas database URIs.

For direct Node development, run each service from its directory with its own
`.env`: `MONGO_URI`, `JWT_SECRET`, `SERVICE_TOKEN`, optional `PORT`, and provider
credentials as applicable. Cart/order use `PRODUCT_SERVICE_URI`; payment uses
`ORDER_SERVICE_URI`. Then run `npm run dev` (Node's built-in watch mode).

## Authentication and roles

Register/login at `/api/users/register` and `/api/users/login`. Supply the token
as `Authorization: Bearer <token>`. Registration always creates a `customer`;
body-supplied roles are ignored. Tokens expire after one hour and require the
configured HS256 signature, issuer and audience.

- Product reads are public; catalog mutations require an administrator.
- Customers access only their own carts, orders and payments. Administrators can
  manage catalog and fulfillment, and access customer records.
- Internal inventory/order routes require `X-Service-Token`. Notifications
  require either administrator JWT or the service token.
- Fulfillment transitions are `Paid -> Shipped -> Delivered`; arbitrary payment
  status changes are rejected.

Provision an administrator through the operator CLI, never registration:

```sh
cd user-service
node scripts/set-role.js operator@example.com admin
```

The CLI requires that service's database environment. Sign in again for the new
role. Existing tokens retain their claims until their one-hour expiry.

## Checkout and recovery

Create orders with `POST /api/orders/:userId`, an `items` array of MongoDB product
IDs and positive integer quantities, and an `Idempotency-Key` header containing
8-128 letters, numbers, underscores or hyphens. Reuse the same key and items when
retrying. Client `totalAmount` is ignored. Inventory captures product prices in
NPR minor units and reserves every item in one MongoDB transaction.

Order states are durable: `Reserving -> Pending -> PaymentPending -> Completing
-> Paid`. Recovery retries incomplete steps every five seconds. Temporary
reservation/release failures can return HTTP 202; poll the order endpoint.
Compensation uses retained reservation tombstones so delayed retries cannot
consume stock after cancellation. Catalog deletion preserves inventory records
needed by compensation.

Unpaid orders expire after 15 minutes. A customer can cancel a `Pending` order
with `POST /api/orders/:userId/:orderId/cancel`. Once payment starts, use the
payment cancellation endpoint instead; inventory is released only after Stripe
confirms cancellation. Pending payments are cancelled after 30 minutes when the
provider allows it. Succeeded payments are never automatically cancelled.

Create a payment with `POST /api/payments/:orderId`, a separate `Idempotency-Key`
and `{ "paymentMethodId": "pm_..." }`. The backend verifies ownership and obtains
amount/currency from the reserved order. Client `amount` is ignored. The response
includes `payment` and `clientSecret`; confirm **that existing intent** using
Stripe.js and complete any required customer authentication. Retrying creation
with the original key/method returns the same intent. It never creates a second
payment for the order.

Configure Stripe's webhook at `/api/payments/webhook` for payment intent events.
Set the matching `STRIPE_WEBHOOK_SECRET`; signature validation uses raw bytes.
Webhook events are persisted, deduplicated and reconciled against Stripe's
current intent. A recovery worker also reconciles intents when webhooks are
missed. Payment state and inventory commit are retried across service outages.

Cancel an uncompleted payment with `POST /api/payments/:paymentId/cancel`.
Refunds of completed payments remain a separate operator business operation.
If an intent creation result remains ambiguous beyond 23 hours, the backend
marks it `Review` and stops creating intents rather than risk duplicate charges
after Stripe's request-key retention expires. Locate the original intent by
`metadata.paymentId` in Stripe and run:

```sh
cd payment-service
node scripts/reconcile.js <paymentId> <stripeIntentId>
```

The CLI verifies metadata, amount and currency before applying provider state.
Monitor `Reserving`, `Releasing`, `Completing`, `Review`, and unprocessed webhook
records. Recovery requires the affected database/services/provider to return.

Cart writes use a unique user index and optimistic version checks with bounded
retries; exhausted contention returns 409 for the caller to retry.

## Tests and dependency audit

```sh
npm ci
npm test
npm run audit
```

Install service dependencies with `npm ci` inside each service, or use
`npm run build` to perform all clean installs. Unit tests run with Jest;
integration tests use Node's native runner and a temporary MongoDB replica set,
real HTTP routes, and mocked Stripe transport with real signature verification.
The first integration run downloads MongoDB. Database processes are stopped and
test data removed afterwards. Audit covers production and development packages.

## Deployment

CI tests and builds all six root-context Dockerfiles before publication. Images
are published under `DOCKER_USERNAME/<service>:<commit SHA>` only after the Build
and Test workflow succeeds. Set GitHub `DOCKER_USERNAME` and `DOCKER_PASSWORD`.

Deploy using one manual workflow and the published 40-character commit SHA:

- **Kubernetes:** configure production environment secrets `KUBE_CONFIG_BASE64`,
  `APP_ENV` (the complete environment file), `DOCKER_USERNAME`, and
  `DOCKER_PASSWORD`. The deploy script applies runtime/registry Secrets, internal
  service URLs, health probes, resource limits, immutable images and an Nginx
  gateway, then verifies rollout. Kubeconfig must grant access to the target
  namespace. Supply authenticated replica-set/Atlas MongoDB URIs in `APP_ENV`.
- **Swarm:** register a trusted Linux self-hosted GitHub runner on an actual Swarm
  manager with label `ecommerce-swarm-manager`. Configure `APP_ENV` and registry
  credentials in the production environment. The workflow validates manager
  state, deploys `docker-stack.yml`, and checks replicas and image tags. Database
  services are externally managed; local Compose's MongoDB is not used.

Secrets never appear in committed manifests. Kubernetes injects only each
service's required keys. The gateway is ClusterIP; configure your ingress/TLS
for external production access. For a local cluster check:

```sh
kubectl -n ecommerce port-forward service/ecommerce-gateway 8080:80
```

For a manual authenticated Kubernetes deployment, set `IMAGE_PREFIX`,
`IMAGE_TAG`, optional `DEPLOY_NAMESPACE`, and your `KUBECONFIG`, then run
`node scripts/deploy-k8s.js`. Actual deployment needs working infrastructure and
credentials; repository configuration does not provision an account or cluster.

Before upgrading an existing database, back it up and check duplicate carts or
payments before unique-index creation. Reconcile historical payment duplicates
with Stripe rather than deleting financial records automatically. Existing
orders without reservation/price snapshots cannot enter the new payment flow;
reconcile them separately. Existing users without roles default to customer on
login. Old tokens must be replaced by signing in again.

See [WORKSPACE_SCAN.md](WORKSPACE_SCAN.md) for implementation and verification.

## Local storefront demo

Run `npm run demo` after installing the root and service dependencies. Open
http://127.0.0.1:8081 for the responsive NexCart storefront, shopping bag,
and multi-product checkout. The launcher starts all six services against an
isolated temporary MongoDB replica set. The first run may download MongoDB.

Payments, email, and SMS are simulated. No real charge or delivery occurs.
Demo data disappears when stopped with Ctrl+C. The demo binds only to loopback;
use the production deployment configuration for deployed environments.

The storefront lives in `demo/index.html` and is read on every page request,
so HTML/CSS changes appear after refreshing.
