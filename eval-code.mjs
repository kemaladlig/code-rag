// Variant of eval.mjs that measures ranking among CODE chunks only. Filtering
// docs out of the ranked list is equivalent to not indexing docs at all (cosine
// scores are independent), so this answers "would dropping docs improve code
// precision?" without a re-index. Run: node eval-code.mjs
import { searchQuery } from './src/indexer.js';

const CASES = [
  ['raunt sayaci nerede sifirlanir', 'src/core/roundLifecycle.js'],
  ['klavye tus haritasi WASD oklar', 'src/core/inputMaps.js'],
  ['saha tasarim yaricapi olcek birimi', 'src/core/playfield.js'],
  ['oyuncu efekt zamanlayicilari ilerlet', 'src/core/playerEntity.js'],
  ['engel 2.5D pah golge stili', 'src/core/arenaKit.js'],
  ['power up dogus toplama', 'src/core/pickupSystem.js'],
  ['bot derin salt okunur proxy', 'src/core/botView.js'],
  ['fx partikul halka butce travma', 'src/core/fxKit.js'],
  ['saha zemini bake blit onbellek', 'src/core/fieldKit.js'],
  ['duvar darbesi enerji dalgasi kenar', 'src/core/fieldReactive.js'],
  ['ag state sync zarfi duzlestirme', 'src/core/networkProtocol.js'],
  ['snapshot sunum interpolasyon', 'src/core/worldInterpolation.js'],
  ['kendi avatarini tahmin etme', 'src/core/selfPrediction.js'],
  ['oyun kayit defteri kartus', 'src/core/engineRegistry.js'],
  ['kalite kapisi sozlesmesi', 'src/core/qualityGate.js'],
  ['isdigi tema pastel zemin rampalari', 'src/core/fieldKit.js'],
];

let top1 = 0;
let top5 = 0;
let mrr = 0;
let docHijacks = 0;

for (const [query, expected] of CASES) {
  const all = await searchQuery(query, 50);
  const code = all.filter((r) => r.relpath.startsWith('src/')).slice(0, 5);
  const allTop = all[0]?.relpath ?? '-';
  const hijack = !allTop.startsWith('src/');
  if (hijack) docHijacks++;
  const rank = code.findIndex((r) => r.relpath === expected) + 1;
  if (rank === 1) top1++;
  if (rank) top5++;
  if (rank) mrr += 1 / rank;
  console.log(
    `${rank ? 'HIT ' : 'MISS'} r=${rank || '-'} | code#1=${code[0]?.relpath ?? '-'} ` +
      `all#1=${allTop}${hijack ? ' [DOC]' : ''} | ${query}`
  );
}

const n = CASES.length;
console.log(
  `\ncode-only: recall@1=${top1}/${n} (${Math.round((top1 / n) * 100)}%)  ` +
    `recall@5=${top5}/${n} (${Math.round((top5 / n) * 100)}%)  MRR=${(mrr / n).toFixed(3)}  ` +
    `doc_hijacks=${docHijacks}/${n}`
);
