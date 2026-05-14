# D1 — EventBridge (rate) → signal_resolution Lambda. See docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md.

resource "aws_cloudwatch_event_rule" "signal_resolution" {
  name                = "stocvest-signal-resolution"
  description         = "Resolve signal outcomes every 30 minutes"
  schedule_expression = "rate(30 minutes)"
  state               = "ENABLED"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-signal-resolution"
  })
}

resource "aws_cloudwatch_event_target" "signal_resolution" {
  rule      = aws_cloudwatch_event_rule.signal_resolution.name
  target_id = "signal-resolution-lambda"
  arn       = aws_lambda_function.api["signal_resolution"].arn
}

resource "aws_lambda_permission" "eventbridge_signal_resolution" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["signal_resolution"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.signal_resolution.arn
}

# Gap Intelligence — warm Dynamo read-through cache + keep anchor symbols fresh.
resource "aws_cloudwatch_event_rule" "gap_intel_cache_tick" {
  name                = "stocvest-gap-intel-cache-tick"
  description         = "Warm gap-intel DynamoDB cache every 2 minutes"
  schedule_expression = "rate(2 minutes)"
  state               = "ENABLED"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-gap-intel-cache-tick"
  })
}

resource "aws_cloudwatch_event_target" "gap_intel_cache_tick" {
  rule      = aws_cloudwatch_event_rule.gap_intel_cache_tick.name
  target_id = "gap-intel-cache-tick-signals-lambda"
  arn       = aws_lambda_function.api["signals"].arn
  input = jsonencode({
    gap_intel_cache_tick = true
  })
}

resource "aws_lambda_permission" "eventbridge_gap_intel_cache_tick" {
  statement_id  = "AllowEventBridgeGapIntelCacheTick"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["signals"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.gap_intel_cache_tick.arn
}

# Model portfolio weekday reversal: EventBridge Scheduler with America/New_York
# (see eventbridge_scheduler_6g.tf — stocvest-development-portfolio-reversal schedule).
