"""Run credential-gated broker sandbox integration tests with readiness checks."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys

from dotenv import load_dotenv

load_dotenv()


REQUIRED_FOR_RUN = {
    "STOCVEST_ENABLE_SANDBOX_INTEGRATION": "Must be set to 1 to enable live integration tests.",
}

RECOMMENDED = {
    "STOCVEST_IBKR_GATEWAY": "Gateway binding/plugin marker for IBKR integration harness.",
    "STOCVEST_ETRADE_GATEWAY": "Gateway binding/plugin marker for E*TRADE integration harness.",
    "ETRADE_CONSUMER_KEY": "Consumer key used by E*TRADE OAuth flows.",
    "ETRADE_CONSUMER_SECRET": "Consumer secret used by E*TRADE OAuth flows.",
}


def _print_status(name: str, present: bool, required: bool, hint: str) -> None:
    tag = "OK" if present else ("MISSING" if required else "WARN")
    print(f"[{tag}] {name}")
    if not present:
        print(f"      {hint}")


def _check_env() -> tuple[bool, list[str]]:
    missing_required: list[str] = []
    print("Sandbox integration readiness\n")
    print("Required")
    for key, hint in REQUIRED_FOR_RUN.items():
        val = os.getenv(key)
        present = bool(val)
        if key == "STOCVEST_ENABLE_SANDBOX_INTEGRATION":
            present = val == "1"
        _print_status(key, present, True, hint)
        if not present:
            missing_required.append(key)

    print("\nRecommended")
    for key, hint in RECOMMENDED.items():
        _print_status(key, bool(os.getenv(key)), False, hint)
    return (len(missing_required) == 0, missing_required)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate env and run pytest sandbox integration tests."
    )
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Only validate environment; do not execute pytest.",
    )
    parser.add_argument(
        "--pytest-args",
        default="tests/brokers/test_sandbox_integration.py -m integration -v",
        help="Arguments passed to `python -m pytest`.",
    )
    args = parser.parse_args()

    ready, missing = _check_env()
    if not ready:
        print("\nCannot run integration tests until required variables are configured.")
        print(f"Missing required: {', '.join(missing)}")
        return 2

    if args.check_only:
        print("\nEnvironment check complete.")
        return 0

    cmd = [sys.executable, "-m", "pytest", *args.pytest_args.split()]
    print("\nExecuting:", " ".join(cmd))
    result = subprocess.run(cmd, check=False)
    return int(result.returncode)


if __name__ == "__main__":
    raise SystemExit(main())

