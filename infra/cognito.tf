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
