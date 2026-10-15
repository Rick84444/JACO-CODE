"""Drop-in NEXUS bridge backed by the JACO/ZTP causal state contract."""

from __future__ import annotations

import os
from typing import Any, Callable

from .migrate import archive_migrated_file, migrate_nexus_json
from .store import (
    add_agent_capability,
    assign_mission,
    checkpoint,
    close_runtime,
    complete_mission,
    get_active_missions,
    get_agent_capabilities,
    get_agent_status,
    get_execution_count,
    get_ledger_total,
    increment_execution_count,
    open_runtime,
    record_ledger_entry,
    set_agent_status,
)

_runtime = None


def init(
    root: str,
    replica_id: str,
    membership_epoch: int = 0,
    nexus_state_path: str | None = None,
    *,
    runtime_factory: Callable[..., Any] | None = None,
):
    """Initialise the bridge and migrate a legacy JSON file exactly once."""

    global _runtime
    if _runtime is not None:
        return _runtime

    _runtime = open_runtime(
        root,
        replica_id,
        membership_epoch,
        runtime_factory=runtime_factory,
    )

    legacy_path = nexus_state_path or os.path.join(root, "NEXUS_STATE.json")
    if os.path.exists(legacy_path):
        migrate_nexus_json(_runtime, legacy_path)
        checkpoint(_runtime)
        archive_migrated_file(legacy_path)

    return _runtime


def _require_runtime():
    if _runtime is None:
        raise RuntimeError("nexus bridge not initialised; call init() first")
    return _runtime


def write_agent_state(agent_id: str, key: str, value: Any) -> None:
    rt = _require_runtime()
    if key == "status":
        set_agent_status(rt, agent_id, str(value))
    elif key == "capabilities":
        values = value if isinstance(value, (list, tuple, set)) else [value]
        for capability in values:
            add_agent_capability(rt, agent_id, str(capability))
    elif key == "missions":
        if not isinstance(value, dict):
            raise TypeError("missions must be a mapping of mission_id -> description")
        current = get_active_missions(rt, agent_id)
        for mission_id in set(current) - set(value):
            complete_mission(rt, agent_id, str(mission_id))
        for mission_id, description in value.items():
            if current.get(str(mission_id)) != str(description):
                assign_mission(rt, agent_id, str(mission_id), str(description))
    elif key == "executions":
        target = int(value)
        current = get_execution_count(rt, agent_id)
        if target < current:
            raise ValueError("execution GCounter cannot decrease")
        if target > current:
            increment_execution_count(rt, agent_id, target - current)
    elif key == "ledger":
        target = int(value)
        current = get_ledger_total(rt, agent_id)
        if target < current:
            raise ValueError("ledger GCounter cannot decrease")
        if target > current:
            record_ledger_entry(rt, agent_id, target - current)
    else:
        raise KeyError(f"unsupported NEXUS agent field: {key}")


def read_agent_state(agent_id: str, key: str):
    rt = _require_runtime()
    readers = {
        "status": get_agent_status,
        "capabilities": get_agent_capabilities,
        "missions": get_active_missions,
        "executions": get_execution_count,
        "ledger": get_ledger_total,
    }
    if key not in readers:
        raise KeyError(f"unsupported NEXUS agent field: {key}")
    value = readers[key](rt, agent_id)
    return sorted(value) if isinstance(value, set) else value


def broadcast_status(agent_id: str, status: str) -> None:
    set_agent_status(_require_runtime(), agent_id, status)


def commit_mission(agent_id: str, mission_id: str, description: str) -> None:
    assign_mission(_require_runtime(), agent_id, mission_id, description)


def close_mission(agent_id: str, mission_id: str) -> None:
    complete_mission(_require_runtime(), agent_id, mission_id)


def flush() -> None:
    checkpoint(_require_runtime())


def shutdown() -> None:
    global _runtime
    if _runtime is None:
        return
    close_runtime(_runtime)
    _runtime = None
