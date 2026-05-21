# Laggard intelligence scheduled jobs (Chunk 9) → laggard_jobs Lambda module.

resource "aws_scheduler_schedule_group" "laggard" {
  name = "stocvest-development-laggard"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-laggard-schedule-group"
  })
}

resource "aws_iam_role" "eventbridge_laggard_invoke" {
  name = "stocvest-development-eventbridge-laggard-invoke"

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
    Name = "stocvest-development-eventbridge-laggard-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_laggard_invoke_lambda" {
  name = "stocvest-development-invoke-laggard-jobs-lambda"
  role = aws_iam_role.eventbridge_laggard_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["laggard_jobs"].arn
    }]
  })
}

# 8:00 AM ET — warm registry + watchlist prices before swing maturation at 8:15.
resource "aws_scheduler_schedule" "laggard_price_cache_warmer" {
  name       = "stocvest-price-cache-warmer"
  group_name = aws_scheduler_schedule_group.laggard.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 8 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["laggard_jobs"].arn
    role_arn = aws_iam_role.eventbridge_laggard_invoke.arn
    input = jsonencode({
      action = "warm_price_cache"
    })
  }
}

# 7:45 AM ET — pre-IPO entity activations for proxy groups.
resource "aws_scheduler_schedule" "laggard_pre_ipo_monitor" {
  name       = "stocvest-pre-ipo-monitor"
  group_name = aws_scheduler_schedule_group.laggard.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(45 7 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["laggard_jobs"].arn
    role_arn = aws_iam_role.eventbridge_laggard_invoke.arn
    input = jsonencode({
      action = "pre_ipo_monitor"
    })
  }
}

# 9:35 AM ET — dynamic cluster pre-compute after the open.
resource "aws_scheduler_schedule" "laggard_dynamic_cluster_precompute" {
  name       = "stocvest-dynamic-cluster-precompute"
  group_name = aws_scheduler_schedule_group.laggard.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(35 9 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["laggard_jobs"].arn
    role_arn = aws_iam_role.eventbridge_laggard_invoke.arn
    input = jsonencode({
      action = "precompute_clusters"
    })
  }
}

resource "aws_lambda_permission" "laggard_jobs_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridgeSchedulerLaggard"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["laggard_jobs"].function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.laggard.name}/*"
}
