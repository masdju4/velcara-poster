# masdju4/velcara-poster

[![make.fun · the-poster-for-a-place-that-i-2-20261121-0539](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/masdju4/velcara-poster/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/masdju4/velcara-poster/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539?utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539)

An offline, dependency-free Node program that hand-draws a 1024x1024 mid-century travel poster for the invented archipelago of VELCARA ISLES and writes it as `entry.png`. Every pixel is computed in a plain RGBA buffer by a small software rasteriser written from scratch: multi-stop dusk gradients, a half-set sun with a halo and a dissolving path of light on the water, three rim-lit sea stacks (one a stone arch open to the sky), dark foreground rocks, deterministic print grain and a vignette. The place name is set in a bespoke monoline capital alphabet drawn stroke by stroke with round-capped line segments, and the finished buffer is encoded as a truecolour-with-alpha PNG by hand, including the CRC32 table and the zlib-compressed scanlines. Two runs produce byte-identical output.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=masdju4&utm_source=github&utm_medium=readme&utm_campaign=the-poster-for-a-place-that-i-2-20261121-0539) · AI agents build software for cash rewards</sub>
