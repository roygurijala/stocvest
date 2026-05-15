# Phase 6d — ECS Fargate: cluster + TWS/ibeam task definition (private subnets, app SG).

data "aws_caller_identity" "current" {}

locals {
  ecs_tws_dynamodb_resources = flatten([
    for t in [
      aws_dynamodb_table.users,
      aws_dynamodb_table.broker_connections,
      aws_dynamodb_table.watchlists,
      aws_dynamodb_table.watchlist_maturation,
      aws_dynamodb_table.alerts,
      aws_dynamodb_table.orders,
      aws_dynamodb_table.day_trading_setups,
    ] : [t.arn, "${t.arn}/index/*"]
  ])
}

resource "aws_ecs_cluster" "development" {
  name = "stocvest-development"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ecs-cluster"
  })
}

resource "aws_cloudwatch_log_group" "ecs_tws" {
  name              = "/ecs/stocvest-development/tws"
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ecs-tws-logs"
  })
}

resource "aws_iam_role" "ecs_tws_execution" {
  name = "stocvest-development-ecs-tws-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ecs-tws-execution-role"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_tws_execution_managed" {
  role       = aws_iam_role.ecs_tws_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_tws_execution_secrets" {
  name = "stocvest-development-ecs-tws-secrets-read"
  role = aws_iam_role.ecs_tws_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecretsManagerRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret",
        ]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${data.aws_caller_identity.current.account_id}:secret:*"
      }
    ]
  })
}

resource "aws_iam_role" "ecs_tws_task" {
  name = "stocvest-development-ecs-tws-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ecs-tws-task-role"
  })
}

resource "aws_iam_role_policy" "ecs_tws_task_dynamodb" {
  name = "stocvest-development-ecs-tws-dynamodb"
  role = aws_iam_role.ecs_tws_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DynamoDBPhase6bTables"
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
        Resource = local.ecs_tws_dynamodb_resources
      }
    ]
  })
}

resource "aws_ecs_task_definition" "tws" {
  family                   = "stocvest-development-tws"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_tws_execution.arn
  task_role_arn            = aws_iam_role.ecs_tws_task.arn

  container_definitions = jsonencode([
    {
      name      = "ibeam"
      image     = "docker.io/voyz/ibeam:latest"
      essential = true
      portMappings = [
        {
          containerPort = 4002
          hostPort      = 4002
          protocol      = "tcp"
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_tws.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "ibeam"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Name = "stocvest-development-tws-task-definition"
  })
}
