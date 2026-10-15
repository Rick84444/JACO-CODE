import json
import os
import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jaco.state import nexus_bridge_ztp as bridge
from jaco.state.migrate import migrate_nexus_json
from jaco.state.reference_runtime import ReferenceRuntime
from jaco.state.store import (
    add_agent_capability,
    assign_mission,
    checkpoint,
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


class StateContractTests(unittest.TestCase):
    def runtime(self, root, replica="r1"):
        return open_runtime(root, replica, runtime_factory=ReferenceRuntime)

    def test_basic_semantic_state(self):
        with tempfile.TemporaryDirectory() as root:
            rt = self.runtime(root)
            set_agent_status(rt, "Nova", "online")
            add_agent_capability(rt, "Nova", "desktop")
            assign_mission(rt, "Nova", "m1", "verify machine")
            increment_execution_count(rt, "Nova", 3)
            record_ledger_entry(rt, "Nova", 7)
            self.assertEqual(get_agent_status(rt, "Nova"), "online")
            self.assertEqual(get_agent_capabilities(rt, "Nova"), {"desktop"})
            self.assertEqual(get_active_missions(rt, "Nova"), {"m1": "verify machine"})
            self.assertEqual(get_execution_count(rt, "Nova"), 3)
            self.assertEqual(get_ledger_total(rt, "Nova"), 7)

    def test_restart_recovers_checkpoint_and_wal_tail(self):
        with tempfile.TemporaryDirectory() as root:
            rt = self.runtime(root)
            assign_mission(rt, "Nova", "m1", "before checkpoint")
            checkpoint(rt)
            assign_mission(rt, "Nova", "m2", "after checkpoint")
            reopened = self.runtime(root)
            self.assertEqual(
                get_active_missions(reopened, "Nova"),
                {"m1": "before checkpoint", "m2": "after checkpoint"},
            )

    def test_sequence_never_reuses_after_restart(self):
        with tempfile.TemporaryDirectory() as root:
            rt = self.runtime(root)
            assign_mission(rt, "Nova", "m1", "one")
            first = rt.export_events()[-1]["sequence"]
            reopened = self.runtime(root)
            assign_mission(reopened, "Nova", "m2", "two")
            second = reopened.export_events()[-1]["sequence"]
            self.assertGreater(second, first)

    def test_duplicate_event_replay_is_idempotent(self):
        with tempfile.TemporaryDirectory() as a_root, tempfile.TemporaryDirectory() as b_root:
            a = self.runtime(a_root, "A")
            b = self.runtime(b_root, "B")
            increment_execution_count(a, "Nova", 5)
            event = a.export_events()[-1]
            b.ingest([event, event, event])
            self.assertEqual(get_execution_count(b, "Nova"), 5)
            self.assertEqual(b.status()["event_count"], 1)

    def test_replica_merge_converges(self):
        with tempfile.TemporaryDirectory() as a_root, tempfile.TemporaryDirectory() as b_root:
            a = self.runtime(a_root, "A")
            b = self.runtime(b_root, "B")
            add_agent_capability(a, "Nova", "browser")
            add_agent_capability(b, "Nova", "desktop")
            increment_execution_count(a, "Nova", 2)
            increment_execution_count(b, "Nova", 3)
            a_events = a.export_events()
            b_events = b.export_events()
            a.ingest(b_events)
            b.ingest(a_events)
            self.assertEqual(get_agent_capabilities(a, "Nova"), {"browser", "desktop"})
            self.assertEqual(get_agent_capabilities(a, "Nova"), get_agent_capabilities(b, "Nova"))
            self.assertEqual(get_execution_count(a, "Nova"), 5)
            self.assertEqual(get_execution_count(a, "Nova"), get_execution_count(b, "Nova"))
            self.assertEqual(a.status()["frontier"], b.status()["frontier"])

    def test_observed_remove_does_not_delete_unseen_concurrent_add(self):
        with tempfile.TemporaryDirectory() as a_root, tempfile.TemporaryDirectory() as b_root:
            a = self.runtime(a_root, "A")
            b = self.runtime(b_root, "B")
            assign_mission(a, "Nova", "m1", "from A")
            assign_mission(b, "Nova", "m1", "from B")
            complete_mission(a, "Nova", "m1")
            a_events = a.export_events()
            b_events = b.export_events()
            a.ingest(b_events)
            b.ingest(a_events)
            self.assertIn("m1", get_active_missions(a, "Nova"))
            self.assertEqual(get_active_missions(a, "Nova"), get_active_missions(b, "Nova"))

    def test_migration_is_counter_idempotent(self):
        with tempfile.TemporaryDirectory() as root:
            legacy = os.path.join(root, "NEXUS_STATE.json")
            with open(legacy, "w", encoding="utf-8") as fh:
                json.dump({"Nova": {"status": "online", "executions": 9, "ledger": 4}}, fh)
            rt = self.runtime(root)
            first = migrate_nexus_json(rt, legacy)
            second = migrate_nexus_json(rt, legacy)
            self.assertEqual(get_execution_count(rt, "Nova"), 9)
            self.assertEqual(get_ledger_total(rt, "Nova"), 4)
            self.assertEqual(first["counter_increments"], 9)
            self.assertEqual(second["counter_increments"], 0)
            self.assertEqual(second["ledger_increments"], 0)

    def test_bridge_auto_migrates_and_archives_legacy_file(self):
        with tempfile.TemporaryDirectory() as root:
            legacy = os.path.join(root, "NEXUS_STATE.json")
            with open(legacy, "w", encoding="utf-8") as fh:
                json.dump({"Nova": {"status": "busy", "capabilities": ["browser"]}}, fh)
            bridge.init(root, "r1", runtime_factory=ReferenceRuntime)
            try:
                self.assertEqual(bridge.read_agent_state("Nova", "status"), "busy")
                self.assertEqual(bridge.read_agent_state("Nova", "capabilities"), ["browser"])
                self.assertFalse(os.path.exists(legacy))
                self.assertTrue(os.path.exists(legacy + ".migrated"))
            finally:
                bridge.shutdown()

    def test_bridge_gcounter_write_is_monotonic_floor(self):
        with tempfile.TemporaryDirectory() as root:
            bridge.init(root, "r1", runtime_factory=ReferenceRuntime)
            try:
                bridge.write_agent_state("Nova", "executions", 10)
                bridge.write_agent_state("Nova", "executions", 10)
                self.assertEqual(bridge.read_agent_state("Nova", "executions"), 10)
                with self.assertRaises(ValueError):
                    bridge.write_agent_state("Nova", "executions", 9)
            finally:
                bridge.shutdown()

    def test_unknown_agent_field_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            bridge.init(root, "r1", runtime_factory=ReferenceRuntime)
            try:
                with self.assertRaises(KeyError):
                    bridge.write_agent_state("Nova", "mystery", "x")
            finally:
                bridge.shutdown()

    def test_frontier_survives_restart(self):
        with tempfile.TemporaryDirectory() as root:
            rt = self.runtime(root, "A")
            assign_mission(rt, "Nova", "m1", "x")
            before = rt.status()["frontier"]
            checkpoint(rt)
            reopened = self.runtime(root, "A")
            self.assertEqual(reopened.status()["frontier"], before)

    def test_status_validation_fails_closed(self):
        with tempfile.TemporaryDirectory() as root:
            rt = self.runtime(root)
            with self.assertRaises(ValueError):
                set_agent_status(rt, "Nova", "telepathic")


if __name__ == "__main__":
    unittest.main()
