"""Runtime boundary between JACO NEXUS state and ZTP-PLSM.

Modern contract
---------------
A runtime should expose::

    emit_delta(actor_id=..., domain=..., key=..., op=...)

The runtime, not JACO callers, owns event IDs, replica sequence numbers,
frontier advancement, WAL ordering and recovery.

Compatibility
-------------
Older ZTP-PLSM builds accepted Event objects through emit(event).
RuntimeFacade supports that API while persisting the producer sequence on
disk so a process restart cannot silently reset it to 1. The compatibility
path cannot manufacture guarantees the old Event schema does not expose;
true replica-scoped event identity therefore remains a property of the modern
emit_delta contract.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable


class RuntimeContractError(RuntimeError):
    pass


class _PersistentSequence:
    """Small atomic producer cursor used only for the legacy Event API."""

    def __init__(self, root: str, replica_id: str) -> None:
        self._path = Path(root) / ".jaco-ztp-producer.json"
        self._replica_id = replica_id
        self._lock = threading.Lock()
        self._value = self._load()

    def _load(self) -> int:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return 0
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeContractError(f"cannot read producer cursor: {exc}") from exc
        value = raw.get(self._replica_id, 0)
        return int(value)

    def next(self) -> int:
        with self._lock:
            self._value += 1
            self._persist()
            return self._value

    def _persist(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            raw = {}
        raw[self._replica_id] = self._value
        tmp = self._path.with_suffix(self._path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(raw, fh, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self._path)


class RuntimeFacade:
    """Stable JACO-facing runtime API over modern or legacy ZTP builds."""

    def __init__(self, runtime: Any, *, root: str, replica_id: str, membership_epoch: int = 0) -> None:
        self._runtime = runtime
        self.root = root
        self.replica_id = replica_id
        self.membership_epoch = membership_epoch
        self._legacy_seq = None if hasattr(runtime, "emit_delta") else _PersistentSequence(root, replica_id)

    def emit_delta(self, *, actor_id: str, domain: str, key: str, op: dict) -> Any:
        modern = getattr(self._runtime, "emit_delta", None)
        if callable(modern):
            return modern(actor_id=actor_id, domain=domain, key=key, op=op)

        emit = getattr(self._runtime, "emit", None)
        if not callable(emit):
            raise RuntimeContractError("ZTP runtime exposes neither emit_delta() nor emit()")

        from ztp_plsm.model import Event

        assert self._legacy_seq is not None
        sequence = self._legacy_seq.next()

        legacy_op = dict(op)
        if "gcounter" in legacy_op:
            gcounter = dict(legacy_op["gcounter"])
            gcounter.setdefault("replica", self.replica_id)
            legacy_op["gcounter"] = gcounter

        state_delta = {"domain": domain, "key": key, "op": legacy_op}
        event = Event.create(
            agent_id=actor_id,
            epoch=self.membership_epoch,
            sequence=sequence,
            phase_vector={"t": time.monotonic_ns(), "replica": self.replica_id},
            weight=1.0,
            state_delta=state_delta,
        )
        return emit(event)

    def snapshot(self):
        return self._runtime.snapshot()

    def checkpoint(self) -> None:
        self._runtime.checkpoint()

    def close(self) -> None:
        self._runtime.close()

    def reconcile(self) -> Any:
        reconcile = getattr(self._runtime, "reconcile", None)
        return reconcile() if callable(reconcile) else None

    def status(self) -> dict:
        status = getattr(self._runtime, "status", None)
        return status() if callable(status) else {"replica_id": self.replica_id}

    def __getattr__(self, name: str) -> Any:
        return getattr(self._runtime, name)


def open_enterprise_runtime(
    root: str,
    replica_id: str,
    membership_epoch: int = 0,
    *,
    runtime_factory: Callable[..., Any] | None = None,
) -> RuntimeFacade:
    """Open and reconcile the production runtime behind a stable facade.

    runtime_factory exists for contract/integration testing. Production
    callers normally omit it and load ztp_plsm.enterprise.EnterpriseRuntime.
    """

    if runtime_factory is None:
        from ztp_plsm.enterprise import EnterpriseRuntime
        runtime_factory = EnterpriseRuntime

    runtime = runtime_factory(
        root=root,
        replica_id=replica_id,
        membership_epoch=membership_epoch,
    )
    facade = RuntimeFacade(
        runtime,
        root=root,
        replica_id=replica_id,
        membership_epoch=membership_epoch,
    )
    facade.reconcile()
    return facade
