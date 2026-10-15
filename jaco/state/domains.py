"""Semantic domains and CRDT delta builders for JACO NEXUS state.

This module is intentionally pure: it contains no runtime imports or side effects.
JACO callers express *what* changed; the ZTP runtime owns event identity,
sequencing, durability, causal frontier and recovery.
"""

DOMAIN_AGENT_STATUS = "agent_status"
DOMAIN_AGENT_CAPS = "agent_caps"
DOMAIN_MISSIONS = "missions"
DOMAIN_COUNTERS = "counters"
DOMAIN_CONTRACTS = "contracts"
DOMAIN_TICKETS = "tickets"
DOMAIN_LEDGER = "ledger"

STATUS_ONLINE = "online"
STATUS_OFFLINE = "offline"
STATUS_BUSY = "busy"
STATUS_ERROR = "error"
VALID_STATUSES = frozenset({STATUS_ONLINE, STATUS_OFFLINE, STATUS_BUSY, STATUS_ERROR})


def delta_epoch_register(value: str) -> dict:
    return {"epoch_register": {"value": value}}


def delta_gset_add(member: str) -> dict:
    return {"gset": {"add": member}}


def delta_orset_add(tag: str, value: str) -> dict:
    return {"orset": {"add": {"tag": tag, "value": value}}}


def delta_orset_remove(tag: str) -> dict:
    return {"orset": {"remove_tags": [tag]}}


def delta_gcounter_increment(amount: int = 1) -> dict:
    """Increment a GCounter; replica identity is injected by the runtime."""
    if amount < 0:
        raise ValueError("GCounter increments must be non-negative")
    return {"gcounter": {"amount": amount}}
