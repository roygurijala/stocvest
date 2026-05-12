# Phase 6f — Cognito user pool + SPA + Lambda authorizer app clients.

resource "aws_cognito_user_pool" "main" {
  name = "stocvest-development"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  mfa_configuration = "OPTIONAL"

  software_token_mfa_configuration {
    enabled = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  schema {
    name                     = "broker_connections"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false

    string_attribute_constraints {
      min_length = 0
      max_length = 2048
    }
  }

  schema {
    name                     = "account_tier"
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    required                 = false

    string_attribute_constraints {
      min_length = 0
      max_length = 256
    }
  }

  user_pool_add_ons {
    advanced_security_mode = "OFF"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-cognito-user-pool"
  })
}

# D10 Admin hub — the `signal-analytics-admin` Cognito group is the
# single source of truth for who can hit `/v1/admin/*` endpoints. Every
# admin handler authorizes against `analysis_authorized()` which checks
# group membership; the IAM policy in `lambda_6e.tf` (Sid
# `CognitoAdminUserDirectory`) grants the API role permission to
# manage membership programmatically so admins can be promoted /
# demoted from `/dashboard/admin/users`. The bootstrap path for the
# very first admin (before the UI surface exists for an empty pool) is
# `scripts/grant_admin.py`.
#
# Keep this group resource adjacent to the user pool so a future
# `terraform destroy` cleanly removes it; do NOT manage admin
# membership from Terraform — that belongs to the UI / bootstrap
# script so we don't have to apply infra changes every time admin
# membership churns.
resource "aws_cognito_user_group" "admin" {
  name         = "signal-analytics-admin"
  user_pool_id = aws_cognito_user_pool.main.id
  description  = "STOCVEST admin hub — gates /v1/admin/* and the /dashboard/admin/* UI."
  precedence   = 1
}

resource "aws_cognito_user_pool_client" "frontend" {
  name         = "stocvest-development-frontend-spa"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code", "implicit"]
  allowed_oauth_scopes                 = ["email", "openid", "profile"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = [
    "http://localhost:3000",
    "https://localhost:3000",
    "https://stocvest.app",
    "https://www.stocvest.app",
  ]
  logout_urls = [
    "http://localhost:3000",
    "https://localhost:3000",
    "https://stocvest.app",
    "https://www.stocvest.app",
  ]

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"

  read_attributes = [
    "email",
    "email_verified",
    "custom:broker_connections",
    "custom:account_tier",
  ]
  write_attributes = [
    "email",
    "custom:broker_connections",
    "custom:account_tier",
  ]
}

resource "aws_cognito_user_pool_client" "authorizer" {
  name         = "stocvest-development-lambda-authorizer"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret = false

  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
  ]

  prevent_user_existence_errors = "ENABLED"

  read_attributes = [
    "email",
    "email_verified",
    "custom:broker_connections",
    "custom:account_tier",
  ]
  write_attributes = [
    "email",
    "custom:broker_connections",
    "custom:account_tier",
  ]
}
