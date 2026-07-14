from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd


INDEXES: dict[str, dict[str, str]] = {
    "000001": {"code": "000001.XSHG", "name": "上证指数"},
    "000852": {"code": "000852.XSHG", "name": "中证1000"},
    "399006": {"code": "399006.XSHE", "name": "创业板指"},
}


def strategy_score(
    probability: np.ndarray, left_score: np.ndarray, strategy: dict[str, Any]
) -> tuple[np.ndarray, np.ndarray]:
    if strategy["strategy"] == "hard_gate":
        return probability, left_score >= float(strategy["gate_threshold"])
    weight = float(strategy["model_weight"])
    return weight * probability + (1.0 - weight) * left_score, np.ones(len(probability), dtype=bool)


def cooldown_alarm_mask(
    panel: pd.DataFrame,
    score: np.ndarray,
    threshold: float,
    eligibility: np.ndarray,
    cooldown: int,
) -> np.ndarray:
    raw = np.isfinite(score) & (score >= threshold) & eligibility
    selected = np.zeros(len(panel), dtype=bool)
    sessions = panel["session_key"].to_numpy()
    positions = panel["session_pos"].to_numpy(dtype="int32")
    last_session: object | None = None
    last_position = -100_000
    for idx in np.flatnonzero(raw):
        session = sessions[idx]
        position = int(positions[idx])
        if session != last_session or position - last_position > cooldown:
            selected[idx] = True
            last_session = session
            last_position = position
    return selected


def load_model_outputs(
    model_root: Path, index: str, direction: str, panel: pd.DataFrame, cooldown: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray, float]:
    model_id = f"{index}_{direction}_h05"
    metadata = json.loads((model_root / "models" / f"{model_id}.json").read_text(encoding="utf-8"))
    feature_columns = metadata["feature_columns"]
    missing = sorted(set(feature_columns).difference(panel.columns))
    if missing:
        raise ValueError(f"{model_id} 缺少特征: {missing[:10]}")
    booster = lgb.Booster(
        model_file=str(model_root / "outputs" / "all_train" / "models" / f"{model_id}.txt")
    )
    probability = booster.predict(panel[feature_columns], num_iteration=booster.num_trees())
    left_column = "left_score_v" if direction == "v" else "left_score_inv"
    left_score = panel[left_column].to_numpy(dtype="float64")
    score, eligible = strategy_score(probability, left_score, metadata["strategy"])
    threshold = float(metadata["strategy"]["alarm_threshold"])
    alarm = cooldown_alarm_mask(panel, score, threshold, eligible, cooldown)
    return probability, left_score, alarm, threshold


def path_efficiency(values: np.ndarray) -> float:
    if len(values) < 2:
        return 0.0
    travel = float(np.abs(np.diff(values)).sum())
    return float(abs(values[-1] - values[0]) / travel) if travel > 0 else 0.0


def amplitude(start: float, end: float, direction: str, side: str) -> float:
    if direction == "v":
        value = (start - end) / start if side == "left" else (end - start) / start
    else:
        value = (end - start) / start if side == "left" else (start - end) / start
    return max(0.0, float(value))


def build_shape(
    day: pd.DataFrame,
    alert_pos: int,
    direction: str,
    strict_day: pd.DataFrame,
    future_window: int,
    right_window: int,
) -> dict[str, Any]:
    kind = "V" if direction == "v" else "INV_V"
    alert = day.iloc[alert_pos]
    session_start = 0 if alert_pos < 120 else 120
    session_end = min(len(day) - 1, 119 if alert_pos < 120 else 239)
    future_end = min(session_end, alert_pos + future_window)
    direction_events = strict_day.loc[strict_day["direction"].eq(direction)].copy()
    if not direction_events.empty:
        direction_events["pivot_datetime"] = pd.to_datetime(direction_events["pivot_datetime"])
        direction_events = direction_events.loc[
            (direction_events["pivot_datetime"] > alert.datetime)
            & (direction_events["pivot_datetime"] <= day.iloc[future_end].datetime)
        ].sort_values("pivot_datetime")

    matched = not direction_events.empty
    strict_row = direction_events.iloc[0] if matched else None
    if matched:
        pivot_dt = pd.Timestamp(strict_row["pivot_datetime"])
        pivot_pos = int(day.index[day["datetime"].eq(pivot_dt)][0])
        status = "complete"
    else:
        candidate = day.iloc[alert_pos : future_end + 1]
        pivot_pos = int(candidate["close"].idxmin() if direction == "v" else candidate["close"].idxmax())
        status = "right"

    left_start = max(session_start, pivot_pos - 30)
    left_candidates = day.iloc[left_start : pivot_pos + 1]
    left_pos = int(left_candidates["close"].idxmax() if direction == "v" else left_candidates["close"].idxmin())
    right_end = min(session_end, pivot_pos + right_window)
    right_candidates = day.iloc[pivot_pos : right_end + 1]
    right_pos = int(right_candidates["close"].idxmax() if direction == "v" else right_candidates["close"].idxmin())
    left_pos = min(left_pos, pivot_pos)
    right_pos = max(pivot_pos, right_pos)

    close = day["close"].to_numpy(dtype="float64")
    left_values = close[left_pos : pivot_pos + 1]
    right_values = close[pivot_pos : right_pos + 1]
    left_amp = amplitude(float(close[left_pos]), float(close[pivot_pos]), direction, "left")
    right_amp = amplitude(float(close[pivot_pos]), float(close[right_pos]), direction, "right")
    symmetry = min(left_amp, right_amp) / max(left_amp, right_amp) if max(left_amp, right_amp) > 0 else 0.0
    threshold = float(alert.amplitude_threshold) if np.isfinite(alert.amplitude_threshold) else 0.001
    pivot_distance = abs(float(close[alert_pos]) - float(close[pivot_pos])) / max(abs(float(close[pivot_pos])), 1e-12)
    near_pivot = pivot_distance <= max(0.001, threshold * 0.35)
    pivot_delay = pivot_pos - alert_pos
    probability = float(alert.low_probability if direction == "v" else alert.high_probability)
    left_score = float(alert.low_left_score if direction == "v" else alert.high_left_score)
    strict_strength = float(strict_row["strength"]) if matched else None
    return {
        "id": f"{alert.date}-{direction}-{alert.datetime.strftime('%H%M')}",
        "kind": kind,
        "status": status,
        "horizon": "short" if pivot_delay <= 5 else "long",
        "alert": alert_pos,
        "left": left_pos,
        "pivot": pivot_pos,
        "right": right_pos,
        "alertTime": alert.datetime.strftime("%H:%M"),
        "leftTime": day.iloc[left_pos].datetime.strftime("%H:%M"),
        "pivotTime": day.iloc[pivot_pos].datetime.strftime("%H:%M"),
        "rightTime": day.iloc[right_pos].datetime.strftime("%H:%M"),
        "pivotDelay": int(pivot_delay),
        "leftDuration": int(pivot_pos - left_pos),
        "rightDuration": int(right_pos - pivot_pos),
        "probability": round(probability, 6) if np.isfinite(probability) else 0.0,
        "leftScore": round(left_score, 6) if np.isfinite(left_score) else 0.0,
        "leftAmp": round(left_amp * 100.0, 4),
        "rightAmp": round(right_amp * 100.0, 4),
        "leftEff": round(path_efficiency(left_values) * 100.0, 2),
        "rightEff": round(path_efficiency(right_values) * 100.0, 2),
        "symmetry": round(symmetry * 100.0, 2),
        "threshold": round(threshold * 100.0, 4),
        "nearPivot": bool(near_pivot),
        "strictStrength": round(strict_strength, 4) if strict_strength is not None else None,
    }


def compact_day(
    day: pd.DataFrame,
    strict_day: pd.DataFrame,
    future_window: int,
    right_window: int,
) -> dict[str, Any]:
    day = day.reset_index(drop=True)
    bars: list[list[Any]] = []
    signals: list[list[Any]] = []
    shapes: list[dict[str, Any]] = []
    low_count = 0
    high_count = 0
    for row in day.itertuples(index=False):
        values = [float(row.low_probability), float(row.high_probability), float(row.low_left_score), float(row.high_left_score)]
        bars.append([
            row.datetime.strftime("%H:%M"), round(float(row.open), 4), round(float(row.high), 4),
            round(float(row.low), 4), round(float(row.close), 4), int(max(0.0, float(row.volume))),
        ])
        low_alarm = int(bool(row.low_alarm))
        high_alarm = int(bool(row.high_alarm))
        low_count += low_alarm
        high_count += high_alarm
        signals.append([
            round(values[0], 6) if np.isfinite(values[0]) else 0.0,
            round(values[1], 6) if np.isfinite(values[1]) else 0.0,
            round(values[2], 6) if np.isfinite(values[2]) else 0.0,
            round(values[3], 6) if np.isfinite(values[3]) else 0.0,
            low_alarm, high_alarm,
        ])
    for alert_pos in np.flatnonzero(day["low_alarm"].to_numpy(dtype=bool)):
        shapes.append(build_shape(day, int(alert_pos), "v", strict_day, future_window, right_window))
    for alert_pos in np.flatnonzero(day["high_alarm"].to_numpy(dtype=bool)):
        shapes.append(build_shape(day, int(alert_pos), "inv", strict_day, future_window, right_window))
    shapes.sort(key=lambda item: (item["alert"], item["kind"]))
    return {
        "bars": bars,
        "signals": signals,
        "shapes": shapes,
        "alerts": {"low": low_count, "high": high_count, "total": low_count + high_count},
        "shapeCounts": {
            "complete": sum(item["status"] == "complete" for item in shapes),
            "right": sum(item["status"] == "right" for item in shapes),
        },
    }


def build_index(
    model_root: Path,
    output_dir: Path,
    index: str,
    spec: dict[str, str],
    strict_events: pd.DataFrame,
    cooldown: int,
    future_window: int,
    right_window: int,
) -> dict[str, Any]:
    panel = joblib.load(model_root / "outputs" / "datasets" / f"{index}_panel.joblib").copy()
    panel["datetime"] = pd.to_datetime(panel["datetime"])
    raw = pd.read_csv(
        model_root / "data" / f"{index}_1m_20190101_20260709.csv",
        encoding="utf-8-sig", parse_dates=["datetime"],
    ).sort_values("datetime").reset_index(drop=True)
    if len(raw) != len(panel) or not raw["datetime"].equals(panel["datetime"].reset_index(drop=True)):
        raise ValueError(f"{index} 原始行情与特征面板时间未严格对齐")

    low_probability, low_left, low_alarm, low_threshold = load_model_outputs(model_root, index, "v", panel, cooldown)
    high_probability, high_left, high_alarm, high_threshold = load_model_outputs(model_root, index, "inv", panel, cooldown)
    frame = raw[["datetime", "open", "high", "low", "close", "volume"]].copy()
    frame["date"] = frame["datetime"].dt.strftime("%Y-%m-%d")
    frame["amplitude_threshold"] = panel["amplitude_threshold"].to_numpy(dtype="float64")
    frame["low_probability"], frame["high_probability"] = low_probability, high_probability
    frame["low_left_score"], frame["high_left_score"] = low_left, high_left
    frame["low_alarm"], frame["high_alarm"] = low_alarm, high_alarm

    index_events = strict_events.loc[strict_events["index"].eq(index)].copy()
    target = output_dir / index
    target.mkdir(parents=True, exist_ok=True)
    dates: list[str] = []
    alert_dates: list[str] = []
    low_count = high_count = complete_count = right_count = 0
    for year, year_frame in frame.groupby(frame["datetime"].dt.year, sort=True):
        days: dict[str, Any] = {}
        for date, day in year_frame.groupby("date", sort=True):
            strict_day = index_events.loc[index_events["date"].eq(str(date))]
            payload = compact_day(day, strict_day, future_window, right_window)
            days[str(date)] = payload
            dates.append(str(date))
            if payload["alerts"]["total"]:
                alert_dates.append(str(date))
            low_count += int(payload["alerts"]["low"])
            high_count += int(payload["alerts"]["high"])
            complete_count += int(payload["shapeCounts"]["complete"])
            right_count += int(payload["shapeCounts"]["right"])
        (target / f"{year}.json").write_text(
            json.dumps({"code": spec["code"], "name": spec["name"], "year": int(year), "days": days},
                       ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8"
        )
    return {
        "code": spec["code"], "slug": index, "name": spec["name"], "dates": dates,
        "alertDates": alert_dates,
        "counts": {"low": low_count, "high": high_count, "total": low_count + high_count},
        "shapeCounts": {"complete": complete_count, "right": right_count},
        "thresholds": {"low": low_threshold, "high": high_threshold},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="生成带右侧确认的分钟模型静态数据")
    parser.add_argument("--model-root", type=Path, default=Path(r"D:\V-Right"))
    parser.add_argument("--output-dir", type=Path, default=Path("public/data"))
    parser.add_argument("--cooldown", type=int, default=8)
    parser.add_argument("--future-window", type=int, default=30)
    parser.add_argument("--right-window", type=int, default=30)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    strict_events = pd.read_csv(args.model_root / "reports" / "strict_events.csv", dtype={"index": str, "date": str})
    strict_events["index"] = strict_events["index"].str.zfill(6)

    manifest: dict[str, Any] = {
        "title": "指数分钟模型左右侧观测台",
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "matching": {"shortMinutes": 5, "longMinutes": args.future_window, "rightMinutes": args.right_window},
        "indices": [],
    }
    for index, spec in INDEXES.items():
        print(f"生成 {spec['name']} 的左右侧预测解释...", flush=True)
        manifest["indices"].append(build_index(
            args.model_root, args.output_dir, index, spec, strict_events,
            args.cooldown, args.future_window, args.right_window,
        ))
    all_dates = sorted({date for item in manifest["indices"] for date in item["dates"]})
    manifest["range"] = {"min": all_dates[0], "max": all_dates[-1]}
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, separators=(",", ":"), allow_nan=False), encoding="utf-8"
    )
    complete = sum(int(item["shapeCounts"]["complete"]) for item in manifest["indices"])
    right = sum(int(item["shapeCounts"]["right"]) for item in manifest["indices"])
    print(f"完成：严格左+右 {complete} 条，右侧解释 {right} 条。", flush=True)


if __name__ == "__main__":
    main()
