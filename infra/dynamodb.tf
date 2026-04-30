# Contract table names: docs/CONTEXT.md — Immutable Contracts (DynamoDB).

resource "aws_dynamodb_table" "users" {
  name         = "Users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-users"
  })
}

resource "aws_dynamodb_table" "broker_connections" {
  name         = "BrokerConnections"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "brokerId"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "brokerId"
    type = "S"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-broker-connections"
  })
}

resource "aws_dynamodb_table" "watchlists" {
  name         = "Watchlists"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "watchlistId"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "watchlistId"
    type = "S"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-watchlists"
  })
}

resource "aws_dynamodb_table" "alerts" {
  name         = "Alerts"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "alertId"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "alertId"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-alerts"
  })
}

resource "aws_dynamodb_table" "orders" {
  name         = "Orders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "orderId"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "orderId"
    type = "S"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-orders"
  })
}

resource "aws_dynamodb_table" "day_trading_setups" {
  name         = "DayTradingSetups"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "accountId"
  range_key    = "setupKey"

  attribute {
    name = "accountId"
    type = "S"
  }

  attribute {
    name = "setupKey"
    type = "S"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-day-trading-setups"
  })
}
