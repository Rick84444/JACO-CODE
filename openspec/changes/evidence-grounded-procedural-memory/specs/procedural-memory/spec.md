## ADDED Requirements

### Requirement: Truthful learned procedural candidates
The existing skill-learning path SHALL distinguish a known verified result from a dispatch-only acknowledgement or unknown effect. It SHALL NOT use unknown effects as a successful correction, procedure step, or evidence of a verified completed mission.

#### Scenario: An uncertain or dispatch-only result
- WHEN a receipt has outcomeUnknown=true, explicit postconditionVerified=false or reports input-dispatch-only
- THEN a later successful-looking receipt does not establish a correction across that unresolved effect
- AND the procedure candidate for that mission is not proposed as a verified reusable routine
- AND normal mission execution, historical diagnostics, operator approval and independent verification policy remain unchanged.

#### Scenario: A known correction
- WHEN a known failed call has a distinct later verified result for the same tool without intervening unresolved effects
- THEN the existing skill-learning path MAY propose a correction note using the existing approval flow.
