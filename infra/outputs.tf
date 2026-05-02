output "vpc_id" {
  description = "ID of the STOCVEST VPC."
  value       = aws_vpc.stocvest.id
}

output "public_subnet_ids" {
  description = "IDs of public subnets."
  value       = [for subnet in aws_subnet.public : subnet.id]
}

output "private_subnet_ids" {
  description = "IDs of private subnets."
  value       = [for subnet in aws_subnet.private : subnet.id]
}

output "app_security_group_id" {
  description = "App tier security group ID."
  value       = aws_security_group.app.id
}

output "data_security_group_id" {
  description = "Data tier security group ID."
  value       = aws_security_group.data.id
}

output "nat_gateway_id" {
  description = "ID of the NAT gateway for private subnet egress."
  value       = aws_nat_gateway.stocvest.id
}

output "dynamodb_table_names" {
  description = "DynamoDB table names (Phase 6b contract names)."
  value = {
    users              = aws_dynamodb_table.users.name
    broker_connections = aws_dynamodb_table.broker_connections.name
    watchlists         = aws_dynamodb_table.watchlists.name
    alerts             = aws_dynamodb_table.alerts.name
    orders             = aws_dynamodb_table.orders.name
    day_trading_setups = aws_dynamodb_table.day_trading_setups.name
    signal_history     = aws_dynamodb_table.signal_history.name
    trade_journal      = aws_dynamodb_table.trade_journal.name
    pdt_state          = aws_dynamodb_table.pdt_state.name
  }
}

output "dynamodb_table_arns" {
  description = "DynamoDB table ARNs."
  value = {
    users              = aws_dynamodb_table.users.arn
    broker_connections = aws_dynamodb_table.broker_connections.arn
    watchlists         = aws_dynamodb_table.watchlists.arn
    alerts             = aws_dynamodb_table.alerts.arn
    orders             = aws_dynamodb_table.orders.arn
    day_trading_setups = aws_dynamodb_table.day_trading_setups.arn
    signal_history     = aws_dynamodb_table.signal_history.arn
    trade_journal      = aws_dynamodb_table.trade_journal.arn
    pdt_state          = aws_dynamodb_table.pdt_state.arn
  }
}

output "elasticache_redis_primary_endpoint_address" {
  description = "Primary Redis endpoint (hostname) for Lambda REDIS_URL host segment."
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "elasticache_redis_port" {
  description = "Redis port (default 6379)."
  value       = aws_elasticache_replication_group.redis.port
}

output "elasticache_redis_url" {
  description = "Suggested non-TLS Redis URL for development (redis://host:port/0). Build from outputs if you prefer TLS later."
  value       = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:${aws_elasticache_replication_group.redis.port}/0"
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN (Fargate) for IBKR/TWS."
  value       = aws_ecs_cluster.development.arn
}

output "ecs_tws_task_definition_arn" {
  description = "Fargate task definition ARN for ibeam/TWS (paper gateway port 4002)."
  value       = aws_ecs_task_definition.tws.arn
}

output "api_gateway_http_invoke_url" {
  description = "HTTP API base URL (append /v1/... routes)."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "api_gateway_websocket_callback_url" {
  description = "WebSocket API URL (use wss:// scheme in clients if api_endpoint is https://)."
  value       = aws_apigatewayv2_api.websocket.api_endpoint
}

output "api_gateway_websocket_management_url" {
  description = "HTTPS base URL for API Gateway Management API (post_to_connection); wired to scanner Lambda as STOCVEST_WS_MANAGEMENT_API_URL."
  value       = "https://${aws_apigatewayv2_api.websocket.id}.execute-api.${var.aws_region}.amazonaws.com/${aws_apigatewayv2_stage.websocket_default.name}"
}

output "cognito_user_pool_id" {
  description = "Cognito user pool id (Next.js / Lambda config)."
  value       = aws_cognito_user_pool.main.id
}

output "cognito_user_pool_arn" {
  description = "Cognito user pool ARN."
  value       = aws_cognito_user_pool.main.arn
}

output "cognito_user_pool_client_frontend_id" {
  description = "App client id for Next.js SPA (no secret)."
  value       = aws_cognito_user_pool_client.frontend.id
}

output "cognito_user_pool_client_authorizer_id" {
  description = "App client id reserved for Lambda authorizer flows (no secret)."
  value       = aws_cognito_user_pool_client.authorizer.id
}

output "cognito_jwt_issuer" {
  description = "JWT issuer URL for API Gateway / OIDC clients (same as wired into HTTP API when tfvars overrides are empty)."
  value       = "https://cognito-idp.${var.aws_region}.amazonaws.com/${aws_cognito_user_pool.main.id}"
}
