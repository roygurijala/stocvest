locals {
  common_tags = {
    project = "stocvest"
    env     = "development"
  }
}

resource "aws_vpc" "stocvest" {
  cidr_block           = var.vpc_cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, {
    Name = "stocvest-development-vpc"
  })
}

resource "aws_internet_gateway" "stocvest" {
  vpc_id = aws_vpc.stocvest.id

  tags = merge(local.common_tags, {
    Name = "stocvest-development-igw"
  })
}

resource "aws_subnet" "public" {
  for_each = {
    for index, cidr in var.public_subnet_cidr_blocks :
    index => cidr
  }

  vpc_id                  = aws_vpc.stocvest.id
  cidr_block              = each.value
  availability_zone       = var.availability_zones[tonumber(each.key)]
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "stocvest-development-public-${each.key}"
    tier = "public"
  })
}

resource "aws_subnet" "private" {
  for_each = {
    for index, cidr in var.private_subnet_cidr_blocks :
    index => cidr
  }

  vpc_id            = aws_vpc.stocvest.id
  cidr_block        = each.value
  availability_zone = var.availability_zones[tonumber(each.key)]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-private-${each.key}"
    tier = "private"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.stocvest.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.stocvest.id
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_eip" "nat" {
  domain = "vpc"

  tags = merge(local.common_tags, {
    Name = "stocvest-development-nat-eip"
  })
}

resource "aws_nat_gateway" "stocvest" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[sort(keys(aws_subnet.public))[0]].id

  depends_on = [aws_internet_gateway.stocvest]

  tags = merge(local.common_tags, {
    Name = "stocvest-development-nat-gateway"
  })
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.stocvest.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.stocvest.id
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-private-rt"
  })
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "app" {
  name        = "stocvest-development-app-sg"
  description = "App-tier security group for STOCVEST development."
  vpc_id      = aws_vpc.stocvest.id

  ingress {
    description = "HTTPS ingress"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_ingress_cidrs
  }

  ingress {
    description = "IBKR paper gateway / TWS API from within VPC only"
    from_port   = 4002
    to_port     = 4002
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr_block]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-app-sg"
  })
}

resource "aws_security_group" "data" {
  name        = "stocvest-development-data-sg"
  description = "Data-tier security group for STOCVEST development."
  vpc_id      = aws_vpc.stocvest.id

  ingress {
    description     = "App tier to data tier"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  ingress {
    description     = "App tier to PostgreSQL"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "stocvest-development-data-sg"
  })
}
