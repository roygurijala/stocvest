###############################################################################
# D10 Phase 2b — Scheduled weight-proposal worker Lambda.
#
# This Lambda runs weekly (EventBridge cron) and writes ParameterProposal rows
# to DynamoDB. It deliberately has a SEPARATE IAM role from the shared
# `lambda_api_execution` role used by every other Lambda — the whole point of
# the D10 architecture is least-privilege separation:
#
#   • Optimizer Lambda (THIS file) — writes proposals, READ-ONLY on the
#     `stocvest/signal-parameters` Secrets Manager secret. NO UpdateSecret,
#     NO PutSecretValue, NO CreateSecret. Physically incapable of rotating
#     production weights — that's load-bearing.
#   • Admin BFF Lambda (Phase 3, future) — reads proposals + writes secrets
#     after admin authentication. Separate IAM with secretsmanager:UpdateSecret.
#   • Read-path Lambdas (existing) — read-only on secrets; live engines.
#
# If a future bug or compromise puts arbitrary code in the optimizer Lambda,
# the worst it can do is corrupt the proposal queue. The admin still has to
# explicitly approve every rotation from the review UI in Phase 3.
###############################################################################

# ── CloudWatch Logs ─────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "weight_proposer_lambda" {
  name              = "/aws/lambda/stocvest-development-api-weight_proposer"
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name = "stocvest-development-api-lambda-logs-weight_proposer"
  })
}

# ── Dedicated IAM role ──────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_weight_proposer_execution" {
  name = "stocvest-development-lambda-weight-proposer-execution"

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
    Name = "stocvest-development-lambda-weight-proposer-execution-role"
  })
}

resource "aws_iam_role_policy_attachment" "lambda_weight_proposer_basic" {
  role       = aws_iam_role.lambda_weight_proposer_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_weight_proposer_vpc" {
  role       = aws_iam_role.lambda_weight_proposer_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda_weight_proposer_data_access" {
  name = "stocvest-development-lambda-weight-proposer-data-access"
  role = aws_iam_role.lambda_weight_proposer_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Scan SignalHistory (the worker needs every resolved row in the
        # trailing 60-day window; DynamoDB Scan is the right primitive for a
        # weekly batch job at this row count — ~150-300 per mode).
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
        # Write proposals to ParameterProposal (also lists by status for the
        # `mark_superseded` flow that runs when a new pending proposal arrives
        # while an older pending is still queued — Phase 1 schema).
        Sid    = "ParameterProposalWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:GetItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:DescribeTable",
        ]
        Resource = [
          aws_dynamodb_table.parameter_proposal.arn,
          "${aws_dynamodb_table.parameter_proposal.arn}/index/*",
        ]
      },
      {
        # READ-ONLY on the signal-parameters secret. This is the load-bearing
        # safety property of the D10 design: the worker can READ current
        # weights to compute the proposal's baseline, but CANNOT mutate them.
        # NO UpdateSecret. NO PutSecretValue. NO CreateSecret. NO DeleteSecret.
        # The Phase-3 admin endpoint (separate role) does the writes after
        # human approval.
        Sid    = "SignalParametersReadOnly"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:stocvest/signal-parameters*"
      },
      {
        # Lambda runtime config secret (API keys etc.) — also read-only.
        Sid    = "LambdaRuntimeSecretReadOnly"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        Resource = aws_secretsmanager_secret.lambda_runtime.arn
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
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/stocvest-development-api-weight_proposer*"
      },
    ]
  })
}

# ── Lambda function ─────────────────────────────────────────────────────────

resource "aws_lambda_function" "weight_proposer" {
  function_name = "stocvest-development-api-weight_proposer"
  role          = aws_iam_role.lambda_weight_proposer_execution.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.11"
  # Optimizer evaluates ≤729 candidates per mode × 2 modes; on ~300 resolved
  # rows that's a few seconds of CPU. 5 minutes is comfortable headroom for
  # DDB scan + warm-start latency.
  timeout     = 300
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
        STOCVEST_LAMBDA_MODULE = "weight_proposer"
      },
    )
  }

  depends_on = [aws_cloudwatch_log_group.weight_proposer_lambda]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-api-weight_proposer"
  })
}

# ── EventBridge schedule — weekly, Monday 08:00 UTC ─────────────────────────

resource "aws_cloudwatch_event_rule" "weight_proposer" {
  name        = "stocvest-weight-proposer"
  description = "Weekly weight-proposal optimizer run (D10 Phase 2b)."
  # Monday 08:00 UTC = ~03:00-04:00 ET (DST-dependent), well before US market
  # open. The optimizer scans the trailing 60-day window — running before
  # market open ensures the most recent Friday's resolved 1d outcomes are
  # already settled (Friday close + 1d = late Sunday/early Monday).
  schedule_expression = "cron(0 8 ? * MON *)"
  state               = "ENABLED"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-weight-proposer"
  })
}

resource "aws_cloudwatch_event_target" "weight_proposer" {
  rule      = aws_cloudwatch_event_rule.weight_proposer.name
  target_id = "weight-proposer-lambda"
  arn       = aws_lambda_function.weight_proposer.arn
}

resource "aws_lambda_permission" "eventbridge_weight_proposer" {
  statement_id  = "AllowEventBridgeInvokeWeightProposer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.weight_proposer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.weight_proposer.arn
}
