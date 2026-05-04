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

# D1 — platform signal history (public + per-user scope via GSI).
resource "aws_dynamodb_table" "signal_history" {
  name         = "SignalHistory"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "signal_id"

  attribute {
    name = "signal_id"
    type = "S"
  }

  attribute {
    name = "scope_key"
    type = "S"
  }

  attribute {
    name = "generated_at"
    type = "S"
  }

  global_secondary_index {
    name            = "scope_generated_at"
    hash_key        = "scope_key"
    range_key       = "generated_at"
    projection_type = "ALL"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-signal-history"
  })
}

# Versioned SignalParameters JSON + audit metadata (monthly tuning).
resource "aws_dynamodb_table" "parameter_history" {
  name         = "ParameterHistory"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "version"

  attribute {
    name = "version"
    type = "S"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-parameter-history"
  })
}

# Trade journal — one item per user; keys match DynamoDBJournalStore (userId + entries).
resource "aws_dynamodb_table" "trade_journal" {
  name         = "TradeJournal"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-trade-journal"
  })
}

# PDT rolling state per user; keys match DynamoDBPDTStateStore (userId, dayTradeDates, pdtExempt).
resource "aws_dynamodb_table" "pdt_state" {
  name         = "PDTState"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-pdt-state"
  })
}

resource "aws_dynamodb_table" "sector_cache" {
  name         = "SectorCache"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "symbol"

  attribute {
    name = "symbol"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-sector-cache"
  })
}

# Model portfolio — notional signal positions + summary (signal tracking / validation).
resource "aws_dynamodb_table" "model_portfolio" {
  name         = "ModelPortfolio"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  attribute {
    name = "status"
    type = "S"
  }
  attribute {
    name = "entry_date"
    type = "S"
  }
  attribute {
    name = "symbol"
    type = "S"
  }

  global_secondary_index {
    name            = "status-entry-index"
    hash_key        = "status"
    range_key       = "entry_date"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "symbol-entry-index"
    hash_key        = "symbol"
    range_key       = "entry_date"
    projection_type = "ALL"
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-model-portfolio"
  })
}
