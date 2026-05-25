# Trial reminder emails — daily 9:00 AM America/New_York → brokers Lambda.

resource "aws_iam_role" "eventbridge_trial_reminders_invoke" {
  name = "stocvest-development-eventbridge-trial-reminders-invoke"

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
    Name = "stocvest-development-eventbridge-trial-reminders-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_trial_reminders_invoke_lambda" {
  name = "stocvest-development-invoke-brokers-trial-reminders"
  role = aws_iam_role.eventbridge_trial_reminders_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["brokers"].arn
    }]
  })
}

resource "aws_scheduler_schedule" "trial_reminders_daily" {
  name       = "stocvest-development-trial-reminders-daily"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 9 * * ? *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["brokers"].arn
    role_arn = aws_iam_role.eventbridge_trial_reminders_invoke.arn
    input    = jsonencode({ trial_reminder_tick = true })
  }
}
