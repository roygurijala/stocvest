# PORTFOLIO-MGMT Slice 3a — daily post-close portfolio digest email.
# Weekdays 5:00 PM America/New_York → portfolio_review Lambda with { portfolio_digest_tick = true }.
# Gated at runtime by PORTFOLIO_DIGEST_ENABLED (default OFF) so it ships dark.

resource "aws_iam_role" "eventbridge_portfolio_digest_invoke" {
  name = "stocvest-development-eventbridge-portfolio-digest-invoke"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "scheduler.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-portfolio-digest-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_portfolio_digest_invoke_lambda" {
  name = "stocvest-development-invoke-portfolio-review-digest"
  role = aws_iam_role.eventbridge_portfolio_digest_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["portfolio_review"].arn
    }]
  })
}

resource "aws_scheduler_schedule" "portfolio_digest_daily" {
  name       = "stocvest-development-portfolio-digest-daily"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 17 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["portfolio_review"].arn
    role_arn = aws_iam_role.eventbridge_portfolio_digest_invoke.arn
    input    = jsonencode({ portfolio_digest_tick = true })
  }
}
