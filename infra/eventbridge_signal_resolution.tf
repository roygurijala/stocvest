# D1 — EventBridge (rate) → signal_resolution Lambda. See docs/D1_SIGNAL_RESOLUTION_SCHEDULE.md.

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
