# Phase 6g — EventBridge *Scheduler* (cron with America/New_York) → scanner Lambda.
# Uses EventBridge Scheduler (not legacy UTC-only EventBridge cron) so EST/EDT track correctly.

resource "aws_scheduler_schedule_group" "scanner" {
  name = "stocvest-development-scanner"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-scanner-schedule-group"
  })
}

resource "aws_iam_role" "eventbridge_scanner_invoke" {
  name = "stocvest-development-eventbridge-scanner-invoke"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "scheduler.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-scanner-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_scanner_invoke_lambda" {
  name = "stocvest-development-invoke-scanner-lambda"
  role = aws_iam_role.eventbridge_scanner_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["scanner"].arn
    }]
  })
}

# Rule 1: 8:00 AM America/New_York, Mon–Fri (pre-market scan).
resource "aws_scheduler_schedule" "scanner_premarket" {
  name       = "stocvest-development-scanner-premarket"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 8 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "premarket"
    })
  }
}

# Rule 2a: 9:30–9:55 AM ET Mon–Fri (five-minute cadence within the 9 o’clock hour).
resource "aws_scheduler_schedule" "scanner_intraday_morning" {
  name       = "stocvest-development-scanner-intraday-morning"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(30,35,40,45,50,55 9 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "intraday"
    })
  }
}

# Rule 2b: 10:00 AM–3:55 PM ET Mon–Fri every 5 minutes (hours 10–15 in local wall time).
resource "aws_scheduler_schedule" "scanner_intraday_day" {
  name       = "stocvest-development-scanner-intraday-day"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0/5 10-15 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "intraday"
    })
  }
}

# Rule 2c: 4:00 PM ET Mon–Fri (last intraday tick; hours 10–15 cover through 3:55 only).
resource "aws_scheduler_schedule" "scanner_intraday_close" {
  name       = "stocvest-development-scanner-intraday-close"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 16 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "intraday"
    })
  }
}

# Rule 3: 3:45 PM America/New_York Mon–Fri (EOD summary).
resource "aws_scheduler_schedule" "scanner_eod" {
  name       = "stocvest-development-scanner-eod"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(45 15 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "eod_summary"
    })
  }
}

# Watchlist maturation batch refresh (8:15 swing / 9:35 day / 4:30 EOD) removed — per-user refresh on
# Dashboard/Watchlists login and row Refresh (see frontend watchlist-session-refresh).

# 3:55 PM ET — validation ledger capture inside day RTH (≤15:59) and swing post-close window (≥15:50).
resource "aws_scheduler_schedule" "scanner_ledger_capture" {
  name       = "stocvest-development-scanner-ledger-capture"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(55 15 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "ledger_capture"
    })
  }
}

# Opportunity Desk — full batch (funnel + bounded composite) pre-open + mid-session.
resource "aws_scheduler_schedule" "scanner_opportunity_desk_premarket" {
  name       = "stocvest-development-scanner-opportunity-desk-premarket"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 8 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "opportunity_desk"
    })
  }
}

resource "aws_scheduler_schedule" "scanner_opportunity_desk_midday" {
  name       = "stocvest-development-scanner-opportunity-desk-10"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 10,12,14 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "opportunity_desk"
    })
  }
}

# Tier B — movers radar only (snapshot math), every 15 minutes during RTH.
resource "aws_scheduler_schedule" "scanner_opportunity_desk_movers" {
  name       = "stocvest-development-scanner-opportunity-desk-movers"
  group_name = aws_scheduler_schedule_group.scanner.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0/15 9-15 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["scanner"].arn
    role_arn = aws_iam_role.eventbridge_scanner_invoke.arn
    input = jsonencode({
      source    = "eventbridge"
      scan_type = "opportunity_desk_movers"
    })
  }
}

resource "aws_lambda_permission" "scanner_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridgeScheduler"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["scanner"].function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.scanner.name}/*"
}

# ── Geo themes (Perplexity → Redis) Mon–Fri ─────────────────────────────────

resource "aws_scheduler_schedule_group" "geo_themes" {
  name = "stocvest-development-geo-themes"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-geo-themes-schedule-group"
  })
}

resource "aws_iam_role" "eventbridge_geo_themes_invoke" {
  name = "stocvest-development-eventbridge-geo-themes-invoke"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "scheduler.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-geo-themes-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_geo_themes_invoke_lambda" {
  name = "stocvest-development-invoke-geo-themes-lambda"
  role = aws_iam_role.eventbridge_geo_themes_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["geo_themes"].arn
    }]
  })
}

resource "aws_scheduler_schedule" "geo_themes_updater" {
  name       = "stocvest-geo-themes-updater"
  group_name = aws_scheduler_schedule_group.geo_themes.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(45 12 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["geo_themes"].arn
    role_arn = aws_iam_role.eventbridge_geo_themes_invoke.arn
    input = jsonencode({
      action = "update_geo_themes"
    })
  }
}

resource "aws_lambda_permission" "geo_themes_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridgeSchedulerGeoThemes"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["geo_themes"].function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.geo_themes.name}/*"
}

# ── ORB daily artifact (9:30–10:00 ET window closes → persist highs/lows) ─────────

resource "aws_scheduler_schedule_group" "orb_compute" {
  name = "stocvest-development-orb-compute"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-orb-compute-schedule-group"
  })
}

resource "aws_iam_role" "eventbridge_orb_compute_invoke" {
  name = "stocvest-development-eventbridge-orb-compute-invoke"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "scheduler.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-orb-compute-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_orb_compute_invoke_lambda" {
  name = "stocvest-development-invoke-orb-compute-lambda"
  role = aws_iam_role.eventbridge_orb_compute_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["orb_compute"].arn
    }]
  })
}

resource "aws_scheduler_schedule" "orb_compute" {
  name       = "stocvest-orb-compute"
  group_name = aws_scheduler_schedule_group.orb_compute.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 10 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["orb_compute"].arn
    role_arn = aws_iam_role.eventbridge_orb_compute_invoke.arn
    input = jsonencode({
      action = "compute_orb"
    })
  }
}

resource "aws_lambda_permission" "orb_compute_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridgeSchedulerOrbCompute"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["orb_compute"].function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.orb_compute.name}/*"
}

# ── Macro cache warmer (7:30 AM America/New_York Mon–Fri) → macro_warmer Lambda ─────────

resource "aws_scheduler_schedule_group" "macro_cache" {
  name = "stocvest-development-macro-cache"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-macro-cache-schedule-group"
  })
}

resource "aws_iam_role" "eventbridge_macro_cache_invoke" {
  name = "stocvest-development-eventbridge-macro-cache-invoke"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "scheduler.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-macro-cache-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_macro_cache_invoke_lambda" {
  name = "stocvest-development-invoke-macro-warmer-lambda"
  role = aws_iam_role.eventbridge_macro_cache_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["macro_warmer"].arn
    }]
  })
}

resource "aws_scheduler_schedule" "macro_cache_warmer" {
  name       = "stocvest-macro-cache-warmer"
  group_name = aws_scheduler_schedule_group.macro_cache.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(30 7 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["macro_warmer"].arn
    role_arn = aws_iam_role.eventbridge_macro_cache_invoke.arn
    input    = jsonencode({ source = "eventbridge", job = "macro_cache_warm" })
  }
}

resource "aws_lambda_permission" "macro_cache_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridgeSchedulerMacroCache"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["macro_warmer"].function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.macro_cache.name}/*"
}

# ── Market pulse refresher (every minute 9:00–16:59 ET Mon–Fri; Lambda skips outside RTH) ───

resource "aws_scheduler_schedule_group" "market_pulse" {
  name = "stocvest-development-market-pulse"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-market-pulse-schedule-group"
  })
}

resource "aws_iam_role" "eventbridge_market_pulse_invoke" {
  name = "stocvest-development-eventbridge-market-pulse-invoke"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "scheduler.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-market-pulse-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_market_pulse_invoke_lambda" {
  name = "stocvest-development-invoke-market-pulse-refresher-lambda"
  role = aws_iam_role.eventbridge_market_pulse_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["market_pulse_refresher"].arn
    }]
  })
}

resource "aws_scheduler_schedule" "market_pulse_refresher" {
  name       = "stocvest-market-pulse-refresher"
  group_name = aws_scheduler_schedule_group.market_pulse.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0/1 9-16 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["market_pulse_refresher"].arn
    role_arn = aws_iam_role.eventbridge_market_pulse_invoke.arn
    input    = jsonencode({ source = "eventbridge", job = "market_pulse_refresh" })
  }
}

resource "aws_lambda_permission" "market_pulse_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridgeSchedulerMarketPulse"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["market_pulse_refresher"].function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.market_pulse.name}/*"
}

# ── Sector daily Redis cache warmer (sector ETF vs SPY daily relative returns) ──────────────

resource "aws_scheduler_schedule_group" "sector_daily_cache" {
  name = "stocvest-development-sector-daily-cache"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-sector-daily-cache-schedule-group"
  })
}

resource "aws_iam_role" "eventbridge_sector_daily_cache_invoke" {
  name = "stocvest-development-eventbridge-sector-daily-cache-invoke"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "scheduler.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = merge(local.common_tags, {
    Name = "stocvest-development-eventbridge-sector-daily-cache-invoke-role"
  })
}

resource "aws_iam_role_policy" "eventbridge_sector_daily_cache_invoke_lambda" {
  name = "stocvest-development-invoke-sector-daily-cache-lambda"
  role = aws_iam_role.eventbridge_sector_daily_cache_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.api["sector_daily_cache"].arn
    }]
  })
}

# 4:30 PM ET after close — full 5-session relative returns (hours are local NY).
resource "aws_scheduler_schedule" "sector_daily_cache_close" {
  name       = "stocvest-sector-daily-close"
  group_name = aws_scheduler_schedule_group.sector_daily_cache.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(30 16 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["sector_daily_cache"].arn
    role_arn = aws_iam_role.eventbridge_sector_daily_cache_invoke.arn
    input    = jsonencode({ action = "update_sector_daily_cache" })
  }
}

# Pre-market refresher (~7:45 AM ET): warm Redis before composite traffic.
resource "aws_scheduler_schedule" "sector_daily_cache_premarket" {
  name       = "stocvest-sector-daily-premarket"
  group_name = aws_scheduler_schedule_group.sector_daily_cache.name

  state = "ENABLED"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(45 7 ? * MON-FRI *)"
  schedule_expression_timezone = "America/New_York"

  target {
    arn      = aws_lambda_function.api["sector_daily_cache"].arn
    role_arn = aws_iam_role.eventbridge_sector_daily_cache_invoke.arn
    input    = jsonencode({ action = "update_sector_daily_cache" })
  }
}

resource "aws_lambda_permission" "sector_daily_cache_eventbridge_scheduler" {
  statement_id  = "AllowExecutionFromEventBridgeSchedulerSectorDailyCache"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api["sector_daily_cache"].function_name
  principal     = "scheduler.amazonaws.com"
  source_arn    = "arn:aws:scheduler:${var.aws_region}:${data.aws_caller_identity.current.account_id}:schedule/${aws_scheduler_schedule_group.sector_daily_cache.name}/*"
}
