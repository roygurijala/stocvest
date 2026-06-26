###############################################################################
# Alert-email delivery health — metric alarm + SNS topic.
#
# Background: in June the Postmark account hit its monthly send limit and the
# provider began accepting API calls without actually delivering. Our app kept
# recording alerts as "sent" and the outage went unnoticed for ~10 days.
#
# Hardening (two parts):
#   1. The send path now records FAILED unless Postmark returns HTTP 200 *and*
#      ErrorCode 0, and publishes Stocvest/Alerts EmailSendOutcome
#      (Result=sent|failed) on every attempt (stocvest/services/alert_metrics.py).
#   2. This file alarms on Result=failed. Failures only occur when we actually
#      attempt sends (market days), so there are no weekend false positives:
#      with no attempts there is no "failed" data point and the alarm stays OK
#      (treat_missing_data = notBreaching).
###############################################################################

resource "aws_sns_topic" "alert_email_failures" {
  name = "stocvest-development-alert-email-failures"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-sns-alert-email-failures"
  })
}

# Optional email subscription, gated on a tfvars override (requires the
# recipient to confirm the SNS subscription via the emailed link).
resource "aws_sns_topic_subscription" "alert_email_failures_email" {
  count = length(trimspace(var.alert_email_failure_alarm_email)) > 0 ? 1 : 0

  topic_arn = aws_sns_topic.alert_email_failures.arn
  protocol  = "email"
  endpoint  = var.alert_email_failure_alarm_email
}

resource "aws_cloudwatch_metric_alarm" "alert_email_send_failures" {
  alarm_name          = "stocvest-development-alert-email-send-failures"
  alarm_description   = "One or more alert emails failed to send (Postmark non-200/ErrorCode!=0, missing token, or exception). Check the Postmark account status/limit and the signals/scanner Lambda logs."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "EmailSendOutcome"
  namespace           = "Stocvest/Alerts"
  period              = 900 # 15 min
  statistic           = "Sum"
  threshold           = 1

  dimensions = {
    Result = "failed"
  }

  # No failed data points (e.g. weekends / no sends attempted) => stay OK.
  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.alert_email_failures.arn]
  ok_actions    = [aws_sns_topic.alert_email_failures.arn]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-cw-alarm-alert-email-send-failures"
  })
}
