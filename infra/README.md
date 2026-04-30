# STOCVEST Terraform (Phase 6a–6g)

This directory contains **Phase 6a–6g** infrastructure:

- VPC
- Public/private subnets, public and private route tables (private egress via NAT)
- NAT gateway (Elastic IP) in the first public subnet
- Security groups
- DynamoDB tables: `Users`, `BrokerConnections`, `Watchlists`, `Alerts` (TTL on `expiresAt`), `Orders`, `DayTradingSetups` — on-demand billing; tags `project=stocvest`, `env=development`
- ElastiCache Redis 7.x single-node (`cache.t3.micro`) in private subnets, data-tier security group, subnet group + parameter group; primary endpoint in `terraform output` for `REDIS_URL`
- ECS cluster `stocvest-development` (Fargate-only) and task definition for **ibeam** (`docker.io/voyz/ibeam:latest`) exposing **4002** (paper IB Gateway API). Run **ECS service** or **RunTask** with `awsvpc` using **`private_subnet_ids`** + **`app_security_group_id`** and `assignPublicIp=DISABLED`. Logs: `/ecs/stocvest-development/tws`.
- **Lambda (6e):** one function per Phase 4 handler module (`health`, `market_data`, `signals`, `brokers`, `portfolio`, `scanner`, `journal`, `pdt`, `authorizer`, `websocket`), Python **3.11**, VPC (**private subnets** + **app** SG), placeholder deployment zip until CI uploads real bundles; env includes **`REDIS_URL`**, **DynamoDB table names**, **`ECS_CLUSTER_ARN`**, **`STOCVEST_LAMBDA_MODULE`** (per-function, matches handler group); **CloudWatch** `/aws/lambda/stocvest-development-api-*` (14-day retention). Runtime entrypoint remains **`handler.lambda_handler`** (root shim + `stocvest.api.lambda_dispatch`).
- **API Gateway (6e):** **HTTP API** (not REST) with **JWT authorizer** (Cognito issuer + SPA + authorizer client **aud** when `cognito_jwt_*` tfvars are empty); **`GET /v1/health`** is public; **WebSocket API** `$connect` / `$disconnect` / `$default` → `websocket` Lambda. Outputs: **`api_gateway_http_invoke_url`**, **`api_gateway_websocket_callback_url`**.
- **Cognito (6f):** User pool **`stocvest-development`** — email as username, password policy (12+ with upper/lower/number/symbol), **optional TOTP MFA** (software token only); **SPA client** (no secret) for Next.js; **second client** for Lambda authorizer (no secret); custom attributes **`custom:broker_connections`**, **`custom:account_tier`**. Outputs: **`cognito_user_pool_id`**, **`cognito_user_pool_arn`**, **`cognito_user_pool_client_frontend_id`**, **`cognito_user_pool_client_authorizer_id`**, **`cognito_jwt_issuer`**.
- **EventBridge Scheduler (6g):** `America/New_York` schedules → **`scanner`** Lambda (pre-market, intraday, EOD); IAM role for Scheduler to invoke Lambda; schedule group + tags where supported.
- S3 remote state backend with native state locking (`use_lockfile` in `backend.hcl`)

### Vercel (Phase 6h) — map `terraform output` → frontend env

Set these in the Vercel project (**Production** and **Preview** as needed). Root directory for the Git-connected project should be **`frontend`**.

| Vercel / Next.js env var | Terraform output |
| --- | --- |
| `NEXT_PUBLIC_STOCVEST_API_BASE_URL` | `api_gateway_http_invoke_url` |
| `NEXT_PUBLIC_STOCVEST_WS_URL` | `api_gateway_websocket_callback_url` (use `wss://` in the browser) |
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
- `outputs.tf` - exported infra IDs
- `backend.hcl.example` - backend settings template for `terraform init`
- `terraform.tfvars.example` - example variable values

## Setup

1. Copy tfvars and backend files locally:
   - `cp terraform.tfvars.example terraform.tfvars`
   - `cp backend.hcl.example backend.hcl`
2. Replace all `REPLACE_WITH_*` placeholders.
3. Initialize backend:
   - `terraform init -backend-config backend.hcl`
4. Validate configuration:
   - **Syntax / consistency (no variable values):** `terraform validate`  
     Terraform intentionally does **not** apply `terraform.tfvars` during `validate`, so the AWS provider still needs a region from the environment: set `AWS_REGION` or `AWS_DEFAULT_REGION` (match your intended `aws_region`, e.g. `us-east-1`) before this command, **or** skip to step 5 and rely on plan.
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

Do not proceed to Phase 6b until 6a review is complete.
