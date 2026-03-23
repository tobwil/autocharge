from __future__ import annotations
from config import ChargingConfig


def compute_target(
    solar_w: float,
    cfg: ChargingConfig,
    currently_charging: bool,
) -> tuple[int, bool, int]:
    """
    Returns (target_amps, should_charge, target_phases).

    When phases_switching is enabled the algorithm tries the maximum
    configured phase count first (most efficient), then falls back to
    1-phase so charging continues even when solar is too weak for 3-phase.

    Phase thresholds (with default min_amps=6):
        3-phase minimum:  6 × 3 × 230 =  4 140 W
        1-phase minimum:  6 × 1 × 230 =  1 380 W
    """
    if cfg.mode == "off":
        return 0, False, cfg.phases

    if cfg.mode == "fixed":
        amps = round(cfg.fixed_kw * 1000 / (cfg.phases * 230))
        return max(cfg.min_amps, min(cfg.max_amps, amps)), True, cfg.phases

    # ── solar mode ────────────────────────────────────────────────────────────
    available_w = solar_w * (1.0 - cfg.buffer_fraction)
    threshold = cfg.stop_threshold_w if currently_charging else cfg.start_threshold_w

    if not cfg.phases_switching or cfg.phases <= 1:
        # Simple single-phase-count path (original behaviour)
        if available_w < threshold:
            return 0, False, cfg.phases
        amps = max(cfg.min_amps, min(cfg.max_amps, int(available_w / (cfg.phases * 230))))
        return amps, True, cfg.phases

    # ── auto phase switching ───────────────────────────────────────────────────
    # Try max phases first, then 1 phase.
    # The threshold check is skipped per-phase so we always prefer the highest
    # phase count that yields enough current; global stop/start threshold applies
    # only at the bottom (absolute floor).
    for ph in (cfg.phases, 1):
        amps = int(available_w / (ph * 230))
        if amps >= cfg.min_amps:
            amps = min(cfg.max_amps, amps)
            return amps, True, ph

    # Below even 1-phase minimum
    return 0, False, cfg.phases
