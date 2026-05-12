###############################################################################
# D10 Phase 4 — Post-rotation accuracy monitor + CloudWatch alarm + SNS topic.
#
# This file ships the safety net for the human-in-the-loop weight tuning
# pipeline. After an admin promotes a proposal (Phase 3a) and the live
# stocvest/signal-parameters secret rotates to a new version, we need a
# signal that says "the new weights are actually performing worse than the
# old ones — consider rolling back". That signal is the CloudWatch alarm
# defined here:
#
#   1. A daily-scheduled Lambda (this file) computes the trailing 14-day
#      directional accuracy for the CURRENT parameter_version and the
#      PREVIOUS parameter_version, both pulled from SignalHistory. It
#      publishes the delta (current_pct - baseline_pct) as a custom metric
#      Stocvest/Signals/PostRotationAccuracyDelta.
#
#   2. A CloudWatch alarm watches that metric, filtered on the Status
#      dimension == "degraded", and fires when the value crosses
#      -<threshold>pp (default -5pp).
#
#   3. The alarm publishes to an SNS topic; an optional email subscription
#      (gated on var.weight_rotation_alert_email) delivers the alert to
#      ops. The admin clicks "Roll back" in the admin UI to revert.
#
# Security posture (mirrors lambda_weight_proposer.tf):
#
#   * This Lambda has its OWN dedicated IAM role separate from the shared
#     lambda_api_execution role.
#   * IAM is strictly READ-ONLY on stocvest/signal-parameters AND on
#     ParameterHistory + SignalHistory — the monitor cannot mutate weights
#     under any circumstance.
#   * Only the admin BFF Lambda (Phase 3a route + Phase 4 rollback route)
#     has secretsmanager:UpdateSecret. The monitor publishes a *metric*,
#     a human reviews the alarm + the admin UI, and a separate IAM
#     principal rotates the weights.
###############################################################################

# ── CloudWatch Logs ─────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "weight_rotation_monitor_lambda" {
  name              = "/aws/lambda/stocvest-development-api-weight_rotation_monitor"
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name = "stocvest-development-api-lambda-logs-weight_rotation_monitor"
  })
}

# ── Dedicated IAM role ──────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_weight_rotation_monitor_execution" {
  name = "stocvest-development-lambda-weight-rotation-monitor-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-lambda-weight-rotation-monitor-execution-role"
  })
}

resource "aws_iam_role_policy_attachment" "lambda_weight_rotation_monitor_basic" {
  role       = aws_iam_role.lambda_weight_rotation_monitor_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_weight_rotation_monitor_vpc" {
  role       = aws_iam_role.lambda_weight_rotation_monitor_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda_weight_rotation_monitor_data_access" {
  name = "stocvest-development-lambda-weight-rotation-monitor-data-access"
  role = aws_iam_role.lambda_weight_rotation_monitor_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Read SignalHistory to compute directional accuracy per version.
        Sid    = "SignalHistoryReadOnly"
        Effect = "Allow"
        Action = [
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:GetItem",
          "dynamodb:BatchGetItem",
          "dynamodb:DescribeTable",
        ]
        Resource = [
          aws_dynamodb_table.signal_history.arn,
          "${aws_dynamodb_table.signal_history.arn}/index/*",
        ]
      },
      {
        # Read ParameterHistory to find the previous parameter_version.
        Sid    = "ParameterHistoryReadOnly"
        Effect = "Allow"
        Action = [
          "dynamodb:Scan",
          "dynamodb:Query",
          "dynamodb:GetItem",
          "dynamodb:DescribeTable",
        ]
        Resource = aws_dynamodb_table.parameter_history.arn
      },
      {
        # READ-ONLY on the signal-parameters secret. NO UpdateSecret.
        # NO PutSecretValue. NO CreateSecret. NO DeleteSecret. The
        # monitor's job is to PUBLISH a metric — never to mutate weights.
        Sid    = "SignalParametersReadOnly"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:stocvest/signal-parameters*"
      },
      {
        Sid    = "LambdaRuntimeSecretReadOnly"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        Resource = aws_secretsmanager_secret.lambda_runtime.arn
      },
      {
        # Publish the custom CloudWatch metric.
        Sid      = "CloudWatchPutMetric"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "Stocvest/Signals"
          }
        }
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/stocvest-development-api-weight_rotation_monitor*"
      },
    ]
  })
}

# ── Lambda function ─────────────────────────────────────────────────────────

resource "aws_lambda_function" "weight_rotation_monitor" {
  function_name = "stocvest-development-api-weight_rotation_monitor"
  role          = aws_iam_role.lambda_weight_rotation_monitor_execution.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.11"
  # The monitor scans the trailing-14-day window of SignalHistory for two
  # parameter_versions; that's ~hundreds of rows per query at expected
  # scale. 2 minutes is comfortable headroom.
  timeout     = 120
  memory_size = 512

  filename         = data.archive_file.api_lambda_placeholder.output_path
  source_code_hash = data.archive_file.api_lambda_placeholder.output_base64sha256

  vpc_config {
    subnet_ids         = [for s in aws_subnet.private : s.id]
    security_group_ids = [aws_security_group.app.id]
  }

  environment {
    variables = merge(
      local.lambda_common_env,
      {
        STOCVEST_LAMBDA_MODULE = "weight_rotation_monitor"
      },
    )
  }

  depends_on = [aws_cloudwatch_log_group.weight_rotation_monitor_lambda]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-api-weight_rotation_monitor"
  })
}

# ── EventBridge schedule — daily at 09:00 UTC ───────────────────────────────

resource "aws_cloudwatch_event_rule" "weight_rotation_monitor" {
  name        = "stocvest-weight-rotation-monitor"
  description = "Daily post-rotation accuracy monitor run (D10 Phase 4)."
  # Daily 09:00 UTC = ~04:00-05:00 ET (DST-dependent), after Phase-2b's
  # weekly Monday 08:00 UTC weight-proposer run and before US market
  # open. Daily cadence lets us catch a degradation inside the first
  # week of a rotation, well within the typical "trust this rotation"
  # review window.
  schedule_expression = "cron(0 9 * * ? *)"
  state               = "ENABLED"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-weight-rotation-monitor"
  })
}

resource "aws_cloudwatch_event_target" "weight_rotation_monitor" {
  rule      = aws_cloudwatch_event_rule.weight_rotation_monitor.name
  target_id = "weight-rotation-monitor-lambda"
  arn       = aws_lambda_function.weight_rotation_monitor.arn
}

resource "aws_lambda_permission" "eventbridge_weight_rotation_monitor" {
  statement_id  = "AllowEventBridgeInvokeWeightRotationMonitor"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.weight_rotation_monitor.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.weight_rotation_monitor.arn
}

# ── SNS topic for the alarm ─────────────────────────────────────────────────

resource "aws_sns_topic" "weight_rotation_degradation" {
  name = "stocvest-development-weight-rotation-degradation"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-sns-weight-rotation-degradation"
  })
}

# Email subscription is optional — gated on a tfvars override. Production
# tfvars sets a real ops inbox; dev/test leaves it empty so the topic
# exists for tests but doesn't try to deliver to an unverified address.
resource "aws_sns_topic_subscription" "weight_rotation_degradation_email" {
  count = length(trimspace(var.weight_rotation_alert_email)) > 0 ? 1 : 0

  topic_arn = aws_sns_topic.weight_rotation_degradation.arn
  protocol  = "email"
  endpoint  = var.weight_rotation_alert_email
}

# ── CloudWatch alarm on the monitor's custom metric ─────────────────────────

resource "aws_cloudwatch_metric_alarm" "weight_rotation_degraded" {
  alarm_name          = "stocvest-development-weight-rotation-degraded"
  alarm_description   = "Post-rotation directional accuracy dropped below the configured threshold. Review the latest rotation in the admin proposals page and roll back if necessary."
  comparison_operator = "LessThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "PostRotationAccuracyDelta"
  namespace           = "Stocvest/Signals"
  period              = 86400 # 1 day — the publisher runs daily
  statistic           = "Maximum"
  threshold           = -1 * var.weight_rotation_degradation_threshold_pp

  # Critical: only alarm on data points whose Status dimension is
  # "degraded". The publisher always emits a metric (so dashboards stay
  # continuous) but tags ok / insufficient_sample / baseline_unavailable
  # runs distinctly so they don't trigger the alarm.
  dimensions = {
    Status      = "degraded"
    Environment = "development"
  }

  # Don't alarm on missing data — when the publisher hasn't yet emitted
  # a "degraded" data point (e.g. all recent runs were "ok"), the alarm
  # stays OK.
  treat_missing_data = "notBreaching"

  alarm_actions = [aws_sns_topic.weight_rotation_degradation.arn]
  ok_actions    = [aws_sns_topic.weight_rotation_degradation.arn]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-cw-alarm-weight-rotation-degraded"
  })
}
