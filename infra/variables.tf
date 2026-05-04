variable "aws_region" {
  description = "AWS region for infrastructure deployment."
  type        = string
  # Convenience default for local apply; override in `terraform.tfvars` for other regions.
  default = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID used for environment-level configuration."
  type        = string
}

variable "vpc_cidr_block" {
  description = "CIDR block for the primary VPC."
  type        = string
}

variable "availability_zones" {
  description = "Availability zones used for subnet placement."
  type        = list(string)
}

variable "public_subnet_cidr_blocks" {
  description = "CIDR blocks for public subnets."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_cidr_blocks) <= length(var.availability_zones)
    error_message = "public_subnet_cidr_blocks length must be less than or equal to availability_zones length."
  }
}

variable "private_subnet_cidr_blocks" {
  description = "CIDR blocks for private subnets."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_cidr_blocks) <= length(var.availability_zones)
    error_message = "private_subnet_cidr_blocks length must be less than or equal to availability_zones length."
  }
}

variable "allowed_ingress_cidrs" {
  description = "CIDR ranges allowed for ingress into the app security group."
  type        = list(string)
}

variable "cognito_jwt_issuer" {
  description = "Override JWT issuer for HTTP API JWT authorizer. Leave empty to use Cognito pool from this stack (Phase 6f)."
  type        = string
  default     = ""
}

variable "cognito_jwt_audience" {
  description = "Override JWT audience (single app client id). Leave empty to allow SPA + Lambda authorizer app client ids from this stack."
  type        = string
  default     = ""
}

variable "polygon_api_key" {
  description = "Polygon API key injected into Lambda environment (set via terraform.tfvars or TF_VAR_polygon_api_key)."
  type        = string
  sensitive   = true
}

variable "anthropic_api_key" {
  description = "Anthropic API key injected into Lambda environment (set via terraform.tfvars or TF_VAR_anthropic_api_key)."
  type        = string
  sensitive   = true
}

variable "internal_analysis_key" {
  description = "Key for internal signal analysis endpoint (X-Stocvest-Internal-Analysis header). Set via terraform.tfvars or TF_VAR_internal_analysis_key; never commit the real value."
  type        = string
  sensitive   = true
  default     = ""
}

variable "http_api_throttling_rate_limit" {
  description = <<-EOT
    API Gateway HTTP API ($default stage) steady-state request rate limit (requests per second) via default_route_settings.
    Applies per route unless overridden. Cannot exceed account-level API Gateway quota for the Region.
  EOT
  type        = number
  default     = 2000

  validation {
    condition     = var.http_api_throttling_rate_limit >= 100 && var.http_api_throttling_rate_limit <= 10000
    error_message = "http_api_throttling_rate_limit must be between 100 and 10000 (HTTP API stage default route)."
  }
}

variable "http_api_throttling_burst_limit" {
  description = <<-EOT
    API Gateway HTTP API ($default stage) burst limit (concurrent request submissions / token bucket capacity) via default_route_settings.
    Should typically be >= http_api_throttling_rate_limit. AWS enforces upper bounds per API type.
  EOT
  type        = number
  default     = 4000

  validation {
    condition     = var.http_api_throttling_burst_limit >= 100 && var.http_api_throttling_burst_limit <= 5000
    error_message = "http_api_throttling_burst_limit must be between 100 and 5000 (HTTP API stage default route)."
  }
}

variable "lambda_artifacts_bucket" {
  description = "S3 bucket for Lambda deployment zips"
  type        = string
  default     = "stocvest-development-lambda-artifacts-000504292517"
}
