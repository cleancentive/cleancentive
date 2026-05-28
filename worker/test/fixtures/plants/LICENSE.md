# Plant fixture photos — sources and licenses

Eight photos sourced from Wikimedia Commons for end-to-end testing of the plant-spotting pipeline. Each file has had its EXIF GPS coordinates replaced with synthetic positions around Lenk im Simmental, Switzerland (≈46.4585 N, 7.4271 E) so the existing import-photo flow picks up location without manual entry.

All photos are redistributed here under their original licenses. **Do not deploy these fixtures to production storage** — they are test data only.

| File | Species | InfoFlora list | License | Author | Source |
|---|---|---|---|---|---|
| knotweed.jpg | *Reynoutria japonica* | black | CC0 | W.carter | [Commons](https://commons.wikimedia.org/wiki/File:Reynoutria_japonica_in_Brastad_1.jpg) |
| giant-hogweed.jpg | *Heracleum mantegazzianum* | black | CC BY 4.0 | anastasiiamerkulova | [Commons](https://commons.wikimedia.org/wiki/File:0_Heracleum_mantegazzianum,_native,_Zelenchuksky_District,_Karachay-Cherkessia,_Caucasus_Mts,_Russia_2.jpg) |
| himalayan-balsam.jpg | *Impatiens glandulifera* | black | CC BY-SA 3.0 | H. Zell | [Commons](https://commons.wikimedia.org/wiki/File:Impatiens_glandulifera_0004.JPG) |
| tree-of-heaven.jpg | *Ailanthus altissima* | black | CC BY-SA 2.5 | Darkone | [Commons](https://commons.wikimedia.org/wiki/File:G%C3%B6tterbaum_(Ailanthus_altissima).jpg) |
| canadian-goldenrod.jpg | *Solidago canadensis* | black | CC BY-SA 4.0 | Georg Slickers | [Commons](https://commons.wikimedia.org/wiki/File:Solidago_canadensis_20050815_248.jpg) |
| butterfly-bush.jpg | *Buddleja davidii* | black | CC BY-SA 2.5 | IKAl | [Commons](https://commons.wikimedia.org/wiki/File:BuddlejaDavidiiStrauch.jpg) |
| black-locust.jpg | *Robinia pseudoacacia* | watch | CC BY-SA 3.0 | Pollinator (en.wikipedia) | [Commons](https://commons.wikimedia.org/wiki/File:Robina9146.JPG) |
| dandelion.jpg | *Taraxacum officinale* | — (control) | CC BY-SA 4.0 | Petar Milošević | [Commons](https://commons.wikimedia.org/wiki/File:Taraxacum_officinale_side_makro.jpg) |

## Why these eight

- **Six black-list species** cover the most common Swiss neophytes that field volunteers encounter and that the [InfoFlora data file](../../../src/data/infoflora-neophytes.json) flags.
- **One watch-list species** (black locust) exercises the amber-badge / "watch list" branch of `PlantIdentificationCard`.
- **One non-invasive control** (dandelion) — every spot identification pipeline should classify this as `is_invasive=false` with high confidence. Catches false positives in the InfoFlora lookup.

## Synthetic GPS

Coordinates injected with `exiftool` post-download, jittered within ~2 km of Lenk im Simmental (BE):

```
46.4521..46.4642 N
 7.4234.. 7.4319 E
 1068 m altitude
```

This is **not** where the photos were actually taken — they're scattered across the world (Sweden, Russia, Germany, Slovenia, the US…). The GPS is purely so the existing `extractImageMetadata` path picks up a location during import-photo testing.
