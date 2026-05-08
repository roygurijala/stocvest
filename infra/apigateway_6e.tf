# Phase 6e — API Gateway HTTP API (/v1/*) + WebSocket API ($connect / $disconnect / $default).

locals {
  http_api_route_definitions = {
    "GET /v1/health" = { module_key = "health", authorizer = false }

    "GET /v1/market/status"        = { module_key = "market_data", authorizer = true }
    "GET /v1/market/macro-context" = { module_key = "market_data", authorizer = true }
    "GET /v1/market/snapshot"      = { module_key = "market_data", authorizer = true }
    "GET /v1/market/snapshots"     = { module_key = "market_data", authorizer = true }
    "GET /v1/market/bars"          = { module_key = "market_data", authorizer = true }
    "POST /v1/market/bars-batch"   = { module_key = "market_data", authorizer = true }
    "GET /v1/market/news"          = { module_key = "market_data", authorizer = true }
    "GET /v1/market/options"       = { module_key = "market_data", authorizer = true }
    "GET /v1/market/earnings"      = { module_key = "market_data", authorizer = true }

    "POST /v1/signals/swing/composite"       = { module_key = "signals", authorizer = true }
    "POST /v1/signals/composite/real"        = { module_key = "signals", authorizer = true }
    "POST /v1/signals/composite/swing"       = { module_key = "signals", authorizer = true }
    "POST /v1/signals/swing/synthesis/parse" = { module_key = "signals", authorizer = true }
    "POST /v1/signals/day/setups"            = { module_key = "signals", authorizer = true }
    "POST /v1/signals/swing/setups"          = { module_key = "signals", authorizer = true }
    "POST /v1/signals/day/briefing"          = { module_key = "signals", authorizer = true }
    "GET /v1/signals/recent"                 = { module_key = "signals", authorizer = false }
    "GET /v1/signals/performance/summary"    = { module_key = "signals", authorizer = false }
    "GET /v1/signals/records/{signal_id}"    = { module_key = "signals", authorizer = false }
    "GET /v1/signals/founding-members"       = { module_key = "signals", authorizer = false }
    "GET /v1/signals/me/history"             = { module_key = "signals", authorizer = true }
    "GET /v1/signals/me/records/{signal_id}" = { module_key = "signals", authorizer = true }
    "GET /v1/signals/analysis"               = { module_key = "signals", authorizer = true }

    "GET /v1/portfolio/summary"           = { module_key = "signals", authorizer = false }
    "GET /v1/portfolio/positions/open"    = { module_key = "signals", authorizer = false }
    "GET /v1/portfolio/positions/history" = { module_key = "signals", authorizer = false }
    "GET /v1/portfolio/performance"       = { module_key = "signals", authorizer = false }
    "POST /v1/portfolio/positions/open"   = { module_key = "signals", authorizer = false }
    "POST /v1/portfolio/positions/close"  = { module_key = "signals", authorizer = false }

    "GET /v1/brokers/health"    = { module_key = "brokers", authorizer = true }
    "GET /v1/brokers/accounts"  = { module_key = "brokers", authorizer = true }
    "GET /v1/brokers/positions" = { module_key = "brokers", authorizer = true }
    "GET /v1/brokers/overview"  = { module_key = "brokers", authorizer = true }
    "POST /v1/brokers/orders"   = { module_key = "brokers", authorizer = true }
    "GET /v1/brokers/orders"    = { module_key = "brokers", authorizer = true }
    "DELETE /v1/brokers/orders" = { module_key = "brokers", authorizer = true }

    "POST /v1/orders/validate"                    = { module_key = "brokers", authorizer = true }
    "POST /v1/orders/submit"                      = { module_key = "brokers", authorizer = true }
    "GET /v1/orders/{order_id}/status"            = { module_key = "brokers", authorizer = true }
    "GET /v1/profile/trading-mode"                = { module_key = "brokers", authorizer = true }
    "POST /v1/profile/trading-mode"               = { module_key = "brokers", authorizer = true }
    "GET /v1/users/me"                            = { module_key = "brokers", authorizer = true }
    "PATCH /v1/users/me"                          = { module_key = "brokers", authorizer = true }
    "PATCH /v1/admin/users/{user_id}/beta-access" = { module_key = "brokers", authorizer = true }
    "GET /v1/admin/audit/users/{user_id}"         = { module_key = "brokers", authorizer = true }
    "GET /v1/admin/audit/sessions/{session_id}"   = { module_key = "brokers", authorizer = true }
    "GET /v1/auth/etrade/start"                   = { module_key = "brokers", authorizer = true }
    "POST /v1/auth/etrade/callback"               = { module_key = "brokers", authorizer = true }

    "GET /v1/watchlists/default/symbols"                    = { module_key = "brokers", authorizer = true }
    "POST /v1/watchlists/default/symbols"                   = { module_key = "brokers", authorizer = true }
    "GET /v1/watchlists"                                    = { module_key = "brokers", authorizer = true }
    "POST /v1/watchlists"                                   = { module_key = "brokers", authorizer = true }
    "GET /v1/watchlists/{watchlist_id}"                     = { module_key = "brokers", authorizer = true }
    "PATCH /v1/watchlists/{watchlist_id}"                   = { module_key = "brokers", authorizer = true }
    "DELETE /v1/watchlists/{watchlist_id}"                  = { module_key = "brokers", authorizer = true }
    "POST /v1/watchlists/{watchlist_id}/symbols"            = { module_key = "brokers", authorizer = true }
    "DELETE /v1/watchlists/{watchlist_id}/symbols/{symbol}" = { module_key = "brokers", authorizer = true }

    "GET /v1/alerts/preferences"   = { module_key = "brokers", authorizer = true }
    "PATCH /v1/alerts/preferences" = { module_key = "brokers", authorizer = true }
    "GET /v1/alerts/history"       = { module_key = "brokers", authorizer = true }

    "POST /v1/portfolio/holdings"   = { module_key = "portfolio", authorizer = true }
    "POST /v1/portfolio/summary"    = { module_key = "portfolio", authorizer = true }
    "POST /v1/portfolio/allocation" = { module_key = "portfolio", authorizer = true }

    "GET /v1/journal/entries"              = { module_key = "journal", authorizer = true }
    "GET /v1/journal/entries/{entry_id}"   = { module_key = "journal", authorizer = true }
    "PATCH /v1/journal/entries/{entry_id}" = { module_key = "journal", authorizer = true }
    "GET /v1/journal/analytics"            = { module_key = "journal", authorizer = true }
    "POST /v1/journal/entries"             = { module_key = "journal", authorizer = true }

    "GET /v1/pdt/status" = { module_key = "pdt", authorizer = true }

    "POST /v1/scanner/gaps"             = { module_key = "scanner", authorizer = true }
    "POST /v1/scanner/catalysts"        = { module_key = "scanner", authorizer = true }
    "POST /v1/scanner/intraday"         = { module_key = "scanner", authorizer = true }
    "POST /v1/scanner/briefing"         = { module_key = "scanner", authorizer = true }
    "POST /v1/scanner/gap-intelligence" = { module_key = "scanner", authorizer = true }
  }

  http_lambda_integration_keys = distinct([for _, v in local.http_api_route_definitions : v.module_key])
}

resource "aws_apigatewayv2_api" "http" {
  name          = "stocvest-development-http"
  protocol_type = "HTTP"

  cors_configuration {
    allow_credentials = true
    allow_headers     = ["authorization", "content-type", "x-requested-with", "x-stocvest-internal-analysis", "x-stocvest-session-id"]
    allow_methods     = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    allow_origins = [
      "https://stocvest.app",
      "https://www.stocvest.app",
    ]
    max_age = 3600
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-http-api"
  })
}

resource "aws_apigatewayv2_authorizer" "http_jwt" {
  api_id           = aws_apigatewayv2_api.http.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "stocvest-development-cognito-jwt"

  jwt_configuration {
    issuer = trimspace(var.cognito_jwt_issuer) != "" ? var.cognito_jwt_issuer : "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
    audience = trimspace(var.cognito_jwt_audience) != "" ? [var.cognito_jwt_audience] : [
      aws_cognito_user_pool_client.frontend.id,
      aws_cognito_user_pool_client.authorizer.id,
    ]
  }
}

resource "aws_apigatewayv2_integration" "http" {
  for_each = toset(local.http_lambda_integration_keys)

  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api[each.key].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "http" {
  for_each = local.http_api_route_definitions

  api_id    = aws_apigatewayv2_api.http.id
  route_key = each.key
  target    = "integrations/${aws_apigatewayv2_integration.http[each.value.module_key].id}"

  authorization_type = each.value.authorizer ? "JWT" : "NONE"
  authorizer_id      = each.value.authorizer ? aws_apigatewayv2_authorizer.http_jwt.id : null
}

resource "aws_apigatewayv2_stage" "http_default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.http_api_throttling_rate_limit
    throttling_burst_limit = var.http_api_throttling_burst_limit
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-http-stage"
  })
}

resource "aws_lambda_permission" "apigw_http" {
  for_each = toset(local.http_lambda_integration_keys)

  statement_id  = "AllowExecutionFromAPIGatewayHTTP-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

resource "aws_apigatewayv2_api" "websocket" {
  name                       = "stocvest-development-ws"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-websocket-api"
  })
}

resource "aws_apigatewayv2_integration" "websocket" {
  api_id           = aws_apigatewayv2_api.websocket.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.api["websocket"].invoke_arn

  integration_method     = "POST"
  payload_format_version = "1.0"
}

resource "aws_apigatewayv2_route" "websocket_connect" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.websocket.id}"
}

resource "aws_apigatewayv2_route" "websocket_disconnect" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.websocket.id}"
}

resource "aws_apigatewayv2_route" "websocket_default" {
  api_id    = aws_apigatewayv2_api.websocket.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.websocket.id}"
}

resource "aws_apigatewayv2_stage" "websocket_default" {
  api_id      = aws_apigatewayv2_api.websocket.id
  name        = "$default"
  auto_deploy = true

  tags = merge(local.common_tags, {
    Name = "stocvest-development-websocket-stage"
  })
}

resource "aws_lambda_permission" "apigw_websocket" {
  statement_id  = "AllowExecutionFromAPIGatewayWebSocket"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["websocket"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.websocket.execution_arn}/*/*"
}
