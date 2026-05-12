# Phase 6e — API Gateway HTTP API (/v1/*) + WebSocket API ($connect / $disconnect / $default).

locals {
  http_api_route_definitions = {
    "GET /v1/health" = { module_key = "health", authorizer = false }

    "GET /v1/market/status"         = { module_key = "market_data", authorizer = true }
    "GET /v1/market/macro-context"  = { module_key = "market_data", authorizer = true }
    "GET /v1/market/snapshot"       = { module_key = "market_data", authorizer = true }
    "GET /v1/market/snapshots"      = { module_key = "market_data", authorizer = true }
    "GET /v1/market/tickers-search" = { module_key = "market_data", authorizer = true }
    "GET /v1/market/bars"           = { module_key = "market_data", authorizer = true }
    "POST /v1/market/bars-batch"    = { module_key = "market_data", authorizer = true }
    "GET /v1/market/news"           = { module_key = "market_data", authorizer = true }
    "GET /v1/market/options"        = { module_key = "market_data", authorizer = true }
    "GET /v1/market/earnings"       = { module_key = "market_data", authorizer = true }

    "POST /v1/signals/ai/explanations"       = { module_key = "signals", authorizer = true }
    "POST /v1/signals/assistant/chat"        = { module_key = "signals", authorizer = true }
    "POST /v1/public/assistant/chat"         = { module_key = "signals", authorizer = false }
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
    # D2 Historical Signal Validation — Phase 3a backend surface. Auth-required; every
    # query is scoped to the calling user via `rc.user_id` so one tenant cannot read
    # another tenant's tracked outcomes. The eventual public `/performance` mirror gets
    # its own unauthenticated route, not a widened version of this one.
    "GET /v1/signals/historical-validation/summary"        = { module_key = "signals", authorizer = true }
    "GET /v1/signals/historical-validation/public-summary" = { module_key = "signals", authorizer = false }

    # D10 Phase 3a — admin proposal-review surface. All four routes require
    # the authorizer; admin gating happens inside the handlers via
    # `analysis_authorized()` (same gate as PATCH /v1/admin/users/{user_id}/beta-access
    # and GET /v1/admin/audit/*). Promotion is the ONLY production code
    # path that mutates the live `stocvest/signal-parameters` Secrets
    # Manager secret under admin authority; that's the entire reason
    # D10 exists.
    "GET /v1/admin/proposals"                        = { module_key = "signals", authorizer = true }
    "GET /v1/admin/proposals/{proposal_id}"          = { module_key = "signals", authorizer = true }
    "POST /v1/admin/proposals/{proposal_id}/promote" = { module_key = "signals", authorizer = true }
    "POST /v1/admin/proposals/{proposal_id}/reject"  = { module_key = "signals", authorizer = true }

    # D10 Phase 4 — admin parameter-rollback surface. Same admin gate
    # (`analysis_authorized()`) as the proposal review routes; same atomic
    # write primitive (`ParameterStore.save_parameters_sync`) so promotion
    # and rollback both write honest `ParameterHistory` audit rows. The
    # rollback button is the operator's one-click answer to the CloudWatch
    # post-rotation degradation alarm.
    "GET /v1/admin/parameters/history"   = { module_key = "signals", authorizer = true }
    "POST /v1/admin/parameters/rollback" = { module_key = "signals", authorizer = true }

    # D10 Admin Hub — operational maintenance surface. Read-only
    # endpoints (`parameters/current`, `system-status`, `audit/recent`)
    # and Cognito-backed user management. Every route is gated by
    # `analysis_authorized()` inside the handler; admins get full app
    # access via the JWT group claim (no DynamoDB admin flag).
    "GET /v1/admin/parameters/current" = { module_key = "signals", authorizer = true }
    "GET /v1/admin/system-status"      = { module_key = "signals", authorizer = true }
    "GET /v1/admin/audit/recent"       = { module_key = "brokers", authorizer = true }

    "GET /v1/admin/users/search"                      = { module_key = "brokers", authorizer = true }
    "GET /v1/admin/users/{user_id}"                   = { module_key = "brokers", authorizer = true }
    "POST /v1/admin/users/{user_id}/reset-password"   = { module_key = "brokers", authorizer = true }
    "POST /v1/admin/users/{user_id}/groups/{group}"   = { module_key = "brokers", authorizer = true }
    "DELETE /v1/admin/users/{user_id}/groups/{group}" = { module_key = "brokers", authorizer = true }

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
  # HTTP API hard cap (30000 ms); heavy handlers must finish within this window.
  timeout_milliseconds = 30000
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
