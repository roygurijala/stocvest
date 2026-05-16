# Phase 6e — Lambda (Python 3.11): one function per Phase 4 handler module (placeholder zip).

data "archive_file" "api_lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/.terraform_placeholder_lambda.zip"
  source {
    content  = file("${path.module}/lambda_placeholder/handler.py")
    filename = "handler.py"
  }
}

locals {
  # HTTPS endpoint for API Gateway Management API (post_to_connection), scanner Lambda only.
  websocket_management_api_url = "https://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_apigatewayv2_stage.websocket_default.name}"

  api_handler_modules = toset([
    "health",
    "market_data",
    "signals",
    "signal_resolution",
    "brokers",
    "portfolio",
    "scanner",
    "journal",
    "pdt",
    "authorizer",
    "websocket",
    "news_consumer",
    "geo_themes",
    "orb_compute",
    "macro_warmer",
    "sector_daily_cache",
    "market_pulse_refresher",
  ])

  lambda_common_env = {
    # API keys: loaded at cold start from Secrets Manager (see stocvest/utils/config.py).
    STOCVEST_LAMBDA_RUNTIME_SECRET = aws_secretsmanager_secret.lambda_runtime.name
    REDIS_URL                      = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:${aws_elasticache_replication_group.redis.port}/0"
    STOCVEST_DISABLE_REDIS         = "1"
    ECS_CLUSTER_ARN                = aws_ecs_cluster.development.arn
    # Do not set AWS_REGION — Lambda reserves it; runtime still exposes it to the handler.
    STOCVEST_ENV                                   = "development"
    DYNAMODB_USERS_TABLE                           = aws_dynamodb_table.users.name
    DYNAMODB_ORDERS_TABLE                          = aws_dynamodb_table.orders.name
    DYNAMODB_ALERTS                                = aws_dynamodb_table.alerts.name
    DYNAMODB_WATCHLISTS_TABLE                      = aws_dynamodb_table.watchlists.name
    DYNAMODB_WATCHLIST_MATURATION_TABLE            = aws_dynamodb_table.watchlist_maturation.name
    DYNAMODB_WATCHLIST_MATURATION_TRANSITION_TABLE = aws_dynamodb_table.watchlist_maturation_transition.name
    DYNAMODB_BROKER_CONNECTIONS_TABLE              = aws_dynamodb_table.broker_connections.name
    DYNAMODB_DAY_TRADING_SETUPS                    = aws_dynamodb_table.day_trading_setups.name
    DYNAMODB_SIGNAL_HISTORY_TABLE                  = aws_dynamodb_table.signal_history.name
    DYNAMODB_PARAMETER_HISTORY_TABLE               = aws_dynamodb_table.parameter_history.name
    DYNAMODB_PARAMETER_PROPOSAL_TABLE              = aws_dynamodb_table.parameter_proposal.name
    DYNAMODB_SECTOR_CACHE_TABLE                    = aws_dynamodb_table.sector_cache.name
    STOCVEST_TRADE_JOURNAL_TABLE                   = aws_dynamodb_table.trade_journal.name
    STOCVEST_PDT_STATE_TABLE                       = aws_dynamodb_table.pdt_state.name
    STOCVEST_EMAIL_SENDER                          = "signals@stocvest.app"
    STOCVEST_PUBLIC_APP_URL                        = "https://stocvest.app"
    DYNAMODB_AUDIT_EVENTS_TABLE                    = aws_dynamodb_table.audit_events.name
    # Cognito identifiers needed by the D10 Admin hub
    # (`/v1/admin/users/*` + `/v1/admin/system-status`). Without these
    # the runtime `_pool_id()` helper resolves to "", `list_users_page`
    # silently returns an empty page, and the Admin Users screen
    # renders the misleading "No users found in the pool yet." copy.
    # See `docs/CONTEXT.md` row 14 for the regression that motivated
    # wiring these here. Values come from the same Cognito resources
    # the API Gateway JWT authorizer references — they are not
    # secrets (they're already published via `outputs.tf`), so they
    # live in the function environment rather than the runtime
    # Secrets Manager payload.
    COGNITO_USER_POOL_ID  = aws_cognito_user_pool.main.id
    COGNITO_REGION        = var.aws_region
    COGNITO_APP_CLIENT_ID = aws_cognito_user_pool_client.frontend.id
    # Admin → CloudWatch Logs Insights (`GET /v1/admin/error-logs`); matches log_group for_each naming.
    CLOUDWATCH_ADMIN_ERROR_LOG_PREFIX = "/aws/lambda/stocvest-development-api-"
  }

  lambda_dynamodb_resources = flatten([
    for t in [
      aws_dynamodb_table.users,
      aws_dynamodb_table.broker_connections,
      aws_dynamodb_table.watchlists,
      aws_dynamodb_table.watchlist_maturation,
      aws_dynamodb_table.watchlist_maturation_transition,
      aws_dynamodb_table.alerts,
      aws_dynamodb_table.orders,
      aws_dynamodb_table.day_trading_setups,
      aws_dynamodb_table.signal_history,
      aws_dynamodb_table.parameter_history,
      aws_dynamodb_table.parameter_proposal,
      aws_dynamodb_table.trade_journal,
      aws_dynamodb_table.pdt_state,
      aws_dynamodb_table.sector_cache,
      aws_dynamodb_table.audit_events,
      aws_dynamodb_table.gap_intel_cache,
      aws_dynamodb_table.scanner_evaluation_trace,
    ] : [t.arn, "${t.arn}/index/*"]
  ])
}

resource "aws_cloudwatch_log_group" "api_lambda" {
  for_each = local.api_handler_modules

  name              = "/aws/lambda/stocvest-development-api-${each.key}"
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name = "stocvest-development-api-lambda-logs-${each.key}"
  })
}

resource "aws_iam_role" "lambda_api_execution" {
  name = "stocvest-development-lambda-api-execution"

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
    Name = "stocvest-development-lambda-api-execution-role"
  })
}

resource "aws_iam_role_policy_attachment" "lambda_api_basic" {
  role       = aws_iam_role.lambda_api_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "lambda_api_vpc" {
  role       = aws_iam_role.lambda_api_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "lambda_api_data_access" {
  name = "stocvest-development-lambda-api-data-access"
  role = aws_iam_role.lambda_api_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBPhase6b"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:DescribeTable",
          "dynamodb:ConditionCheckItem",
        ]
        Resource = local.lambda_dynamodb_resources
      },
      {
        Sid    = "SecretsManagerRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:*"
      },
      {
        Sid    = "SecretsManagerSignalParametersWrite"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:UpdateSecret",
        ]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:stocvest/signal-parameters*"
      },
      {
        Sid    = "ElastiCacheDescribe"
        Effect = "Allow"
        Action = [
          "elasticache:DescribeReplicationGroups",
          "elasticache:DescribeCacheClusters",
        ]
        Resource = "*"
      },
      {
        Sid      = "ECSClusterDescribe"
        Effect   = "Allow"
        Action   = ["ecs:DescribeClusters", "ecs:ListTasks", "ecs:DescribeTasks"]
        Resource = aws_ecs_cluster.development.arn
      },
      {
        Sid      = "ECSTaskDefinitionDescribe"
        Effect   = "Allow"
        Action   = ["ecs:DescribeTaskDefinition"]
        Resource = "${aws_ecs_task_definition.tws.arn_without_revision}:*"
      },
      {
        Sid      = "ECSRunStopTask"
        Effect   = "Allow"
        Action   = ["ecs:RunTask", "ecs:StopTask"]
        Resource = "${aws_ecs_task_definition.tws.arn_without_revision}:*"
      },
      {
        Sid    = "IAMPassRoleForECSRunTask"
        Effect = "Allow"
        Action = ["iam:PassRole"]
        Resource = [
          aws_iam_role.ecs_tws_execution.arn,
          aws_iam_role.ecs_tws_task.arn,
        ]
      },
      {
        Sid      = "CloudWatchGapIntelMetrics"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchLogsLambda"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams",
        ]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/stocvest-development-api-*"
      },
      {
        Sid    = "CloudWatchLogsInsightsAdmin"
        Effect = "Allow"
        Action = [
          "logs:DescribeLogGroups",
          "logs:StartQuery",
          "logs:GetQueryResults",
          "logs:StopQuery",
        ]
        Resource = "*"
      },
      {
        Sid    = "APIGatewayWebSocketManageConnections"
        Effect = "Allow"
        Action = ["execute-api:ManageConnections"]
        Resource = [
          "arn:aws:execute-api:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${aws_apigatewayv2_api.websocket.id}/*/@connections/*",
        ]
      },
      {
        Sid      = "SESSendUserAlerts"
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "*"
      },
      {
        # D10 Admin hub — Cognito idp surface needed by
        # `/v1/admin/users/*` and `/v1/admin/system-status`. Scoped to
        # the project user pool ARN so the role cannot enumerate or
        # mutate identities in any unrelated pool. Group mutations
        # land on `signal-analytics-admin` (whitelisted at the handler
        # layer) but the IAM permission is broader so the same role
        # can support future whitelist entries without IAM churn.
        Sid    = "CognitoAdminUserDirectory"
        Effect = "Allow"
        Action = [
          "cognito-idp:ListUsers",
          "cognito-idp:ListUsersInGroup",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminListGroupsForUser",
          "cognito-idp:AdminResetUserPassword",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminRemoveUserFromGroup",
        ]
        Resource = aws_cognito_user_pool.main.arn
      },
    ]
  })
}

resource "aws_lambda_function" "api" {
  for_each = local.api_handler_modules

  function_name = "stocvest-development-api-${each.key}"
  role          = aws_iam_role.lambda_api_execution.arn
  handler       = "handler.lambda_handler"
  runtime       = "python3.11"
  timeout       = each.key == "scanner" ? 120 : each.key == "signal_resolution" ? 120 : each.key == "news_consumer" ? 120 : each.key == "geo_themes" ? 30 : each.key == "macro_warmer" ? 60 : each.key == "sector_daily_cache" ? 120 : each.key == "market_pulse_refresher" ? 15 : 60
  memory_size   = each.key == "geo_themes" ? 256 : each.key == "orb_compute" ? 256 : each.key == "macro_warmer" ? 256 : each.key == "sector_daily_cache" ? 512 : each.key == "market_pulse_refresher" ? 256 : 512

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
        STOCVEST_LAMBDA_MODULE = each.key
      },
      each.key == "scanner" ? {
        STOCVEST_WS_MANAGEMENT_API_URL = local.websocket_management_api_url
      } : {},
      each.key == "news_consumer" ? {
        STOCVEST_DISABLE_REDIS = "0"
      } : {},
      each.key == "geo_themes" ? {
        STOCVEST_DISABLE_REDIS = "0"
      } : {},
      each.key == "macro_warmer" ? {
        STOCVEST_DISABLE_REDIS = "0"
      } : {},
      each.key == "sector_daily_cache" ? {
        STOCVEST_DISABLE_REDIS = "0"
      } : {},
      each.key == "market_pulse_refresher" ? {
        STOCVEST_DISABLE_REDIS = "0"
      } : {},
      each.key == "signals" ? {
        DYNAMODB_GAP_INTEL_CACHE_TABLE          = aws_dynamodb_table.gap_intel_cache.name
        DYNAMODB_SCANNER_EVALUATION_TRACE_TABLE = aws_dynamodb_table.scanner_evaluation_trace.name
        GAP_INTEL_TICK_SYMBOLS                  = "SPY,QQQ,IWM"
      } : {},
    )
  }

  depends_on = [aws_cloudwatch_log_group.api_lambda]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-api-${each.key}"
  })
}
