# SQS triage queue + news_consumer Lambda event source + IAM.
# ECS news worker task/service: ecs_news_worker.tf

resource "aws_sqs_queue" "news_triage" {
  name = "stocvest-news-triage-queue"

  visibility_timeout_seconds = 180

  tags = merge(local.common_tags, {
    Name = "stocvest-news-triage-queue"
  })
}

resource "aws_iam_role_policy" "lambda_news_sqs" {
  name = "stocvest-development-lambda-news-sqs"
  role = aws_iam_role.lambda_api_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "NewsTriageConsume"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = aws_sqs_queue.news_triage.arn
      },
      {
        Sid    = "NewsTriageProduce"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueUrl",
        ]
        Resource = aws_sqs_queue.news_triage.arn
      },
    ]
  })
}

resource "aws_lambda_event_source_mapping" "news_consumer_sqs" {
  event_source_arn = aws_sqs_queue.news_triage.arn
  function_name    = aws_lambda_function.api["news_consumer"].arn
  batch_size       = 5

  function_response_types = ["ReportBatchItemFailures"]

  depends_on = [aws_iam_role_policy.lambda_news_sqs]
}
