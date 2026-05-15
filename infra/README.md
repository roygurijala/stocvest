# STOCVEST Terraform

**Last updated:** 2026-05-13 (doc pointer sync with [`docs/CONTEXT.md`](../docs/CONTEXT.md) §3 / §13; **API Gateway** documents **`GET /v1/admin/users/{user_id}/activity-errors`** in `apigateway_6e.tf`.)

This directory contains AWS infrastructure as code:

- VPC
- Public/private subnets, public and private route tables (private egress via NAT)
- NAT gateway (Elastic IP) in the first public subnet
- Security groups
- DynamoDB tables: `Users`, `BrokerConnections`, `Watchlists`, `Alerts` (TTL on `expiresAt`), `Orders`, `DayTradingSetups`, **`SignalHistory`**, **`TradeJournal`**, **`PDTState`**, **`AuditEvents`** (HTTP audit replay keys `pk` / `sk`) — on-demand billing; tags `project=stocvest`, `env=development`
- ElastiCache Redis 7.x single-node (`cache.t3.micro`) in private subnets, data-tier security group, subnet group + parameter group; primary endpoint in `terraform output` for `REDIS_URL`
- ECS cluster `stocvest-development` (Fargate-only) and task definition for **ibeam** (`docker.io/voyz/ibeam:latest`) exposing **4002** (paper IB Gateway API). Run **ECS service** or **RunTask** with `awsvpc` using **`private_subnet_ids`** + **`app_security_group_id`** and `assignPublicIp=DISABLED`. Logs: `/ecs/stocvest-development/tws`.
- **Lambda (6e):** one function per handler module (`health`, `market_data`, `signals`, **`signal_resolution`**, `brokers`, `portfolio`, `scanner`, `journal`, `pdt`, `authorizer`, `websocket`), Python **3.11**, VPC (**private subnets** + **app** SG), placeholder deployment zip until CI uploads real bundles; env includes **`REDIS_URL`**, **DynamoDB table names**, **`ECS_CLUSTER_ARN`**, **`STOCVEST_LAMBDA_MODULE`** (per-function, matches handler group); **CloudWatch** `/aws/lambda/stocvest-development-api-*` (14-day retention). Runtime entrypoint remains **`handler.lambda_handler`** (root shim + `stocvest.api.lambda_dispatch`).
- **API Gateway (6e):** **HTTP API** (not REST) with **JWT authorizer** (Cognito issuer + SPA + authorizer client **aud** when `cognito_jwt_*` tfvars are empty); **`GET /v1/health`** is public; admin routes include **`GET /v1/admin/users/{user_id}/activity-errors`** (per-user audit error window) alongside existing **`/v1/admin/users/*`** and audit paths; **WebSocket API** `$connect` / `$disconnect` / `$default` → `websocket` Lambda. Outputs: **`api_gateway_http_invoke_url`**, **`api_gateway_websocket_callback_url`**.
- **Cognito (6f):** User pool **`stocvest-development`** — email as username, password policy (12+ with upper/lower/number/symbol), **optional TOTP MFA** (software token only); **SPA client** (no secret) for Next.js; **second client** for Lambda authorizer (no secret); custom attributes **`custom:broker_connections`**, **`custom:account_tier`**. Outputs: **`cognito_user_pool_id`**, **`cognito_user_pool_arn`**, **`cognito_user_pool_client_frontend_id`**, **`cognito_user_pool_client_authorizer_id`**, **`cognito_jwt_issuer`**.
- **EventBridge Scheduler (6g):** `America/New_York` schedules → **`scanner`** Lambda (pre-market, intraday, EOD, **watchlist maturation refresh** after cash close); IAM role for Scheduler to invoke Lambda; schedule group + tags where supported.
- **EventBridge (D1):** `infra/eventbridge.tf` — rule **`stocvest-signal-resolution`** (`rate(30 minutes)`) → **`signal_resolution`** Lambda (1h/1d outcomes). **`terraform apply`** applied to development **2026-05-03** (see **CONTEXT** §3). See [`docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md`](../docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md).
- S3 remote state backend with native state locking (`use_lockfile` in `backend.hcl`)

### Vercel (Phase 6h) — map `terraform output` → frontend env

Set these in the Vercel project (**Production** and **Preview** as needed). Root directory for the Git-connected project should be **`frontend`**.

| Vercel / Next.js env var | Terraform output |
| --- | --- |
| `NEXT_PUBLIC_STOCVEST_API_BASE_URL` | `api_gateway_http_invoke_url` |
| `NEXT_PUBLIC_STOCVEST_WS_URL` | `api_gateway_websocket_callback_url` — full `wss://…execute-api…/$default` URL (stage path required) |
| `NEXT_PUBLIC_COGNITO_USER_POOL_ID` | `cognito_user_pool_id` |
| `NEXT_PUBLIC_COGNITO_CLIENT_ID` | `cognito_user_pool_client_frontend_id` |

Preview deployments use Vercel’s default Git integration (every PR gets a preview URL). Production domain **stocvest.app** is attached in Vercel **Project → Domains**; `frontend/vercel.json` redirects **www.stocvest.app** → **stocvest.app**.

## Files

- `versions.tf` - Terraform and provider requirements + S3 backend declaration
- `providers.tf` - AWS provider wiring
- `variables.tf` - all runtime inputs (no credentials/account IDs hardcoded)
- `main.tf` - VPC, subnets, route tables, NAT gateway, and security groups
- `dynamodb.tf` - contract DynamoDB tables (Phase 6b)
- `redis.tf` - ElastiCache Redis (Phase 6c)
- `ecs.tf` - ECS Fargate cluster + TWS/ibeam task definition (Phase 6d)
- `lambda_6e.tf` - API Lambdas + IAM + log groups (Phase 6e)
- `apigateway_6e.tf` - HTTP + WebSocket API Gateway v2 (Phase 6e)
- `cognito.tf` - Cognito user pool + app clients (Phase 6f)
- `eventbridge_scheduler_6g.tf` - EventBridge Scheduler → scanner Lambda (Phase 6g)
- `eventbridge.tf` - Signal resolution schedule → `signal_resolution` Lambda (D1)
- `outputs.tf` - exported infra IDs
- `backend.hcl.example` - backend settings template for `terraform init`
- `terraform.tfvars.example` - example variable values
- `validate.ps1` / `validate.sh` — `terraform fmt -check`, `init -backend=false`, and `validate` with a default region when `AWS_*` is unset (same reason as CI)

## Setup

1. Copy tfvars and backend files locally:
   - `cp terraform.tfvars.example terraform.tfvars`
   - `cp backend.hcl.example backend.hcl`
2. Replace all `REPLACE_WITH_*` placeholders.
3. Initialize backend:
   - `terraform init -backend-config backend.hcl`
4. Validate configuration:
   - **Recommended (fmt + validate, no tfvars):** from `infra/`, run **`./validate.sh`** (Unix/macOS/Git Bash) or **`powershell -File validate.ps1`** (Windows). These set `AWS_DEFAULT_REGION` to **`us-east-1`** when unset (matches the `aws_region` default in `variables.tf`), run `terraform init -backend=false`, then `terraform validate`.
   - **Manual:** set `AWS_REGION` or `AWS_DEFAULT_REGION` (e.g. `us-east-1`) **before** `terraform validate`, then run it after `terraform init` (local or remote backend). Without that env var, the AWS provider often errors with **Missing region value** because provider config is evaluated before full variable defaults are applied the same way as in `plan`.
   - **Full check with real inputs:** `terraform plan "-var-file=terraform.tfvars"` (implies validation and uses your tfvars; requires AWS credentials).
5. Apply (when ready):
   - `terraform apply "-var-file=terraform.tfvars"`

If `validate` reports missing backend `bucket` / `key`, run step 3 again so `.terraform/` reflects your `backend.hcl`, or ensure `versions.tf` backend defaults match your state bucket.

## Rules enforced in this phase

- No hardcoded credentials; do not commit secrets. Default state `bucket` / `key` in `versions.tf` match this repo’s backend; override via `backend.hcl` if needed.
- Sensitive/local runtime files (`terraform.tfvars`, `backend.hcl`) are local-only
- Every resource is tagged with:
  - `project = stocvest`
  - `env = development`

For **new** resources or env changes, update Terraform here and **`docs/CONTEXT.md` §3** so deploy checklists stay accurate.
