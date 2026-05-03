# Run fmt check, local init, and validate. The AWS provider needs a known region
# during validate when tfvars is not loaded; default matches variables.tf aws_region default.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
if (-not $env:AWS_REGION -and -not $env:AWS_DEFAULT_REGION) {
    $env:AWS_DEFAULT_REGION = "us-east-1"
}
terraform fmt -check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
terraform init -backend=false -input=false
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
terraform validate
