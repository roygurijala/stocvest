terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  # Backend: `bucket` and `key` must appear here so `terraform validate` succeeds.
  # `terraform init -backend-config backend.hcl` merges region, encrypt, use_lockfile, etc.
  # Override `bucket` / `key` in backend.hcl if this workspace uses different state storage.
  backend "s3" {
    bucket = "stocvest-terraform-state"
    key    = "stocvest/development/terraform.tfstate"
  }
}
