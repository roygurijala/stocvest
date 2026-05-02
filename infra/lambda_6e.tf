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
  ])

  lambda_common_env = {
    POLYGON_API_KEY        = var.polygon_api_key
    ANTHROPIC_API_KEY      = var.anthropic_api_key
    REDIS_URL              = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:${aws_elasticache_replication_group.redis.port}/0"
    STOCVEST_DISABLE_REDIS = "1"
    ECS_CLUSTER_ARN        = aws_ecs_cluster.development.arn
    # Do not set AWS_REGION — Lambda reserves it; runtime still exposes it to the handler.
    STOCVEST_ENV                      = "development"
    DYNAMODB_USERS_TABLE              = aws_dynamodb_table.users.name
    DYNAMODB_ORDERS_TABLE             = aws_dynamodb_table.orders.name
    DYNAMODB_ALERTS                   = aws_dynamodb_table.alerts.name
    DYNAMODB_WATCHLISTS_TABLE         = aws_dynamodb_table.watchlists.name
    DYNAMODB_BROKER_CONNECTIONS_TABLE = aws_dynamodb_table.broker_connections.name
    DYNAMODB_DAY_TRADING_SETUPS       = aws_dynamodb_table.day_trading_setups.name
    DYNAMODB_SIGNAL_HISTORY_TABLE     = aws_dynamodb_table.signal_history.name
    STOCVEST_TRADE_JOURNAL_TABLE      = aws_dynamodb_table.trade_journal.name
    STOCVEST_PDT_STATE_TABLE          = aws_dynamodb_table.pdt_state.name
  }

  lambda_dynamodb_resources = flatten([
    for t in [
      aws_dynamodb_table.users,
      aws_dynamodb_table.broker_connections,
      aws_dynamodb_table.watchlists,
      aws_dynamodb_table.alerts,
      aws_dynamodb_table.orders,
      aws_dynamodb_table.day_trading_setups,
      aws_dynamodb_table.signal_history,
      aws_dynamodb_table.trade_journal,
      aws_dynamodb_table.pdt_state,
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
        Sid    = "APIGatewayWebSocketManageConnections"
        Effect = "Allow"
        Action = ["execute-api:ManageConnections"]
        Resource = [
          "arn:aws:execute-api:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${aws_apigatewayv2_api.websocket.id}/*/@connections/*",
        ]
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
  timeout       = each.key == "scanner" ? 120 : each.key == "signal_resolution" ? 120 : 60
  memory_size   = 512

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
    )
  }

  depends_on = [aws_cloudwatch_log_group.api_lambda]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-api-${each.key}"
  })
}
