<#
.SYNOPSIS
  Build and push the STOCVEST news-worker container image to ECR (Tier 3 of B74).

.DESCRIPTION
  Builds docker/news_worker/Dockerfile (build context = repo root, which the Dockerfile
  expects so it can COPY pyproject.toml + stocvest/), logs in to ECR, tags, and pushes.
  Prints the full image URI to set as `news_worker_container_image` in terraform.tfvars.

  Prereqs: Docker Desktop running, AWS CLI v2 configured with push rights, and the ECR
  repo created first (`terraform apply` creates `stocvest-news-worker` — see ecs_news_worker.tf).

.PARAMETER AccountId
  AWS account id (12 digits). Required.

.PARAMETER Region
  AWS region. Default: us-east-1.

.PARAMETER Tag
  Image tag. Default: latest. Prefer an immutable tag (e.g. a git SHA) for real deploys.

.EXAMPLE
  ./scripts/build_push_news_worker.ps1 -AccountId 123456789012 -Region us-east-1 -Tag latest
#>
param(
    [Parameter(Mandatory = $true)][string]$AccountId,
    [string]$Region = "us-east-1",
    [string]$Tag = "latest",
    [string]$Repo = "stocvest-news-worker"
)

$ErrorActionPreference = "Stop"

# Repo root = parent of this script's folder, so the Docker build context is correct.
$RepoRoot = Split-Path -Parent $PSScriptRoot
$Registry = "$AccountId.dkr.ecr.$Region.amazonaws.com"
$ImageUri = "$Registry/$Repo`:$Tag"

Write-Host "Building $ImageUri from $RepoRoot ..." -ForegroundColor Cyan

aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $Registry
if ($LASTEXITCODE -ne 0) { throw "ECR login failed" }

docker build -f "$RepoRoot/docker/news_worker/Dockerfile" -t "$Repo`:$Tag" $RepoRoot
if ($LASTEXITCODE -ne 0) { throw "docker build failed" }

docker tag "$Repo`:$Tag" $ImageUri
docker push $ImageUri
if ($LASTEXITCODE -ne 0) { throw "docker push failed" }

Write-Host ""
Write-Host "Pushed: $ImageUri" -ForegroundColor Green
Write-Host "Next: set in terraform.tfvars then apply:" -ForegroundColor Yellow
Write-Host "  news_worker_container_image = `"$ImageUri`""
Write-Host "  news_worker_desired_count   = 1"
