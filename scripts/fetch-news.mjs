// 가스사고 기사 목록 갱신 — GitHub Actions(.github/workflows/news.yml)가 매일 실행합니다.
// 실행: node scripts/fetch-news.mjs   (Node 18 이상, 의존성 없음)
//
// 공개 RSS(Google 뉴스 검색)의 메타데이터(제목·링크·날짜·언론사)만 data/news.json 에 저장합니다.
// 기사 본문은 받지도 저장하지도 않습니다(저작권). 읽기·합치기 로직은 화면과 같은 js/logic.js 를 씁니다.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const C = require('../js/config.js');

const OUT = new URL('../' + C.NEWS.jsonPath, import.meta.url);
const rssUrl = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(q) + '&hl=ko&gl=KR&ceid=KR:ko';

let prev = [];
try { prev = JSON.parse(await readFile(OUT, 'utf8')).items || []; } catch { /* 처음이면 빈 목록 */ }

const fresh = [];
const report = [];
for (const q of C.NEWS.queries) {
  try {
    const res = await fetch(rssUrl(q), { headers: { 'User-Agent': 'Mozilla/5.0 (data09-02 news list)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = L.parseRss(await res.text(), q);
    fresh.push(...items);
    report.push(q + ' ' + items.length + '건');
  } catch (e) {
    report.push(q + ' 실패(' + e.message + ')');
  }
}
if (!fresh.length) { console.error('새로 받은 기사가 없습니다: ' + report.join(', ')); process.exit(prev.length ? 0 : 1); }

const now = new Date();
// 새로 받은 것을 앞에 두어 제목·언론사가 최신 표기로 남게 합니다
const items = L.mergeNews([fresh, prev], { now, keepDays: C.NEWS.keepDays, max: C.NEWS.maxItems })
  .map(({ title, link, date, published, source, query }) => ({ title, link, date, published, source, query }));
const out = {
  updated_at: now.toISOString(),
  source: 'Google 뉴스 RSS 검색 (' + C.NEWS.queries.join(', ') + ') — 제목·링크·날짜·언론사만 저장, 본문 없음',
  count: items.length,
  items
};
await writeFile(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(report.join(', ') + ' → 합계 ' + items.length + '건 (이전 ' + prev.length + '건)');
