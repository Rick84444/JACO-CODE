"""One-shot, restart-safe migration from NEXUS_STATE.json to ZTP-backed state."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .domains import STATUS_OFFLINE
from .store import (
    add_agent_capability,
    assign_mission,
    get_execution_count,
    get_ledger_total,
    increment_execution_count,
    issue_ticket,
    record_ledger_entry,
    set_agent_status,
    write_contract,
)


def _load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def migrate_nexus_json(runtime, nexus_state_path: str = "NEXUS_STATE.json") -> dict:
    """Merge legacy NEXUS JSON into the causal store without double-counting.

    Counters are migrated as monotonic floors: a repeated migration only emits
    the positive difference between legacy value and current runtime value.
    Sets naturally accumulate and registers are rewritten with the same value.
    """

    if not os.path.exists(nexus_state_path):
        return {"skipped": True, "reason": f"{nexus_state_path} not found"}

    raw = _load_json(nexus_state_path)
    summary: dict[str, Any] = {
        "agents_migrated": [],
        "contracts": 0,
        "tickets": 0,
        "counter_increments": 0,
        "ledger_increments": 0,
        "unknown_keys": [],
    }

    for key, value in raw.items():
        if isinstance(value, dict) and _looks_like_agent_block(value):
            agent_id = str(key)
            set_agent_status(runtime, agent_id, str(value.get("status", STATUS_OFFLINE)))

            for cap in value.get("capabilities", []):
                add_agent_capability(runtime, agent_id, str(cap))

            for mission_id, desc in (value.get("missions") or {}).items():
                assign_mission(runtime, agent_id, str(mission_id), str(desc))

            target_executions = int(value.get("executions", 0) or 0)
            current_executions = get_execution_count(runtime, agent_id)
            if target_executions > current_executions:
                delta = target_executions - current_executions
                increment_execution_count(runtime, agent_id, delta)
                summary["counter_increments"] += delta

            target_ledger = int(value.get("ledger", 0) or 0)
            current_ledger = get_ledger_total(runtime, agent_id)
            if target_ledger > current_ledger:
                delta = target_ledger - current_ledger
                record_ledger_entry(runtime, agent_id, delta)
                summary["ledger_increments"] += delta

            summary["agents_migrated"].append(agent_id)

        elif key == "contracts" and isinstance(value, dict):
            for slot, contract in value.items():
                payload = contract if isinstance(contract, str) else json.dumps(contract, sort_keys=True)
                write_contract(runtime, str(slot), payload)
                summary["contracts"] += 1

        elif key in ("tickets", "execution_tickets") and isinstance(value, (list, dict)):
            tickets = value if isinstance(value, dict) else {str(t): t for t in value}
            for tid, payload in tickets.items():
                encoded = payload if isinstance(payload, str) else json.dumps(payload, sort_keys=True)
                issue_ticket(runtime, str(tid), encoded)
                summary["tickets"] += 1

        else:
            summary["unknown_keys"].append(key)

    return summary


def archive_migrated_file(path: str) -> str:
    """Atomically move a successfully migrated legacy file out of the hot path."""

    source = Path(path)
    candidate = source.with_name(source.name + ".migrated")
    if candidate.exists():
        index = 1
        while source.with_name(f"{source.name}.migrated.{index}").exists():
            index += 1
        candidate = source.with_name(f"{source.name}.migrated.{index}")
    os.replace(source, candidate)
    return str(candidate)


def _looks_like_agent_block(d: dict) -> bool:
    agent_fields = {"status", "capabilities", "missions", "executions", "ledger"}
    return bool(agent_fields & set(d.keys()))
