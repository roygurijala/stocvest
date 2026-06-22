"""Single source of truth for tunable signal parameters (versioned; not yet wired into scoring)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from stocvest.config.sector_etf_defaults import DEFAULT_SECTOR_TO_ETF


@dataclass
class TechnicalParameters:
    # Weights (must sum to 1.0)
    vwap_weight: float = 0.25
    orb_weight: float = 0.25
    ema_weight: float = 0.20
    rsi_weight: float = 0.15
    volume_weight: float = 0.15

    # RSI thresholds
    rsi_period: int = 14
    rsi_overbought: float = 70.0
    rsi_oversold: float = 30.0
    rsi_bullish_zone: float = 60.0
    rsi_bearish_zone: float = 40.0

    # EMA periods
    ema_fast_period: int = 9
    ema_slow_period: int = 20

    # ORB
    orb_period_minutes: int = 15
    orb_buffer_pct: float = 0.0005
    orb_expiry_hour_et: int = 10

    # Volume
    volume_lookback_bars: int = 10
    volume_surge_multiplier: float = 1.5
    volume_adv_surge_multiplier: float = 1.5

    # Scoring deltas
    vwap_score_delta: int = 20
    ema_score_delta: int = 15
    ema_crossover_bonus: int = 5
    orb_score_delta: int = 20
    rsi_strong_delta: int = 10
    rsi_moderate_delta: int = 5
    volume_amplifier: int = 10

    # ATR
    atr_period: int = 14
    orb_atr_qualification_ratio: float = 0.3

    # Previous session levels (when upstream provides prior OHLC)
    pdh_pdl_score_delta: int = 8

    # Intraday session momentum (day desk — recent price action, not structural trend)
    session_momentum_lookback_bars: int = 0  # 0 = use all bars in window
    session_momentum_moderate_pct: float = 0.002
    session_momentum_strong_pct: float = 0.005
    session_momentum_moderate_score: int = 10
    session_momentum_strong_score: int = 15
    session_pullback_moderate_pct: float = 0.008
    session_pullback_strong_pct: float = 0.015
    session_pullback_moderate_penalty: int = 10
    session_pullback_strong_penalty: int = 18
    recent_bar_momentum_lookback: int = 10
    recent_bar_momentum_score: int = 8

    # Verdict thresholds
    bullish_threshold: int = 65
    bearish_threshold: int = 35


@dataclass
class NewsParameters:
    # Recency weights
    recency_1h_weight: float = 1.0
    recency_4h_weight: float = 0.7
    recency_8h_weight: float = 0.4
    recency_old_weight: float = 0.2

    # Relevance weights
    direct_mention_weight: float = 1.0
    indirect_mention_weight: float = 0.5

    # Min articles for confidence
    min_articles_for_strong: int = 3
    min_articles_for_moderate: int = 1

    # Score thresholds
    bullish_threshold: int = 65
    bearish_threshold: int = 35

    # Max articles to analyze
    max_articles: int = 10
    lookback_hours: int = 8


@dataclass
class MacroParameters:
    # Component weights:
    #   momentum=0.45 — dominant but not so high that a normal pullback
    #     (-0.5% to -1.5%) fires risk_off; needs a genuine bad day (-2%+).
    #   volatility=0.35 — slight increase so VIX spikes (crashes) pull
    #     harder toward risk_off / avoid.
    #   event=0.20 — events are forward-looking risk, not regime confirmation.
    momentum_weight: float = 0.45
    volatility_weight: float = 0.35
    event_weight: float = 0.20

    # VIX levels
    vix_low: float = 15.0
    vix_normal: float = 20.0
    vix_elevated: float = 25.0
    vix_high: float = 30.0

    # VIX scores at each level
    vix_low_score: int = 80
    vix_normal_score: int = 65
    vix_elevated_score: int = 45
    vix_high_score: int = 30
    vix_extreme_score: int = 15

    # VIX trend adjustment
    vix_falling_bonus: int = 10
    vix_rising_penalty: int = 10
    vix_trend_threshold_pct: float = 5.0

    # Event risk scores
    event_today_score: int = 40
    event_tomorrow_score: int = 45
    no_event_score: int = 60

    # Verdict thresholds
    bullish_threshold: int = 60
    bearish_threshold: int = 40


@dataclass
class SectorParameters:
    # Relative strength thresholds
    strong_outperform: float = 0.5
    moderate_outperform: float = 0.2
    inline_range: float = 0.2
    moderate_underperform: float = -0.5

    # Score values
    strong_outperform_score: int = 75
    moderate_outperform_score: int = 65
    inline_score: int = 50
    moderate_underperform_score: int = 35
    strong_underperform_score: int = 25

    # Absolute direction adjustment
    absolute_up_threshold: float = 0.5
    absolute_down_threshold: float = -0.5
    absolute_adjustment: int = 5

    # Verdict thresholds
    bullish_threshold: int = 65
    bearish_threshold: int = 35

    # Bucket → ETF (overridable via Secrets Manager JSON)
    sector_to_etf: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_SECTOR_TO_ETF))


@dataclass
class SwingTechnicalParameters:
    """Daily-bar technical tuning for swing / position-style composite."""

    sma_fast_period: int = 50
    sma_slow_period: int = 200
    ema_period: int = 21

    rsi_period: int = 14
    rsi_bullish_zone: float = 50.0
    rsi_overbought: float = 70.0
    rsi_oversold: float = 30.0
    rsi_score_delta: int = 15
    rsi_momentum_building_max: float = 60.0
    rsi_momentum_strong_max: float = 70.0
    rsi_overbought_penalty: int = 12

    # SMA20 — primary swing anchor (price vs multi-week mean)
    above_sma20_score: int = 10
    # Below-SMA20 is magnitude-scaled: a shallow dip below the 20-day mean is a
    # normal pullback, a deep break is structural. ``below_sma20_score`` is the
    # CAP (deep break); ``below_sma20_min_penalty`` the floor just below the
    # line; full cap is reached at ``below_sma20_full_break_pct`` below SMA20.
    below_sma20_score: int = 20
    below_sma20_min_penalty: int = 4
    below_sma20_full_break_pct: float = 5.0
    sma20_extended_pct: float = 15.0
    sma20_extended_penalty: int = 15

    above_sma50_score: int = 10
    above_sma200_score: int = 5
    # Durable-uptrend structural credit: price above BOTH SMA50 and SMA200 with
    # SMA50 > SMA200 (golden cross). Rewards a stock whose long-term trend is
    # intact even while it pulls back short-term, so consolidations don't floor.
    golden_cross_score: int = 8
    extension_above_sma50_pct: float = 15.0
    extension_above_sma50_penalty: int = 8
    extension_above_sma200_pct: float = 40.0
    extension_above_sma200_penalty: int = 10
    extension_extra_per_10_pct: int = 3
    extension_penalty_cap: int = 25

    # Recent momentum — swing horizon (multi-day breakdown vs structural uptrend)
    roc_lookback_sessions: int = 10
    roc_strong_up_pct: float = 10.0
    roc_moderate_up_pct: float = 5.0
    roc_strong_down_pct: float = -10.0
    roc_moderate_down_pct: float = -5.0
    roc_strong_score: int = 25
    roc_moderate_score: int = 15

    recent_high_lookback_sessions: int = 60
    pct_from_high_strong_break_pct: float = -10.0
    pct_from_high_moderate_break_pct: float = -5.0
    pct_from_high_strong_penalty: int = 15
    pct_from_high_moderate_penalty: int = 8

    higher_highs_lows_score: int = 12
    lower_highs_lows_score: int = 15
    macd_histogram_positive_score: int = 10
    macd_histogram_negative_penalty: int = 10
    macd_histogram_fading_penalty: int = 5
    rsi_exhaustion_extended_penalty: int = 10

    volume_accumulation_score: int = 15
    # Distribution is penalized lighter than accumulation is rewarded: a couple
    # of higher-volume down days during an uptrend pullback should not slam the
    # score as hard as sustained accumulation confirms it.
    volume_distribution_penalty: int = 10
    near_52w_high_score: int = 8
    base_formation_score: int = 10

    base_min_days: int = 15
    base_max_days: int = 40
    base_max_range_pct: float = 0.08

    volume_lookback_days: int = 20

    bullish_threshold: int = 60
    bearish_threshold: int = 40

    daily_bars_lookback: int = 210


@dataclass
class EntryZoneModeParameters:
    """Per-desk entry-zone geometry. Widths are a fraction of price.

    The zone is a *tight, actionable* band anchored to a structural level
    (``preferred_anchor``); it is NOT the full session/swing range. See
    ``stocvest.api.services.entry_zone`` for the synthesis + validation logic.
    """

    max_width_pct: float = 0.005
    min_width_pct: float = 0.002
    preferred_anchor: str = "vwap"  # vwap | sma20 | sma50 | prev_close | last
    atr_k: float = 0.5  # natural half-width = atr_k × ATR, clamped by the % rails


@dataclass
class EntryZoneParameters:
    """Config-driven entry-zone widths/anchors + the shared worst-case R/R floor.

    Tunable via Secrets Manager without a deploy. Defaults: day band ≤ 0.5% of
    price anchored to VWAP; swing band ≤ 2.0% anchored to SMA20; both must keep
    R/R ≥ 1.5 measured from the worst-case (far) edge of the zone.
    """

    day: EntryZoneModeParameters = field(
        default_factory=lambda: EntryZoneModeParameters(
            max_width_pct=0.005, min_width_pct=0.002, preferred_anchor="vwap", atr_k=0.5
        )
    )
    swing: EntryZoneModeParameters = field(
        default_factory=lambda: EntryZoneModeParameters(
            max_width_pct=0.020, min_width_pct=0.005, preferred_anchor="sma20", atr_k=1.0
        )
    )
    min_rr_from_zone_high: float = 1.5


@dataclass
class CompositeParameters:
    # Layer weights (must sum to 1.0)
    technical_weight: float = 0.30
    news_weight: float = 0.20
    macro_weight: float = 0.15
    sector_weight: float = 0.15
    geopolitical_weight: float = 0.10
    internals_weight: float = 0.10

    # Verdict thresholds
    bullish_threshold: float = 0.20
    bearish_threshold: float = -0.20

    # Signal quality gates
    min_signal_strength: int = 55
    min_available_layers: int = 3
    # Email: min confirming layers for signal_fired (scanner uses trigger_count proxy)
    alert_email_min_confirming: int = 2

    # Confluence
    confluence_min_confirming: int = 3
    confluence_conflict_penalty: int = 8
    confluence_alert_threshold: int = 60


@dataclass
class SignalParameters:
    version: str = "1.0.0"
    created_at: str = ""
    notes: str = ""

    technical: TechnicalParameters = field(default_factory=TechnicalParameters)
    news: NewsParameters = field(default_factory=NewsParameters)
    macro: MacroParameters = field(default_factory=MacroParameters)
    sector: SectorParameters = field(default_factory=SectorParameters)
    composite: CompositeParameters = field(default_factory=CompositeParameters)

    # Per-mode composite override blocks (B30 Phase 3 — Suggestion 4 audit).
    #
    # Both the swing and day composite engines today read the same `composite`
    # block. The per-layer **inputs** already differ between engines (swing uses
    # 120h news / 14d macro / 168h geo / weekly sector / daily-bar technical;
    # day uses 8h news / 1d macro / 8h geo / daily sector / intraday technical),
    # but the **blend weights** are identical. That is a known asymmetry: e.g.
    # macro and sector deserve more weight for swing (multi-day holds carry
    # through Fed days and sector rotation), while technical/internals deserve
    # more weight for day (intraday confirmation IS the day-engine's primary
    # truth).
    #
    # These two fields are the seam for rotating weights per mode. They default
    # to None so the back-compat behavior is preserved: any Secrets Manager JSON
    # without `swing_composite` or `day_composite` keys (i.e. every existing
    # secret today) keeps using the shared `composite` block. Operators rotate
    # the weights by adding the per-mode blocks to the secret payload; the live
    # engine code is already mode-aware via `resolve_composite_block(params, mode)`
    # in `stocvest.signals.composite_score`.
    swing_composite: CompositeParameters | None = None
    day_composite: CompositeParameters | None = None

    swing_technical: SwingTechnicalParameters = field(default_factory=SwingTechnicalParameters)
    entry_zone: EntryZoneParameters = field(default_factory=EntryZoneParameters)
    swing_news_lookback_hours: int = 120
    swing_macro_events_days: int = 14
    swing_geo_lookback_hours: int = 168
    swing_sector_use_weekly: bool = True


def default_signal_parameters() -> SignalParameters:
    return SignalParameters()


def signal_parameters_to_dict(params: SignalParameters) -> dict:
    """JSON-serializable dict (nested dataclasses → dict)."""
    return asdict(params)
