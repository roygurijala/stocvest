# Phase 6g — EventBridge *Scheduler* (cron with America/New_York) → scanner Lambda.
# Uses EventBridge Scheduler (not legacy UTC-only EventBridge cron) so EST/EDT track correctly.

resource "aws_scheduler_schedule_group" "scanner" {
  name = "stocvest-development-scanner"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-scanner-schedule-group"
  })
}

resource "aws_iam_role" "eventbridge_scanner_invoke" {
  name = "stocvest-development-eventbridge-scanner-invoke"

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
    Name = "stocvest-development-eventbridge-scanner-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_scanner_invoke_lambda" {
  name = "stocvest-development-invoke-scanner-lambda"
  role = aws_iam_role.eventbridge_scanner_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["scanner"].arn
    }]
  })
}

# Rule 1: 8:00 AM America/New_York, Mon–Fri (pre-market scan).
resource "aws_scheduler_schedule" "scanner_premarket" {
  name       = "stocvest-development-scanner-premarket"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 8 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "premarket"
    })
  }
}

# Rule 2a: 9:30–9:55 AM ET Mon–Fri (five-minute cadence within the 9 o’clock hour).
resource "aws_scheduler_schedule" "scanner_intraday_morning" {
  name       = "stocvest-development-scanner-intraday-morning"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(30,35,40,45,50,55 9 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "intraday"
    })
  }
}

# Rule 2b: 10:00 AM–3:55 PM ET Mon–Fri every 5 minutes (hours 10–15 in local wall time).
resource "aws_scheduler_schedule" "scanner_intraday_day" {
  name       = "stocvest-development-scanner-intraday-day"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0/5 10-15 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "intraday"
    })
  }
}

# Rule 2c: 4:00 PM ET Mon–Fri (last intraday tick; hours 10–15 cover through 3:55 only).
resource "aws_scheduler_schedule" "scanner_intraday_close" {
  name       = "stocvest-development-scanner-intraday-close"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 16 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "intraday"
    })
  }
}

# Rule 3: 3:45 PM America/New_York Mon–Fri (EOD summary).
resource "aws_scheduler_schedule" "scanner_eod" {
  name       = "stocvest-development-scanner-eod"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(45 15 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "eod_summary"
    })
  }
}

resource "aws_lambda_permission" "scanner_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridgeScheduler"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["scanner"].function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.scanner.name}/*"
}
