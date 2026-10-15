"""Functional NEXUS state API backed by a ZTP causal runtime.

All writes are semantic deltas. Event identity, sequence numbers, WAL ordering
and causal frontier belong to the runtime boundary in jaco.state.runtime.
"""

from __future__ import annotations

from typing import Any, Callable

from .domains import (
    DOMAIN_AGENT_CAPS,
    DOMAIN_AGENT_STATUS,
    DOMAIN_CONTRACTS,
    DOMAIN_COUNTERS,
    DOMAIN_LEDGER,
    DOMAIN_MISSIONS,
    DOMAIN_TICKETS,
    VALID_STATUSES,
    delta_epoch_register,
    delta_gcounter_increment,
    delta_gset_add,
    delta_orset_add,
    delta_orset_remove,
)
from .runtime import RuntimeFacade, open_enterprise_runtime


def open_runtime(
    root: str,
    replica_id: str,
    membership_epoch: int = 0,
    *,
    runtime_factory: Callable[..., Any] | None = None,
) -> RuntimeFacade:
    return open_enterprise_runtime(
        root,
        replica_id,
        membership_epoch,
        runtime_factory=runtime_factory,
    )


def close_runtime(runtime) -> None:
    runtime.checkpoint()
    runtime.close()


def checkpoint(runtime) -> None:
    runtime.checkpoint()


def _emit(runtime, actor_id: str, domain: str, key: str, delta: dict) -> None:
    runtime.emit_delta(actor_id=actor_id, domain=domain, key=key, op=delta)


def _read(runtime, domain: str, key: str) -> dict | None:
    return runtime.snapshot().point_read(domain, key)


def set_agent_status(runtime, agent_id: str, status: str) -> None:
    if status not in VALID_STATUSES:
        raise ValueError(f"invalid agent status: {status!r}")
    _emit(runtime, agent_id, DOMAIN_AGENT_STATUS, agent_id, delta_epoch_register(status))


def get_agent_status(runtime, agent_id: str) -> str | None:
    raw = _read(runtime, DOMAIN_AGENT_STATUS, agent_id)
    return None if raw is None else raw.get("value")


def add_agent_capability(runtime, agent_id: str, capability: str) -> None:
    _emit(runtime, agent_id, DOMAIN_AGENT_CAPS, agent_id, delta_gset_add(capability))


def get_agent_capabilities(runtime, agent_id: str) -> set[str]:
    raw = _read(runtime, DOMAIN_AGENT_CAPS, agent_id)
    return set() if raw is None else set(raw.get("members", []))


def assign_mission(runtime, agent_id: str, mission_id: str, description: str) -> None:
    _emit(runtime, agent_id, DOMAIN_MISSIONS, agent_id, delta_orset_add(mission_id, description))


def complete_mission(runtime, agent_id: str, mission_id: str) -> None:
    _emit(runtime, agent_id, DOMAIN_MISSIONS, agent_id, delta_orset_remove(mission_id))


def get_active_missions(runtime, agent_id: str) -> dict[str, str]:
    raw = _read(runtime, DOMAIN_MISSIONS, agent_id)
    if raw is None:
        return {}
    return {item["tag"]: item["value"] for item in raw.get("elements", [])}


def increment_execution_count(runtime, agent_id: str, amount: int = 1) -> None:
    _emit(runtime, agent_id, DOMAIN_COUNTERS, agent_id, delta_gcounter_increment(amount))


def get_execution_count(runtime, agent_id: str) -> int:
    raw = _read(runtime, DOMAIN_COUNTERS, agent_id)
    return 0 if raw is None else int(raw.get("value", 0))


def write_contract(runtime, contract_slot: str, contract_json: str) -> None:
    _emit(runtime, "nexus", DOMAIN_CONTRACTS, contract_slot, delta_epoch_register(contract_json))


def read_contract(runtime, contract_slot: str) -> str | None:
    raw = _read(runtime, DOMAIN_CONTRACTS, contract_slot)
    return None if raw is None else raw.get("value")


def issue_ticket(runtime, ticket_id: str, payload: str) -> None:
    _emit(runtime, "nexus", DOMAIN_TICKETS, "pool", delta_orset_add(ticket_id, payload))


def retire_ticket(runtime, ticket_id: str) -> None:
    _emit(runtime, "nexus", DOMAIN_TICKETS, "pool", delta_orset_remove(ticket_id))


def get_active_tickets(runtime) -> dict[str, str]:
    raw = _read(runtime, DOMAIN_TICKETS, "pool")
    if raw is None:
        return {}
    return {item["tag"]: item["value"] for item in raw.get("elements", [])}


def record_ledger_entry(runtime, agent_id: str, amount: int = 1) -> None:
    _emit(runtime, agent_id, DOMAIN_LEDGER, agent_id, delta_gcounter_increment(amount))


def get_ledger_total(runtime, agent_id: str) -> int:
    raw = _read(runtime, DOMAIN_LEDGER, agent_id)
    return 0 if raw is None else int(raw.get("value", 0))


def dump_nexus_state(runtime, agents: list[str]) -> dict:
    return {
        agent: {
            "status": get_agent_status(runtime, agent),
            "capabilities": sorted(get_agent_capabilities(runtime, agent)),
            "missions": get_active_missions(runtime, agent),
            "executions": get_execution_count(runtime, agent),
            "ledger": get_ledger_total(runtime, agent),
        }
        for agent in agents
    }


def frontier_digest(runtime) -> dict:
    return runtime.status()
