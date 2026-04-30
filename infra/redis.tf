# Phase 6c — ElastiCache Redis (single primary, development; not multi-AZ).

resource "aws_elasticache_subnet_group" "redis" {
  name       = "stocvest-development-redis-subnet"
  subnet_ids = [for subnet in aws_subnet.private : subnet.id]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-redis-subnet-group"
  })
}

resource "aws_elasticache_parameter_group" "redis" {
  name        = "stocvest-development-redis7"
  family      = "redis7"
  description = "STOCVEST development Redis 7.x parameters"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-redis-parameter-group"
  })
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "stocvest-dev-redis"
  description          = "STOCVEST development single-node Redis 7.x"

  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t3.micro"
  num_cache_clusters   = 1
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.redis.name
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [aws_security_group.data.id]

  automatic_failover_enabled = false
  multi_az_enabled           = false

  at_rest_encryption_enabled = false
  transit_encryption_enabled = false
  apply_immediately          = true
  snapshot_retention_limit   = 0
  maintenance_window         = "sun:05:00-sun:06:00"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-redis"
  })
}
