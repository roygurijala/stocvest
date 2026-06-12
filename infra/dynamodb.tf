# Contract table names: docs/CONTEXT.md — Immutable Contracts (DynamoDB).

resource "aws_dynamodb_table" "users" {
  name         = "Users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"

  attribute {
    name = "userId"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
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

# Per-(user, symbol, mode) maturation state; see docs/WATCHLIST_MATURATION_ARCH.md.
resource "aws_dynamodb_table" "watchlist_maturation" {
  name         = "WatchlistMaturation"
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
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "UserStateIndex"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-watchlist-maturation"
  })
}

# Append-only setup evolution log (state / alignment transitions); 90d TTL.
resource "aws_dynamodb_table" "watchlist_maturation_transition" {
  name         = "WatchlistMaturationTransition"
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
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "ModeTimelineIndex"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-watchlist-maturation-transition"
  })
}

# Platform-level setup evolution (symbol + mode; no user association); 90d TTL.
resource "aws_dynamodb_table" "system_signal_transition" {
  name         = "SystemSignalTransition"
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
    name = "gsi1pk"
    type = "S"
  }
  attribute {
    name = "gsi1sk"
    type = "S"
  }

  global_secondary_index {
    name            = "ModeTimelineIndex"
    hash_key        = "gsi1pk"
    range_key       = "gsi1sk"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-system-signal-transition"
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

# D10 Phase 1 — candidate parameter rotations awaiting admin review.
#
# Written by the (Phase 2, separate Lambda) weekly weight-proposer optimizer
# and promoted to live weights by the (Phase 3, separate API surface) admin
# endpoint that wraps `ParameterStore.save_parameters_sync()`. This table is
# *separate* from `ParameterHistory` on purpose:
#
#   * `ParameterHistory` is the audit log of weights that actually went live.
#     Every row there reflects a real production-state transition; consumers
#     (`docs/TUNING_PLAYBOOK.md`, the D2 cross-version diff view) treat it
#     as a clean linear timeline.
#   * `ParameterProposal` is the candidate pipeline. Most rows here will be
#     rejected or superseded; mixing them into `ParameterHistory` would
#     pollute the live-rotation timeline.
#
# GSI `status_index` lets the admin UI list pending proposals sorted by
# `created_at` DESC (newest first) without scanning the full table. TTL is
# enabled on the `ttl` attribute so old rejected/superseded proposals
# auto-expire after the Phase-1 default 90-day window — operators can still
# query promoted proposals long-term by deliberately omitting the TTL.
resource "aws_dynamodb_table" "parameter_proposal" {
  name         = "ParameterProposal"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "proposal_id"

  attribute {
    name = "proposal_id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "status_index"
    hash_key        = "status"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-parameter-proposal"
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

# HTTP/API replay audit — pk user#{userId|anon}, sk {iso}#{eventId}; see stocvest/api/services/audit_store.py.
resource "aws_dynamodb_table" "audit_events" {
  name         = "AuditEvents"
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

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-audit-events"
  })
}

# Gap Intelligence read-through snapshot cache (symbol#mode#ET-session-date → JSON payload).
resource "aws_dynamodb_table" "gap_intel_cache" {
  name         = "GapIntelCache"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "cacheKey"

  attribute {
    name = "cacheKey"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-gap-intel-cache"
  })
}

# B33 — per-user scanner evaluation trace (userId × trace#desk#ET-session-date); 48h TTL.
resource "aws_dynamodb_table" "scanner_evaluation_trace" {
  name         = "ScannerEvaluationTrace"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "userId"
  range_key    = "sk"

  attribute {
    name = "userId"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-ddb-scanner-evaluation-trace"
  })
}
