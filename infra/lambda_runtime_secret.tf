# Lambda API keys live in Secrets Manager (not on the function env) so values are not
# visible in the Lambda console / DescribeFunctionConfiguration. Terraform still
# receives them via variables for the initial secret version; rotate in AWS and prefer
# `lifecycle { ignore_changes = [secret_string] }` on the version if you manage values only in the console.

resource "aws_secretsmanager_secret" "lambda_runtime" {
  name                    = "stocvest/lambda-runtime"
  description             = "Polygon, Anthropic, and internal analysis keys for STOCVEST Lambdas."
  recovery_window_in_days = 7

  tags = merge(local.common_tags, {
    Name = "stocvest-lambda-runtime"
  })
}

resource "aws_secretsmanager_secret_version" "lambda_runtime" {
  secret_id = aws_secretsmanager_secret.lambda_runtime.id
  secret_string = jsonencode({
    POLYGON_API_KEY                = var.polygon_api_key
    ANTHROPIC_API_KEY              = var.anthropic_api_key
    STOCVEST_INTERNAL_ANALYSIS_KEY = var.internal_analysis_key
  })
}
