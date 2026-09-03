###############################################################################
# Lambda account concurrency + throttle alarms (ADR-002 OPS-2).
#
# Fires when concurrent executions exceed 80% of the account quota for 5 minutes,
# or when Lambda throttles occur (any function starving for capacity).
###############################################################################

locals {
  lambda_concurrency_alarm_threshold = floor(
    var.lambda_account_concurrent_execution_quota *
    var.lambda_concurrent_executions_alarm_threshold_percent / 100
  )
}

resource "aws_cloudwatch_metric_alarm" "lambda_concurrent_executions_high" {
  alarm_name          = "stocvest-development-lambda-concurrent-executions-high"
  alarm_description   = "Account Lambda ConcurrentExecutions exceeded ${var.lambda_concurrent_executions_alarm_threshold_percent}% of quota (${local.lambda_concurrency_alarm_threshold} of ${var.lambda_account_concurrent_execution_quota}) for 5 minutes. Check news_consumer drain, EventBridge bursts, and Service Quotas."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 5
  metric_name         = "ConcurrentExecutions"
  namespace           = "AWS/Lambda"
  period              = 60
  statistic           = "Maximum"
  threshold           = local.lambda_concurrency_alarm_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alert_email_failures.arn]
  ok_actions    = [aws_sns_topic.alert_email_failures.arn]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-cw-alarm-lambda-concurrent-executions-high"
  })
}

resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  alarm_name          = "stocvest-development-lambda-throttles"
  alarm_description   = "One or more Lambda invocations were throttled in the last 5 minutes (account capacity saturated). Investigate concurrent execution quota and reserved/unreserved concurrency."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Throttles"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alert_email_failures.arn]
  ok_actions    = [aws_sns_topic.alert_email_failures.arn]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-cw-alarm-lambda-throttles"
  })
}
