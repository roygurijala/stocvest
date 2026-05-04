resource "aws_s3_bucket" "lambda_artifacts" {
  bucket = var.lambda_artifacts_bucket

  tags = merge(local.common_tags, {
    Name    = "stocvest-development-lambda-artifacts"
    Purpose = "Lambda deployment packages"
  })
}

resource "aws_s3_bucket_lifecycle_configuration" "lambda_artifacts" {
  bucket = aws_s3_bucket.lambda_artifacts.id

  rule {
    id     = "cleanup-old-zips"
    status = "Enabled"

    filter {
      prefix = "lambda/"
    }

    expiration {
      days = 30
    }
  }
}

resource "aws_s3_bucket_versioning" "lambda_artifacts" {
  bucket = aws_s3_bucket.lambda_artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}
