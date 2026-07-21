# Match simulation

Patch 06 adds a deterministic key-episode match engine for all playable football positions.

- Offense: QB, RB, WR.
- Defense: LB, CB.
- Six manual key episodes per game.
- The rest of the game is simulated in the background from the world seed, team state and match index.
- Every decision updates player statistics, fatigue, confidence and the coaching grade.
- The final result updates the team record, coach trust, recruiting visibility and career history.

A Saturday cannot be advanced until the active match is completed. On the following Monday the next seeded opponent and match state are created.
