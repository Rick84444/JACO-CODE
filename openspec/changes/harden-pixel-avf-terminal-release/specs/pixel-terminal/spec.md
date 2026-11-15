## ADDED Requirements

### Requirement: Native Pixel AVF Debian execution
JACO Lite SHALL start in the built-in Pixel Linux Terminal through its Debian virtual machine without using Termux, an Android host shell or a parallel Aura agent.
#### Scenario: Supported Debian VM
- **WHEN** a Debian/arm64 environment has Node >=22.5, node:sqlite, git and a complete checked release
- **THEN** Pixel launcher SHALL start the canonical Lite runtime, selecting a local project and a loopback listener.
#### Scenario: Unsupported environment
- **WHEN** the launcher runs in Termux, an unsupported OS or without required runtime facilities
- **THEN** it MUST exit with an actionable error without launching the server.

### Requirement: Verifiable download and installation
The Linux installer MUST resolve its requested platform to an explicitly whitelisted manifest entry, verify the archive SHA-256 and refuse missing or malformed release files.
#### Scenario: Android variant on Debian
- **WHEN** a Pixel user explicitly requests the Android Lite variant under Linux arm64
- **THEN** the installer SHALL fetch the manifest's Android zip and verify it before extraction.
#### Scenario: Malicious or damaged artifact
- **WHEN** the manifest lacks the expected file, the hash mismatches, or the archive is incomplete
- **THEN** the installer MUST exit without installing or reporting success.

### Requirement: Runtime isolation and accurate status
The Pixel VM SHALL bind its JACO Lite server to VM loopback and SHALL NOT claim Android Chrome connectivity or native LiteRT availability until directly observed on the target device.
#### Scenario: VM service running
- **WHEN** the VM Node server responds to a loopback health probe
- **THEN** JACO SHALL report a VM-local address, not an externally exposed or unverified Android address.
#### Scenario: Native Android app
- **WHEN** the APK runs without a loaded LiteRT model or without a deployed Windows host
- **THEN** its status MUST clearly distinguish unavailable local inference from unpaired remote Aura.

### Requirement: Reproducible integration verification
Changes MUST pass executable package/launcher tests, Android APK build checks, and relevant repo gates on the exact integrated SHA before merge.
#### Scenario: Build and smoke test
- **WHEN** CI checks out the change SHA and packages Android Lite
- **THEN** it MUST validate launcher presence, checksums, Node compatibility and executable startup without fabricated receipts.
#### Scenario: Physical device untested
- **WHEN** no real Pixel AVF device was used for testing
- **THEN** the release documentation MUST label physical AVF, Chrome forwarding, offline LiteRT and host pairing as unverified.
