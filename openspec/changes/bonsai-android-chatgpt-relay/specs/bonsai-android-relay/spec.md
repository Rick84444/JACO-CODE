# Bonsai Android Relay - delta specification

## Requirement: authenticated operator-scoped control
The runtime SHALL accept Bonsai Android task requests only through an authenticated Core route and a valid signed autonomy mandate explicitly naming the Android package. No public GitHub transport SHALL gain Android actuation capability.

### Scenario: rejected request
Given a missing signed mandate or an Android package outside the allowlist, no Hands-Off action SHALL be executed.

## Requirement: ground action in fresh UI observation
The runtime SHALL take a live Android accessibility observation and require a unique semantic selector before permitting tap or typing. The actuator SHALL execute through the existing native Hands-Off client and verify the before/after state.

### Scenario: model output is invalid
Given invalid JSON, coordinates without semantic selection, an ambiguous target or a password field, execution SHALL stop without performing that action.

## Requirement: truthful receipts
The runtime SHALL return a bounded task result with verified and attempted action counts; it SHALL NOT report an Android task as verified from the model's text alone. ChatGPT receipts SHALL NOT include screen text, prompt content or secrets.

## Requirement: device and host scope
The MVP SHALL use a loopback-only local Bonsai endpoint. A Windows-hosted Core SHALL NOT claim remote phone control until the existing paired device channel is tested.
