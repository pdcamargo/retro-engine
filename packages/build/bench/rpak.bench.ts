// .rpak pack/read hot path (ADR-0151, web export):
//
// - Export packs every project asset into one archive; the runtime parses the
//   TOC and reads assets by GUID. Both costs grow with asset count. This bench
//   packs 200 ~1 KB entries (codec 'none', to isolate the format layout/TOC from
//   compression) and reads them all back.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0151 (.rpak format).

import { bench, summary } from 'mitata';

import { RpakReader } from '../src/rpak-reader';
import { type RpakInput, writeRpak } from '../src/rpak-writer';

const COUNT = 200;
const inputs: RpakInput[] = [];
for (let i = 0; i < COUNT; i++) {
  const data = new Uint8Array(1024);
  for (let j = 0; j < data.length; j++) data[j] = (i + j) & 0xff;
  inputs.push({ guid: `asset-${i}`, data });
}

const archive = await writeRpak(inputs);

summary(() => {
  bench(`writeRpak: pack ${COUNT}×1KB entries`, async () => {
    await writeRpak(inputs);
  });
  bench(`RpakReader: parse + read ${COUNT} entries by GUID`, async () => {
    const reader = new RpakReader(archive);
    for (const input of inputs) await reader.read(input.guid);
  });
});
