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

# Model portfolio — weekday reversal check (EventBridge cron is always UTC; US/Eastern shifts with DST).
#
#   cron(35 14 ? * MON-FRI *)  →  14:35 UTC Mon–Fri
#     • During EST (roughly Nov–Mar): 14:35 UTC = 9:35 AM Eastern  ✓
#     • During EDT (roughly Mar–Nov): 14:35 UTC = 10:35 AM Eastern (one hour later wall-clock)
#
# For exactly 9:35 AM Eastern year-round you would need two rules or a different UTC hour per season
# (e.g. 13:35 UTC hits 9:35 AM EDT but 8:35 AM EST). We keep a single expression and accept EDT drift.
resource "aws_cloudwatch_event_rule" "portfolio_reversal" {
  name                = "stocvest-portfolio-reversal"
  description         = "Re-evaluate open model-portfolio positions vs fresh composite (weekdays 14:35 UTC)"
  schedule_expression = "cron(35 14 ? * MON-FRI *)"
  state               = "ENABLED"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-portfolio-reversal"
  })
}

resource "aws_cloudwatch_event_target" "portfolio_reversal" {
  rule      = aws_cloudwatch_event_rule.portfolio_reversal.name
  target_id = "portfolio-reversal-lambda"
  arn       = aws_lambda_function.api["signal_resolution"].arn
  input     = jsonencode({ stocvest_job = "portfolio_reversal" })
}

resource "aws_lambda_permission" "eventbridge_portfolio_reversal" {
  statement_id  = "AllowEventBridgePortfolioReversal"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["signal_resolution"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.portfolio_reversal.arn
}
