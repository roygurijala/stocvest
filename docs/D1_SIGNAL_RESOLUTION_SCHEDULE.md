# D1 — Signal resolution Lambda (EventBridge)

**Last updated:** 2026-05-03

**Ops note (2026-05-03):** **`terraform apply -var-file=terraform.tfvars -input=false -auto-approve`** completed successfully (**Apply complete! Resources: 19 added, 14 changed, 2 destroyed.**), including EventBridge rule/target/permission alignment, new API Gateway HTTP routes, Lambda environment updates, and SES IAM on the API execution role.

The `SignalHistory` DynamoDB table and `DYNAMODB_SIGNAL_HISTORY_TABLE` env var are defined in Terraform (`infra/dynamodb.tf`, `infra/lambda_6e.tf`). A separate Lambda alias **`signal_resolution`** is included in `local.api_handler_modules` with handler `stocvest.api.handlers.signal_resolution:signal_resolution_scheduled_handler` (dispatched when `STOCVEST_LAMBDA_MODULE=signal_resolution`).

**Schedule:** `infra/eventbridge.tf` defines the EventBridge rule (**`stocvest-signal-resolution`**, `rate(30 minutes)`), target, and Lambda invoke permission. Run **`terraform apply`** in `infra/` to create or update them in AWS (not applied automatically by CI).

## What the job does

On each invocation it runs (async, **Polygon 1-minute aggregates**, not live snapshot):

1. `resolve_signals(cutoff_minutes=60, horizon="1h")` — unresolved public/user rows older than 60 minutes get `price_1h_after`, `outcome_1h`, `resolved_1h`. The evaluated price is the **close of the last 1m bar whose bar start is at or before** `generated_at + 60 minutes` (query window extends forward for thin tape / weekends).
2. `resolve_signals(cutoff_minutes=1440, horizon="1d")` — same for 1d fields using **`generated_at + 1440` minutes** (rolling 24h wall-clock).

Outcomes use a **0.1%** neutral band; bullish/bearish correctness is price vs `price_at_signal` per `stocvest/api/services/signal_recorder.py` (`PolygonClient.get_evaluated_price_after_signal`).

## Terraform (source of truth in repo)

```hcl
resource "aws_cloudwatch_event_rule" "signal_resolution" {
  name                = "stocvest-signal-resolution"
  description         = "Resolve signal outcomes every 30 minutes"
  schedule_expression = "rate(30 minutes)"
  state               = "ENABLED"
  tags                = merge(local.common_tags, { Name = "stocvest-development-eventbridge-signal-resolution" })
}

resource "aws_cloudwatch_event_target" "signal_resolution" {
  rule      = aws_cloudwatch_event_rule.signal_resolution.name
  target_id = "signal-resolution-lambda"
  arn       = aws_lambda_function.api["signal_resolution"].arn
}

resource "aws_lambda_permission" "eventbridge_signal_resolution" {
  statement_id  = "AllowEventBridgeInvoke"
  action          = "lambda:InvokeFunction"
  function_name   = aws_lambda_function.api["signal_resolution"].function_name
  principal       = "events.amazonaws.com"
  source_arn      = aws_cloudwatch_event_rule.signal_resolution.arn
}
```

Deploy the real Lambda artifact (not the placeholder zip) before scheduling in production.
