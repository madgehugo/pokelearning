# Pokélearning: third-party software and data

Pokélearning includes or downloads the following. Full licence texts are in
`Contents/Resources/licenses/` inside the app. **No games are included:** you
use a ROM dumped from your own cartridge.

## Included in the app

| Component | Version | Licence | Source |
| --- | --- | --- | --- |
| mGBA (emulator, `Contents/Resources/mGBA.app`) | {{MGBA_VERSION}} | Mozilla Public License 2.0 | {{MGBA_SOURCE}} |
| Qt and other libraries inside mGBA.app | as shipped by mGBA | LGPL and others, see `licenses/mgba/` | https://mgba.io |
| Node.js | {{NODE_VERSION}} | MIT | https://nodejs.org |
| transformers.js (`@huggingface/transformers`) | {{TRANSFORMERS_VERSION}} | Apache 2.0 | https://github.com/huggingface/transformers.js |
| ONNX Runtime (`onnxruntime-node`) | {{ONNXRUNTIME_VERSION}} | MIT | https://github.com/microsoft/onnxruntime |
| sharp and libvips | {{SHARP_VERSION}} | Apache 2.0; libvips LGPL 3.0 | https://sharp.pixelplumbing.com |
| React, ws, ts-fsrs and other JavaScript libraries (bundled) | see `licenses/` | MIT | npm |
| Literata, Atkinson Hyperlegible (fonts) | | SIL Open Font License 1.1 | Google Fonts / Fontsource |

mGBA is used unmodified, as published by its authors in the development build
named above. Its source code is available at the link above.

## Downloaded on first launch

| Data | Licence | Source |
| --- | --- | --- |
| German dictionary: English Wiktionary, via the Kaikki.org extract | CC BY-SA 4.0 | https://kaikki.org, https://en.wiktionary.org |
| Pokémon, move, ability, item and place names | BSD 3-Clause (PokéAPI data) | https://github.com/PokeAPI/pokeapi |
| Translation model Opus-MT de-en (ONNX conversion `Xenova/opus-mt-de-en`) | CC BY 4.0 | https://github.com/Helsinki-NLP/Opus-MT |

Pokémon and all related names are trademarks of Nintendo, Creatures Inc. and
GAME FREAK inc. Pokélearning is a fan-made learning tool and is not affiliated
with them.
