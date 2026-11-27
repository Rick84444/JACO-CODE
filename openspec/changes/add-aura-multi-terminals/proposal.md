# Aura works in several terminals and pages

## Why
The operator wants Aura to keep several terminals and web pages open and to see them beside her.

## Scope
Named terminals on the existing shell tool (own working folder, recent commands) and a window per name on the Operator Stage; a tab list for the pages Aura opened with the existing Nova tab tools. No new executor, no new permission, no persistent storage, no long-running or interactive processes.

## Acceptance / falsifier
Two named terminals keep separate folders and show their own commands; a refused command shows as failed. Falsified if a terminal can run anything the shell tool refuses, shows a token shape, or lists tabs Aura did not open (other than the one she is on).
