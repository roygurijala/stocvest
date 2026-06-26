# Optional Fargate service: Benzinga + EDGAR news worker (set news_worker_desired_count > 0 after pushing image).

variable "news_worker_container_image" {
  description = "Container image for stocvest news worker (e.g. ACCOUNT.dkr.ecr.REGION.amazonaws.com/stocvest-news-worker:latest). Leave empty to skip ECS service."
  type        = string
  default     = ""
}

variable "news_worker_desired_count" {
  description = "Fargate desired count for news worker (0 skips service create)."
  type        = number
  default     = 0
}

variable "news_sentiment_cache_enabled" {
  description = "B71 Phase D: enable the read-through Claude sentiment cache (consumer writes + composite reads). Default off (dark launch). Requires the ECS news worker running to populate the cache."
  type        = bool
  default     = false
}

variable "news_sentiment_prime_enabled" {
  description = "B71 Phase D self-prime: let the composite enqueue abstaining cache-miss articles to the triage queue for async scoring. Default off. Requires news_sentiment_cache_enabled too."
  type        = bool
  default     = false
}

variable "news_impact_weighting_enabled" {
  description = "B74: weight the composite News layer by relevance x impact x age and shrink thin evidence toward neutral. Default off (ships dark; OFF = byte-identical legacy News score). Tier 1 works on the heuristic alone; Claude per-article relevance/impact additionally requires news_sentiment_cache_enabled (+ prime or the ECS worker) to populate the cache."
  type        = bool
  default     = false
}

variable "day_profit_target_exit_enabled" {
  description = "Day ledger monitor take-profit: close an open day validation position at the reference target (reference_structure_level) when the snapshot last price reaches it, checked before the VWAP-violation rule. Sets STOCVEST_DAY_PROFIT_TARGET_EXIT_ENABLED on the signal_resolution Lambda. Default off (OFF = legacy exits byte-identical)."
  type        = bool
  default     = false
}

# ECR repo for the news-worker image. Created unconditionally so you can build/push
# (see scripts/build_push_news_worker.ps1) BEFORE setting news_worker_container_image
# to its repository_url and bumping news_worker_desired_count > 0.
resource "aws_ecr_repository" "news_worker" {
  name                 = "stocvest-news-worker"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-news-worker-ecr"
  })
}

data "aws_secretsmanager_secret" "external_api_keys" {
  count = var.news_worker_container_image != "" ? 1 : 0
  name  = "stocvest/external-api-keys"
}

resource "aws_cloudwatch_log_group" "ecs_news_worker" {
  count             = var.news_worker_container_image != "" ? 1 : 0
  name              = "/ecs/stocvest-development/news-worker"
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ecs-news-worker-logs"
  })
}

resource "aws_iam_role" "ecs_news_execution" {
  count = var.news_worker_container_image != "" ? 1 : 0
  name  = "stocvest-development-ecs-news-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ecs-news-exec-role"
  })
}

resource "aws_iam_role_policy_attachment" "ecs_news_execution_managed" {
  count      = var.news_worker_container_image != "" ? 1 : 0
  role       = aws_iam_role.ecs_news_execution[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_news_execution_secrets" {
  count = var.news_worker_container_image != "" ? 1 : 0
  name  = "stocvest-development-ecs-news-exec-secrets"
  role  = aws_iam_role.ecs_news_execution[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SecretsRead"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
        ]
        Resource = data.aws_secretsmanager_secret.external_api_keys[0].arn
      },
    ]
  })
}

resource "aws_iam_role" "ecs_news_task" {
  count = var.news_worker_container_image != "" ? 1 : 0
  name  = "stocvest-development-ecs-news-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ecs-news-task-role"
  })
}

resource "aws_iam_role_policy" "ecs_news_task_policy" {
  count = var.news_worker_container_image != "" ? 1 : 0
  name  = "stocvest-development-ecs-news-task-policy"
  role  = aws_iam_role.ecs_news_task[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SQSNewsTriageSend"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueUrl",
        ]
        Resource = aws_sqs_queue.news_triage.arn
      },
      {
        Sid      = "CloudWatchMetrics"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
      },
    ]
  })
}

resource "aws_ecs_task_definition" "news_worker" {
  count                    = var.news_worker_container_image != "" ? 1 : 0
  family                   = "stocvest-development-news-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_news_execution[0].arn
  task_role_arn            = aws_iam_role.ecs_news_task[0].arn

  container_definitions = jsonencode([
    {
      name      = "news-worker"
      image     = var.news_worker_container_image
      essential = true
      environment = [
        { name = "STOCVEST_ENV", value = "development" },
        { name = "AWS_REGION", value = var.aws_region },
        { name = "STOCVEST_DISABLE_REDIS", value = "0" },
        { name = "REDIS_URL", value = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:${aws_elasticache_replication_group.redis.port}/0" },
        { name = "STOCVEST_NEWS_TRIAGE_QUEUE_URL", value = aws_sqs_queue.news_triage.url },
        { name = "STOCVEST_NEWS_SENTIMENT_CACHE_ENABLED", value = var.news_sentiment_cache_enabled ? "1" : "0" },
        { name = "BENZINGA_NEWS_WS_URL", value = "wss://api.benzinga.com/api/v1/news/stream" },
        { name = "POLYGON_API_KEY", value = var.polygon_api_key },
      ]
      secrets = [
        {
          # The worker's WebSocket reads BENZINGA_API_KEY (settings.benzinga_api_key).
          # Map it from the generic BENZINGA_API_KEY secret field (the dedicated
          # BENZINGA_NEWS_API_KEY also returned 401, so test the generic key here).
          name      = "BENZINGA_API_KEY"
          valueFrom = "${data.aws_secretsmanager_secret.external_api_keys[0].arn}:BENZINGA_API_KEY::"
        },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs_news_worker[0].name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "news-worker"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Name = "stocvest-development-news-worker-task"
  })
}

resource "aws_ecs_service" "news_worker" {
  count           = var.news_worker_container_image != "" && var.news_worker_desired_count > 0 ? 1 : 0
  name            = "stocvest-news-worker"
  cluster         = aws_ecs_cluster.development.id
  task_definition = aws_ecs_task_definition.news_worker[0].arn
  desired_count   = var.news_worker_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [for s in aws_subnet.private : s.id]
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-news-worker-service"
  })
}
