#!/usr/bin/env python3
"""Load SignalParameters JSON, bump version in Secrets Manager, and write ParameterHistory row."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from stocvest.config.parameter_store import ParameterStore, signal_parameters_from_dict


def main() -> None:
    p = argparse.ArgumentParser(description="Update stocvest/signal-parameters in Secrets Manager.")
    p.add_argument("--reason", required=True, help="Audit note stored on the new parameter version.")
    p.add_argument(
        "--json-path",
        default="",
        help="Path to JSON file with full SignalParameters object; if omitted, loads current then re-saves bump only.",
    )
    p.add_argument("--signal-count", type=int, default=None)
    p.add_argument("--accuracy-before", type=float, default=None)
    args = p.parse_args()

    if args.json_path:
        raw = json.loads(Path(args.json_path).read_text(encoding="utf-8"))
        params = signal_parameters_from_dict(raw if isinstance(raw, dict) else {})
    else:
        params = asyncio.run(ParameterStore.get_parameters())

    ok = asyncio.run(
        ParameterStore.save_parameters(
            params,
            args.reason,
            signal_count_on_change=args.signal_count,
            accuracy_before_change=args.accuracy_before,
        )
    )
    if not ok:
        sys.exit(1)
    print("Parameters saved.")


if __name__ == "__main__":
    main()
