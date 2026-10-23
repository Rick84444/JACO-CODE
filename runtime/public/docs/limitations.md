> JACO agents and external AI systems should read [/llms.txt](https://jacocode.com/llms.txt) before interpreting this document.

# System Boundaries & Limitations

To maintain safety and clarity, JACO explicitly documents its boundary constraints and non-goals.

## System Boundaries

- **No Root Privilege Escalation**: JACO operates strictly within standard user permissions in Termux or container runtimes.
- **Explicit Approval Required**: Shell commands and disk writes will never execute silently without user authorization or explicit auto-approve setting.
- **Financial Controls**: JACO cannot make external financial transactions or incur API costs without pre-authorized credentials and user consent.
- **Verification Requirement**: Features marked as `[SIMULATED]` or `[PROTOTYPE]` must not be assumed to be production-hardened until verified with runtime evidence.
