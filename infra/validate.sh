#!/usr/bin/env bash
# Run fmt check, local init, and validate. The AWS provider needs a known region
# during validate when tfvars is not loaded; default matches variables.tf aws_region default.
set -euo pipefail
cd "$(dirname "$0")"
if [[ -z "${AWS_REGION:-}" && -z "${AWS_DEFAULT_REGION:-}" ]]; then
  export AWS_DEFAULT_REGION="us-east-1"
fi
terraform fmt -check
terraform init -backend=false -input=false
terraform validate
