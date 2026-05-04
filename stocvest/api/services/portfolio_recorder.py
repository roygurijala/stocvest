"""Model portfolio persistence — notional signal positions and summary (DynamoDB)."""

from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

import boto3
from botocore.exceptions import ClientError

from stocvest.data.models import (
    ExitReason,
    ModelPortfolioPosition,
    PositionOutcome,
    PositionStatus,
    SignalStrength,
)

log = logging.getLogger(__name__)

TABLE_NAME = os.environ.get("DYNAMODB_MODEL_PORTFOLIO_TABLE", "ModelPortfolio")
PORTFOLIO_PK = "PORTFOLIO#v1"
PORTFOLIO_VERSION = "v1"
PORTFOLIO_NOTIONAL = 100_000.0

SIGNAL_SIZE_MAP = {
    "moderate": 5_000.0,
    "strong": 7_000.0,
    "very_strong": 9_000.0,
}
CONFLUENCE_BONUS = 1_000.0
STOP_LOSS_PCT = 0.07
TARGET_PCT = 0.15
MIN_SIGNAL_SCORE = 72
MAX_OPEN_POSITIONS = 10


def _signal_strength_from_score(score: int) -> SignalStrength:
    if score >= 90:
        return SignalStrength.VERY_STRONG
    if score >= 80:
        return SignalStrength.STRONG
    return SignalStrength.MODERATE


def _strength_key(score: int) -> str:
    if score >= 90:
        return "very_strong"
    if score >= 80:
        return "strong"
    return "moderate"


def _compute_notional(score: int, confluence_fired: bool) -> float:
    strength = _strength_key(score)
    size = SIGNAL_SIZE_MAP[strength]
    if confluence_fired:
        size += CONFLUENCE_BONUS
    return min(size, PORTFOLIO_NOTIONAL * 0.10)


def _f(val: Any) -> float:
    if val is None:
        return 0.0
    if isinstance(val, Decimal):
        return float(val)
    return float(val)


def _i(val: Any) -> int:
    if val is None:
        return 0
    if isinstance(val, Decimal):
        return int(val)
    return int(val)


def _b(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if val in (None, "", "0", "false", "False"):
        return False
    return bool(val)


def _parse_dt(val: Any) -> datetime:
    if isinstance(val, datetime):
        if val.tzinfo is None:
            return val.replace(tzinfo=timezone.utc)
        return val
    s = str(val).replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _item_to_position(item: dict[str, Any]) -> ModelPortfolioPosition:
    def _so(key: str, default: str = "") -> str:
        v = item.get(key)
        return str(v) if v is not None else default

    entry = _parse_dt(item["entry_date"])
    exit_dt = item.get("exit_date")
    exit_date = _parse_dt(exit_dt) if exit_dt else None
    er = item.get("exit_reason")
    exit_reason = ExitReason(str(er)) if er else None
    oc = item.get("outcome")
    outcome = PositionOutcome(str(oc)) if oc else None
    return ModelPortfolioPosition(
        position_id=_so("position_id"),
        symbol=_so("symbol").upper(),
        status=PositionStatus(str(item.get("status") or "open")),
        entry_date=entry,
        entry_price=_f(item.get("entry_price")),
        notional_size=_f(item.get("notional_size")),
        shares_equivalent=_f(item.get("shares_equivalent")),
        signal_score=_i(item.get("signal_score")),
        signal_strength=SignalStrength(str(item.get("signal_strength") or "moderate")),
        entry_reason=_so("entry_reason"),
        layer_scores_json=_so("layer_scores_json", "{}"),
        layer_verdicts_json=_so("layer_verdicts_json", "{}"),
        layer_chips_json=_so("layer_chips_json", "{}"),
        confluence_fired=_b(item.get("confluence_fired")),
        confluence_score=_i(item.get("confluence_score")),
        market_regime=_so("market_regime", "neutral"),
        vix_at_entry=float(item["vix_at_entry"]) if item.get("vix_at_entry") is not None else None,
        spy_day_pct_at_entry=float(item["spy_day_pct_at_entry"]) if item.get("spy_day_pct_at_entry") is not None else None,
        sector_etf=str(item["sector_etf"]) if item.get("sector_etf") else None,
        sector_day_pct=float(item["sector_day_pct"]) if item.get("sector_day_pct") is not None else None,
        parameter_version=_so("parameter_version", "1.0.0"),
        stop_loss_price=_f(item.get("stop_loss_price")),
        target_price=_f(item.get("target_price")),
        exit_date=exit_date,
        exit_price=_f(item["exit_price"]) if item.get("exit_price") is not None else None,
        exit_reason=exit_reason,
        pnl_dollars=_f(item["pnl_dollars"]) if item.get("pnl_dollars") is not None else None,
        pnl_percent=_f(item["pnl_percent"]) if item.get("pnl_percent") is not None else None,
        hold_days=_i(item.get("hold_days")) if item.get("hold_days") is not None else None,
        outcome=outcome,
        signal_was_correct=_b(item.get("signal_was_correct")) if item.get("signal_was_correct") is not None else None,
        r_multiple=_f(item["r_multiple"]) if item.get("r_multiple") is not None else None,
    )


def _position_to_item(position: ModelPortfolioPosition, *, symbol_upper: str) -> dict[str, Any]:
    d = position.model_dump(mode="json")
    d["pk"] = PORTFOLIO_PK
    d["sk"] = f"POSITION#{position.position_id}"
    d["status"] = position.status.value
    d["symbol"] = symbol_upper
    return d


class PortfolioRecorder:
    """Dynamo-backed model portfolio (single table, pk=PORTFOLIO#v1)."""

    def __init__(self) -> None:
        region = os.environ.get("AWS_REGION", "us-east-1")
        self.dynamo = boto3.resource("dynamodb", region_name=region)
        self.table = self.dynamo.Table(TABLE_NAME)

    def open_position(
        self,
        *,
        symbol: str,
        entry_price: float,
        signal_score: int,
        entry_reason: str,
        layer_scores: dict[str, Any],
        layer_verdicts: dict[str, Any],
        layer_chips: dict[str, Any],
        confluence_fired: bool,
        confluence_score: int,
        market_regime: str,
        vix_at_entry: Optional[float],
        spy_day_pct: Optional[float],
        sector_etf: Optional[str],
        sector_day_pct: Optional[float],
        parameter_version: str,
    ) -> Optional[str]:
        sym = symbol.upper().strip()
        if signal_score < MIN_SIGNAL_SCORE:
            log.info("Portfolio: %s score %s below minimum %s", sym, signal_score, MIN_SIGNAL_SCORE)
            return None
        if self._count_open_positions() >= MAX_OPEN_POSITIONS:
            log.info("Portfolio: max open positions reached (%s)", MAX_OPEN_POSITIONS)
            return None
        if self._has_open_position(sym):
            log.info("Portfolio: %s already has an open tracked position", sym)
            return None

        now = datetime.now(timezone.utc)
        position_id = str(uuid.uuid4())
        notional = _compute_notional(signal_score, confluence_fired)
        strength = _signal_strength_from_score(signal_score)

        position = ModelPortfolioPosition(
            position_id=position_id,
            symbol=sym,
            status=PositionStatus.OPEN,
            entry_date=now,
            entry_price=float(entry_price),
            notional_size=float(notional),
            shares_equivalent=float(notional) / float(entry_price) if entry_price else 0.0,
            signal_score=int(signal_score),
            signal_strength=strength,
            entry_reason=entry_reason[:2000],
            layer_scores_json=json.dumps(layer_scores),
            layer_verdicts_json=json.dumps(layer_verdicts),
            layer_chips_json=json.dumps(layer_chips),
            confluence_fired=bool(confluence_fired),
            confluence_score=int(confluence_score),
            market_regime=(market_regime or "neutral")[:64],
            vix_at_entry=float(vix_at_entry) if vix_at_entry is not None else None,
            spy_day_pct_at_entry=float(spy_day_pct) if spy_day_pct is not None else None,
            sector_etf=sector_etf.upper().strip() if sector_etf else None,
            sector_day_pct=float(sector_day_pct) if sector_day_pct is not None else None,
            parameter_version=str(parameter_version or "1.0.0")[:32],
            stop_loss_price=round(float(entry_price) * (1.0 - STOP_LOSS_PCT), 4),
            target_price=round(float(entry_price) * (1.0 + TARGET_PCT), 4),
        )

        item = _position_to_item(position, symbol_upper=sym)
        try:
            self.table.put_item(Item=item)
            self._increment_open_summary()
            log.info(
                "Portfolio: position logged %s at %s score=%s notional=%s id=%s",
                sym,
                entry_price,
                signal_score,
                notional,
                position_id,
            )
            return position_id
        except Exception as exc:
            log.error("Portfolio: open failed %s: %s", sym, exc)
            return None

    def close_position(self, position_id: str, exit_price: float, exit_reason: ExitReason) -> bool:
        try:
            resp = self.table.get_item(Key={"pk": PORTFOLIO_PK, "sk": f"POSITION#{position_id}"})
            raw = resp.get("Item")
            if not raw:
                log.error("Portfolio: position %s not found", position_id)
                return False

            position = _item_to_position(raw)
            if position.status != PositionStatus.OPEN:
                log.warning("Portfolio: position %s not open", position_id)
                return False

            now = datetime.now(timezone.utc)
            entry_price = float(position.entry_price)
            notional = float(position.notional_size)
            pnl_pct = ((float(exit_price) - entry_price) / entry_price) * 100.0 if entry_price else 0.0
            pnl_dollars = notional * (pnl_pct / 100.0)
            hold_days = max(0, (now - position.entry_date).days)

            risk_per_share = entry_price - float(position.stop_loss_price)
            if risk_per_share > 0:
                gain_per_share = float(exit_price) - entry_price
                r_multiple = round(gain_per_share / risk_per_share, 2)
            else:
                r_multiple = 0.0

            if pnl_pct > 0.5:
                outcome = PositionOutcome.PROFIT
            elif pnl_pct < -0.5:
                outcome = PositionOutcome.LOSS
            else:
                outcome = PositionOutcome.BREAKEVEN

            signal_was_correct = float(exit_price) >= entry_price

            self.table.update_item(
                Key={"pk": PORTFOLIO_PK, "sk": f"POSITION#{position_id}"},
                UpdateExpression=(
                    "SET #st = :closed, exit_date = :ed, exit_price = :xp, exit_reason = :xr, "
                    "pnl_dollars = :pd, pnl_percent = :pp, hold_days = :hd, #oc = :oc, "
                    "signal_was_correct = :swc, r_multiple = :rm"
                ),
                ExpressionAttributeNames={"#st": "status", "#oc": "outcome"},
                ExpressionAttributeValues={
                    ":closed": PositionStatus.CLOSED.value,
                    ":ed": now.isoformat(),
                    ":xp": str(exit_price),
                    ":xr": exit_reason.value,
                    ":pd": str(pnl_dollars),
                    ":pp": str(pnl_pct),
                    ":hd": hold_days,
                    ":oc": outcome.value,
                    ":swc": signal_was_correct,
                    ":rm": str(r_multiple),
                },
            )

            self._update_summary_after_close(
                pnl_dollars=pnl_dollars,
                outcome=outcome,
                signal_score=position.signal_score,
                hold_days=hold_days,
                r_multiple=r_multiple,
            )
            log.info(
                "Portfolio: position closed %s at %s pnl=%.2f%% (%s) R=%s",
                position.symbol,
                exit_price,
                pnl_pct,
                exit_reason.value,
                r_multiple,
            )
            return True
        except Exception as exc:
            log.error("Portfolio: close failed %s: %s", position_id, exc)
            return False

    def get_open_positions(self) -> list[dict[str, Any]]:
        try:
            response = self.table.query(
                IndexName="status-entry-index",
                KeyConditionExpression="#st = :open",
                ExpressionAttributeNames={"#st": "status"},
                ExpressionAttributeValues={":open": PositionStatus.OPEN.value},
                ScanIndexForward=False,
            )
            return list(response.get("Items") or [])
        except ClientError as exc:
            log.error("Portfolio: get open failed: %s", exc)
            return []

    def get_closed_positions(self, *, limit: int = 50, symbol: Optional[str] = None) -> list[dict[str, Any]]:
        lim = max(1, min(100, int(limit)))
        try:
            if symbol:
                sym = symbol.upper().strip()
                response = self.table.query(
                    IndexName="symbol-entry-index",
                    KeyConditionExpression="symbol = :sym",
                    FilterExpression="#st = :closed",
                    ExpressionAttributeNames={"#st": "status"},
                    ExpressionAttributeValues={":sym": sym, ":closed": PositionStatus.CLOSED.value},
                    ScanIndexForward=False,
                    Limit=lim,
                )
            else:
                response = self.table.query(
                    IndexName="status-entry-index",
                    KeyConditionExpression="#st = :closed",
                    ExpressionAttributeNames={"#st": "status"},
                    ExpressionAttributeValues={":closed": PositionStatus.CLOSED.value},
                    ScanIndexForward=False,
                    Limit=lim,
                )
            return list(response.get("Items") or [])
        except ClientError as exc:
            log.error("Portfolio: get closed failed: %s", exc)
            return []

    def get_summary_item(self) -> Optional[dict[str, Any]]:
        try:
            response = self.table.get_item(Key={"pk": PORTFOLIO_PK, "sk": "SUMMARY"})
            return response.get("Item")
        except ClientError as exc:
            log.error("Portfolio: get summary failed: %s", exc)
            return None

    def check_stop_and_target(self, *, symbol: str, current_price: float) -> Optional[str]:
        sym = symbol.upper().strip()
        try:
            positions = self._get_open_by_symbol(sym)
            for pos in positions:
                entry_price = _f(pos.get("entry_price"))
                stop_loss = _f(pos.get("stop_loss_price"))
                target = _f(pos.get("target_price"))
                position_id = str(pos.get("position_id") or "")
                if not position_id:
                    continue
                entry_date = _parse_dt(pos["entry_date"])
                hold_days = max(0, (datetime.now(timezone.utc) - entry_date).days)

                if current_price <= stop_loss:
                    self.close_position(position_id, current_price, ExitReason.STOP_LOSS)
                    return "stop_loss"
                if current_price >= target:
                    self.close_position(position_id, current_price, ExitReason.TARGET_REACHED)
                    return "target_reached"
                if hold_days >= 20:
                    self.close_position(position_id, current_price, ExitReason.TIME_EXIT)
                    return "time_exit"
            return None
        except Exception as exc:
            log.error("Portfolio: stop/target check failed %s: %s", sym, exc)
            return None

    def _count_open_positions(self) -> int:
        return len(self.get_open_positions())

    def _has_open_position(self, symbol: str) -> bool:
        return len(self._get_open_by_symbol(symbol)) > 0

    def _get_open_by_symbol(self, symbol: str) -> list[dict[str, Any]]:
        sym = symbol.upper().strip()
        try:
            response = self.table.query(
                IndexName="symbol-entry-index",
                KeyConditionExpression="symbol = :sym",
                FilterExpression="#st = :open",
                ExpressionAttributeNames={"#st": "status"},
                ExpressionAttributeValues={":sym": sym, ":open": PositionStatus.OPEN.value},
            )
            return list(response.get("Items") or [])
        except ClientError as exc:
            log.error("Portfolio: query open by symbol %s: %s", sym, exc)
            return []

    def _increment_open_summary(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        try:
            self.table.update_item(
                Key={"pk": PORTFOLIO_PK, "sk": "SUMMARY"},
                UpdateExpression=(
                    "SET last_updated = :lu, portfolio_version = :pv, "
                    "started_at = if_not_exists(started_at, :lu) "
                    "ADD open_positions :one, total_positions :one"
                ),
                ExpressionAttributeValues={":lu": now, ":pv": PORTFOLIO_VERSION, ":one": 1},
            )
        except ClientError as exc:
            log.warning("Portfolio: summary increment (open): %s", exc)

    def _update_summary_after_close(
        self,
        *,
        pnl_dollars: float,
        outcome: PositionOutcome,
        signal_score: int,
        hold_days: int,
        r_multiple: float,
    ) -> None:
        now = datetime.now(timezone.utc)
        try:
            resp = self.table.get_item(Key={"pk": PORTFOLIO_PK, "sk": "SUMMARY"})
            item = dict(resp.get("Item") or {})
            started = item.get("started_at") or now.isoformat()
            closed = _i(item.get("closed_positions")) + 1
            open_n = max(0, _i(item.get("open_positions")) - 1)
            total_pos = _i(item.get("total_positions"))
            if total_pos <= 0:
                total_pos = closed + open_n
            wins = _i(item.get("winning_positions"))
            losses = _i(item.get("losing_positions"))
            breakevens = _i(item.get("breakeven_positions"))
            gross_win = _f(item.get("gross_win_dollars"))
            gross_loss = _f(item.get("gross_loss_dollars"))
            sum_r = _f(item.get("sum_r_multiple"))
            sum_hold = _f(item.get("sum_hold_days"))

            if outcome == PositionOutcome.PROFIT:
                wins += 1
                gross_win += max(0.0, pnl_dollars)
            elif outcome == PositionOutcome.LOSS:
                losses += 1
                gross_loss += abs(min(0.0, pnl_dollars))
            else:
                breakevens += 1

            sum_r += r_multiple
            sum_hold += float(hold_days)

            tier_m_w = _i(item.get("tier_moderate_wins"))
            tier_m_n = _i(item.get("tier_moderate_total"))
            tier_s_w = _i(item.get("tier_strong_wins"))
            tier_s_n = _i(item.get("tier_strong_total"))
            tier_v_w = _i(item.get("tier_vstrong_wins"))
            tier_v_n = _i(item.get("tier_vstrong_total"))

            if signal_score >= 90:
                tier_v_n += 1
                if outcome == PositionOutcome.PROFIT:
                    tier_v_w += 1
            elif signal_score >= 80:
                tier_s_n += 1
                if outcome == PositionOutcome.PROFIT:
                    tier_s_w += 1
            else:
                tier_m_n += 1
                if outcome == PositionOutcome.PROFIT:
                    tier_m_w += 1

            total_ret = _f(item.get("total_return_dollars")) + pnl_dollars
            win_rate = (wins / closed) if closed else 0.0
            profit_factor = (gross_win / gross_loss) if gross_loss > 0 else (gross_win if gross_win > 0 else 0.0)
            avg_r = (sum_r / closed) if closed else 0.0
            avg_hold = (sum_hold / closed) if closed else 0.0
            mod_wr = (tier_m_w / tier_m_n) if tier_m_n else 0.0
            str_wr = (tier_s_w / tier_s_n) if tier_s_n else 0.0
            v_wr = (tier_v_w / tier_v_n) if tier_v_n else 0.0

            self.table.put_item(
                Item={
                    "pk": PORTFOLIO_PK,
                    "sk": "SUMMARY",
                    "portfolio_version": PORTFOLIO_VERSION,
                    "started_at": str(started),
                    "last_updated": now.isoformat(),
                    "total_positions": total_pos,
                    "open_positions": open_n,
                    "closed_positions": closed,
                    "winning_positions": wins,
                    "losing_positions": losses,
                    "breakeven_positions": breakevens,
                    "total_return_dollars": str(total_ret),
                    "total_return_pct": str((total_ret / PORTFOLIO_NOTIONAL) * 100.0),
                    "win_rate": str(win_rate),
                    "profit_factor": str(round(profit_factor, 4)),
                    "avg_r_multiple": str(round(avg_r, 4)),
                    "avg_hold_days": str(round(avg_hold, 2)),
                    "moderate_win_rate": str(round(mod_wr, 4)),
                    "strong_win_rate": str(round(str_wr, 4)),
                    "very_strong_win_rate": str(round(v_wr, 4)),
                    "gross_win_dollars": str(gross_win),
                    "gross_loss_dollars": str(gross_loss),
                    "sum_r_multiple": str(sum_r),
                    "sum_hold_days": str(sum_hold),
                    "tier_moderate_wins": tier_m_w,
                    "tier_moderate_total": tier_m_n,
                    "tier_strong_wins": tier_s_w,
                    "tier_strong_total": tier_s_n,
                    "tier_vstrong_wins": tier_v_w,
                    "tier_vstrong_total": tier_v_n,
                    "value_history_json": item.get("value_history_json") or "[]",
                    "max_drawdown_pct": item.get("max_drawdown_pct") or "0",
                    "current_drawdown_pct": item.get("current_drawdown_pct") or "0",
                    "avg_win_pct": item.get("avg_win_pct") or "0",
                    "avg_loss_pct": item.get("avg_loss_pct") or "0",
                }
            )
        except Exception as exc:
            log.error("Portfolio: summary update failed: %s", exc)


def get_portfolio_recorder() -> PortfolioRecorder:
    return PortfolioRecorder()
