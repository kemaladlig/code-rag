// Pilot evaluation: does semantic search surface the right file for a
// natural-language question about the code? Run: node eval.mjs
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

for (const [query, expected] of CASES) {
  const results = await searchQuery(query, 5);
  const rank = results.findIndex((r) => r.relpath === expected) + 1;
  const top = results[0]?.relpath ?? '-';
  const mark = rank ? 'HIT ' : 'MISS';
  if (rank === 1) top1++;
  if (rank) top5++;
  if (rank) mrr += 1 / rank;
  console.log(`${mark} r=${rank || '-'} | ${query} -> ${top} (expected ${expected})`);
}

const n = CASES.length;
console.log(
  `\nrecall@1=${top1}/${n} (${Math.round((top1 / n) * 100)}%)  ` +
    `recall@5=${top5}/${n} (${Math.round((top5 / n) * 100)}%)  MRR=${(mrr / n).toFixed(3)}`
);
