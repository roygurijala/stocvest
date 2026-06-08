# Build a Linux-compatible Lambda zip on Windows (Python 3.11 / manylinux wheels).
# Usage: .\scripts\build_lambda_package.ps1 [output.zip]
param(
  [string]$Out = "dist/lambda_api.zip"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not [System.IO.Path]::IsPathRooted($Out)) {
  $Out = Join-Path $Root $Out
}
$Pkg = Join-Path ([System.IO.Path]::GetTempPath()) ("lambda-build-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $Pkg -Force | Out-Null

$Platform = "manylinux2014_x86_64"
$PyVer = "3.11"
$RuntimePkgs = @(
  "redis>=5.0", "upstash-redis>=1.2.0", "httpx>=0.27", "websockets>=12.0",
  "pandas>=2.2", "numpy>=1.26,<2", "boto3>=1.34", "python-dotenv>=1.0",
  "pydantic>=2.6", "anyio>=4.3", "PyJWT>=2.8", "pydantic-settings>=2.2"
)

try {
  pip install $RuntimePkgs -t $Pkg --platform $Platform --python-version $PyVer --implementation cp --only-binary=:all: --no-cache-dir --upgrade
  pip install $Root --no-deps -t $Pkg --no-cache-dir --upgrade
  'from stocvest.api.lambda_dispatch import lambda_handler' | Set-Content -Path (Join-Path $Pkg "handler.py") -NoNewline
  New-Item -ItemType Directory -Path (Split-Path $Out) -Force | Out-Null
  if (Test-Path $Out) { Remove-Item $Out -Force }
  python -c @"
import os, zipfile
root = r'$Pkg'
out = r'$Out'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for dirpath, _, files in os.walk(root):
        for f in files:
            p = os.path.join(dirpath, f)
            z.write(p, os.path.relpath(p, root))
"@
  $so = Join-Path $Pkg "pydantic_core\_pydantic_core.cpython-311-x86_64-linux-gnu.so"
  if (-not (Test-Path $so)) {
    throw "Missing Linux pydantic_core binary — zip is not Lambda-compatible."
  }
  Write-Host "Wrote $Out ($((Get-Item $Out).Length) bytes)"
}
finally {
  Remove-Item $Pkg -Recurse -Force -ErrorAction SilentlyContinue
}
