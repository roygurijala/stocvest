# Durable bucket for scheduled analysis reports (B71 Phase C news event study, etc.).
# Separate from lambda_artifacts (deployment zips, 30-day lifecycle).

variable "news_event_study_report_enabled" {
  description = "B71 Phase C: enable the scheduled news event-study report Lambda (writes to the reports bucket). Default off."
  type        = bool
  default     = false
}

resource "aws_s3_bucket" "reports" {
  bucket = "stocvest-development-reports-${data.aws_caller_identity.current.account_id}"

  tags = merge(local.common_tags, {
    Name    = "stocvest-development-reports"
    Purpose = "Scheduled analysis reports - read-only outputs"
  })
}

resource "aws_s3_bucket_public_access_block" "reports" {
  bucket = aws_s3_bucket.reports.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "reports" {
  bucket = aws_s3_bucket.reports.id

  rule {
    id     = "expire-news-event-study"
    status = "Enabled"

    filter {
      prefix = "news-event-study/"
    }

    expiration {
      days = 365
    }
  }
}

# Grant the shared api-lambda role write access to the reports bucket (PutObject only).
resource "aws_iam_role_policy" "lambda_reports_s3" {
  name = "stocvest-development-lambda-reports-s3"
  role = aws_iam_role.lambda_api_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReportsPut"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.reports.arn}/*"
      },
    ]
  })
}
