# cookpool-home — risks and open questions

## Risks

- **Prod sees none of it yet.** `NewHome` renders only where `newFrame()` is on (everywhere but prod). That keeps the risk on stage, and means prod users see the calm Home only when the new frame ships.
- **The feed is off Home between HM1 and HM2.** On stage only; HM2 follows straight after.
- **Scan bill hides when receipt scan is off.** A device with the switch off sees three tiles. That is deliberate: a tile that opens a refusal is worse.

## Open questions

- Should Needs you's rows also lose their sub-lines (the boards' one-line rows)? Deferred: see design.md, Rejected.
- Does the today (prod) Home get the same treatment, or wait for the new frame? Assumed: wait.
