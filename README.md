# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/lively-panda-61/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/lively-panda-61/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token DeFi protocols by implied value using a comps-based model ("radar-3"): each protocol's TVL is multiplied by a category multiple (shrunk toward the global median), a 7-day growth factor, and a maturity hump, producing a 198-row board with low/high intervals and 8 farm steps per row. The dashboard ships beside the board with a sortable table, category comps, a live-token view, per-protocol detail dialogs, and a model sandbox that re-ranks the board live.

## Run it

Requires Node 22, standard library only, no network:

```sh
node main.ts --input <snapshot.json|dir> --output <dir>
```

It reads the sealed snapshot (`/input/snapshot.json` by default), writes the ranked board to `<dir>/board.json`, copies the dashboard and screenshots to `<dir>`, and writes `<dir>/dossier.json` last.

<sub>Entered on [make.fun](https://make.fun/?ref=q85rcyn4&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
