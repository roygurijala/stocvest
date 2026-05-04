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

# Model portfolio — weekday check (~9:35 AM US/Eastern during standard-time window; tune for DST if needed).
resource "aws_cloudwatch_event_rule" "portfolio_reversal" {
  name                = "stocvest-portfolio-reversal"
  description         = "Re-evaluate open model-portfolio positions vs fresh composite (weekdays)"
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
