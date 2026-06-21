# B71 Phase C — weekly news event-study report → news_event_study_report Lambda module.

resource "aws_scheduler_schedule_group" "news_event_study" {
  name = "stocvest-development-news-event-study"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-news-event-study-schedule-group"
  })
}

resource "aws_iam_role" "eventbridge_news_event_study_invoke" {
  name = "stocvest-development-eventbridge-news-event-study-invoke"

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
    Name = "stocvest-development-eventbridge-news-event-study-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_news_event_study_invoke_lambda" {
  name = "stocvest-development-invoke-news-event-study-lambda"
  role = aws_iam_role.eventbridge_news_event_study_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["news_event_study_report"].arn
    }]
  })
}

# Sunday 18:00 ET — weekly, after the week's signal-resolution outcomes have settled.
resource "aws_scheduler_schedule" "news_event_study_weekly" {
  name       = "stocvest-news-event-study-weekly"
  group_name = aws_scheduler_schedule_group.news_event_study.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 18 ? * SUN *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["news_event_study_report"].arn
    role_arn = aws_iam_role.eventbridge_news_event_study_invoke.arn
    input = jsonencode({
      job = "news_event_study_report"
    })
  }
}

resource "aws_lambda_permission" "news_event_study_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridgeSchedulerNewsEventStudy"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["news_event_study_report"].function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.news_event_study.name}/*"
}
