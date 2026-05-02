# D1 — Signal resolution Lambda (EventBridge)

The `SignalHistory` DynamoDB table and `DYNAMODB_SIGNAL_HISTORY_TABLE` env var are defined in Terraform (`infra/dynamodb.tf`, `infra/lambda_6e.tf`). A separate Lambda alias **`signal_resolution`** is included in `local.api_handler_modules` with handler `stocvest.api.handlers.signal_resolution:signal_resolution_scheduled_handler` (dispatched when `STOCVEST_LAMBDA_MODULE=signal_resolution`).

**Schedule:** `infra/eventbridge_signal_resolution.tf` defines the EventBridge rule (**`stocvest-signal-resolution`**, `rate(30 minutes)`), target, and Lambda invoke permission. Run **`terraform apply`** in `infra/` to create them in AWS (not applied automatically by CI).

## What the job does

On each invocation it runs (async, Polygon snapshot):

1. `resolve_signals(cutoff_minutes=60, horizon="1h")` — unresolved public/user rows older than 60 minutes get `price_1h_after`, `outcome_1h`, `resolved_1h`.
2. `resolve_signals(cutoff_minutes=1440, horizon="1d")` — same for 1d fields.

Outcomes use a **0.1%** neutral band; bullish/bearish correctness is price vs `price_at_signal` per `stocvest/api/services/signal_recorder.py`.

## Terraform (source of truth in repo)

```hcl
resource "aws_cloudwatch_event_rule" "signal_resolution" {
  name                = "stocvest-signal-resolution"
  schedule_expression = "rate(30 minutes)"
}

resource "aws_cloudwatch_event_target" "signal_resolution" {
  rule      = aws_cloudwatch_event_rule.signal_resolution.name
  target_id = "SignalResolution"
  arn       = aws_lambda_function.api["signal_resolution"].arn
}

resource "aws_lambda_permission" "signal_resolution_events" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["signal_resolution"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.signal_resolution.arn
}
```

Deploy the real Lambda artifact (not the placeholder zip) before scheduling in production.
