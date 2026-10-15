"""Disk-backed reference implementation of the JACO/ZTP runtime contract.

This is NOT the production ZTP-PLSM engine. It is deliberately small and is
used to verify the contract without installing the private/production package.
Unlike an in-memory stub it has an append-only WAL, fsync durability, persistent
replica sequence, checkpoint/recovery, event de-duplication and replica merge.
"""

from __future__ import annotations

import copy
import json
import os
import threading
import time
import uuid
from pathlib import Path


class ReferenceSnapshot:
    def __init__(self, state: dict, frontier: dict[str, int]) -> None:
        self._state = copy.deepcopy(state)
        self.frontier = dict(frontier)

    def point_read(self, domain: str, key: str):
        value = self._state.get(domain, {}).get(key)
        return copy.deepcopy(value)


class ReferenceRuntime:
    """Reference semantics for tests and local contract verification."""

    def __init__(self, root: str, replica_id: str, membership_epoch: int = 0) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.replica_id = replica_id
        self.membership_epoch = membership_epoch
        self._wal_path = self.root / "events.jsonl"
        self._meta_path = self.root / "replica.json"
        self._checkpoint_path = self.root / "checkpoint.json"
        self._lock = threading.RLock()
        self._state: dict[str, dict[str, dict]] = {}
        self._frontier: dict[str, int] = {}
        self._seen: set[str] = set()
        self._events: list[dict] = []
        self._sequence = 0
        self._recover()

    def reconcile(self) -> None:
        return None

    def emit_delta(self, *, actor_id: str, domain: str, key: str, op: dict) -> dict:
        with self._lock:
            self._sequence += 1
            self._persist_sequence()
            enriched_op = self._enrich_remove(domain, key, copy.deepcopy(op))
            event = {
                "event_id": str(uuid.uuid4()),
                "replica_id": self.replica_id,
                "actor_id": actor_id,
                "membership_epoch": self.membership_epoch,
                "sequence": self._sequence,
                "time_ns": time.time_ns(),
                "frontier": dict(self._frontier),
                "state_delta": {"domain": domain, "key": key, "op": enriched_op},
            }
            self._append_wal(event)
            self._apply(event)
            return copy.deepcopy(event)

    def ingest(self, events: list[dict]) -> None:
        """Merge remote events. Replaying duplicates is intentionally harmless."""
        with self._lock:
            for event in events:
                if event["event_id"] in self._seen:
                    continue
                self._append_wal(event)
                self._apply(copy.deepcopy(event))

    def export_events(self) -> list[dict]:
        return copy.deepcopy(self._events)

    def snapshot(self) -> ReferenceSnapshot:
        with self._lock:
            return ReferenceSnapshot(self._state, self._frontier)

    def status(self) -> dict:
        with self._lock:
            return {
                "replica_id": self.replica_id,
                "membership_epoch": self.membership_epoch,
                "frontier": dict(self._frontier),
                "event_count": len(self._seen),
                "local_sequence": self._sequence,
            }

    def checkpoint(self) -> None:
        with self._lock:
            payload = {
                "state": self._state,
                "frontier": self._frontier,
                "seen": sorted(self._seen),
                "event_count": len(self._events),
            }
            self._atomic_json(self._checkpoint_path, payload)

    def close(self) -> None:
        return None

    def _persist_sequence(self) -> None:
        self._atomic_json(self._meta_path, {"sequence": self._sequence})

    def _append_wal(self, event: dict) -> None:
        with self._wal_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n")
            fh.flush()
            os.fsync(fh.fileno())

    @staticmethod
    def _atomic_json(path: Path, payload: dict) -> None:
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(payload, fh, sort_keys=True, separators=(",", ":"))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)

    def _recover(self) -> None:
        checkpoint_count = 0
        if self._checkpoint_path.exists():
            cp = json.loads(self._checkpoint_path.read_text(encoding="utf-8"))
            self._state = cp.get("state", {})
            self._frontier = {str(k): int(v) for k, v in cp.get("frontier", {}).items()}
            self._seen = set(cp.get("seen", []))
            checkpoint_count = int(cp.get("event_count", 0))

        if self._meta_path.exists():
            meta = json.loads(self._meta_path.read_text(encoding="utf-8"))
            self._sequence = int(meta.get("sequence", 0))

        if self._wal_path.exists():
            lines = self._wal_path.read_text(encoding="utf-8").splitlines()
            self._events = [json.loads(line) for line in lines if line.strip()]
            for event in self._events[checkpoint_count:]:
                if event["event_id"] not in self._seen:
                    self._apply(event, append_event=False)

        local_max = max(
            (int(e["sequence"]) for e in self._events if e.get("replica_id") == self.replica_id),
            default=0,
        )
        if local_max > self._sequence:
            self._sequence = local_max
            self._persist_sequence()

    def _enrich_remove(self, domain: str, key: str, op: dict) -> dict:
        orset = op.get("orset")
        if not orset or "remove_tags" not in orset:
            return op
        raw = self._state.get(domain, {}).get(key, {})
        adds = raw.get("_adds", {})
        observed: dict[str, list[str]] = {}
        for tag in orset.get("remove_tags", []):
            observed[str(tag)] = sorted(adds.get(str(tag), {}).keys())
        orset["remove_dots"] = observed
        return op

    def _apply(self, event: dict, *, append_event: bool = True) -> None:
        event_id = event["event_id"]
        if event_id in self._seen:
            return
        if append_event:
            self._events.append(copy.deepcopy(event))
        self._seen.add(event_id)
        replica = str(event["replica_id"])
        seq = int(event["sequence"])
        self._frontier[replica] = max(self._frontier.get(replica, 0), seq)

        delta = event["state_delta"]
        domain, key, op = delta["domain"], delta["key"], delta["op"]
        bucket = self._state.setdefault(domain, {})
        current = bucket.get(key)

        if "epoch_register" in op:
            stamp = [int(event.get("membership_epoch", 0)), seq, replica]
            if current is None or stamp > current.get("_stamp", [-1, -1, ""]):
                bucket[key] = {"value": op["epoch_register"]["value"], "_stamp": stamp}
            return

        if "gset" in op:
            members = set((current or {}).get("members", []))
            members.add(str(op["gset"]["add"]))
            bucket[key] = {"members": sorted(members)}
            return

        if "gcounter" in op:
            data = current or {"components": {}, "value": 0}
            components = {str(k): int(v) for k, v in data.get("components", {}).items()}
            inc = op["gcounter"]
            component = str(inc.get("replica") or replica)
            components[component] = components.get(component, 0) + int(inc.get("amount", 0))
            bucket[key] = {"components": components, "value": sum(components.values())}
            return

        if "orset" in op:
            data = current or {"_adds": {}, "_removed": [], "elements": []}
            adds: dict[str, dict[str, str]] = copy.deepcopy(data.get("_adds", {}))
            removed = set(data.get("_removed", []))
            spec = op["orset"]
            if "add" in spec:
                item = spec["add"]
                tag = str(item["tag"])
                dot = f"{replica}:{seq}"
                adds.setdefault(tag, {})[dot] = str(item["value"])
            for dots in spec.get("remove_dots", {}).values():
                removed.update(str(dot) for dot in dots)
            elements = []
            for tag in sorted(adds):
                live = [(dot, value) for dot, value in adds[tag].items() if dot not in removed]
                if live:
                    _dot, value = sorted(live)[-1]
                    elements.append({"tag": tag, "value": value})
            bucket[key] = {"_adds": adds, "_removed": sorted(removed), "elements": elements}
            return

        raise ValueError(f"unknown state delta: {op!r}")
