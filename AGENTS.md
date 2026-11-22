# Project instructions

- Fix the root cause of a problem rather than its symptoms.
- Verify claims against relevant sources instead of relying on the model's training knowledge.
- Prefer mature, maintained libraries over custom implementations.
- State any assumptions that affect how the solution behaves.
- Report what you verified and what you could not verify.
- Use the Makefile targets for routine builds, tests, and local development. Run `make check` for full verification. Use underlying commands or targeted tests when diagnosing issues.
- Identify implicit state machines and propose a design that represents their states and transitions explicitly.
- Update the version, commit, and push only after review, manual testing, and explicit approval.
