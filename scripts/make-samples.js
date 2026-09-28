// 예시 데이터 파일 생성: node scripts/make-samples.js
// js/sample-data.js 를 2026-09-28 기준 날짜로 풀어 samples/ 에 xlsx·csv 로 씁니다.
// 앱의 「예시 데이터 불러오기」는 같은 원본을 오늘 기준 날짜로 불러옵니다.
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const db = Sample.build(new Date(2026, 8, 28));
const sheets = L.dbToSheets(db);
const XLSX_NAME = '예시데이터_가스기술사학습.xlsx';

const wb = XLSX.utils.book_new();
for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
fs.writeFileSync(path.join(out, XLSX_NAME), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));

fs.writeFileSync(path.join(out, '예시데이터_학습기록.csv'), L.toCsv(L.itemColumns(), L.itemRows(db.items)));
fs.writeFileSync(path.join(out, '예시데이터_영역별현황.csv'), L.toCsv(
  [{ key: 'area_id', label: '영역번호' }, { key: 'area_name', label: '영역' }, { key: 'count', label: '출제' },
    { key: 'submitted', label: '답안 제출' }, { key: 'evaluated', label: 'AI 평가' }, { key: 'avg', label: '평균 점수' },
    { key: 'last', label: '최근 점수' }, { key: 'last_date', label: '최근 평가일' }],
  L.areaStats(db)));

// 검증: 방금 쓴 xlsx 를 앱과 같은 방식으로 다시 읽어 원본과 같은지 확인
const back = XLSX.read(fs.readFileSync(path.join(out, XLSX_NAME)), { type: 'buffer', cellDates: true });
const read = {};
back.SheetNames.forEach(n => { read[n] = XLSX.utils.sheet_to_json(back.Sheets[n], { header: 1, raw: true, defval: '' }); });
const res = L.sheetsToDb(read);
const norm = (list, cols) => list.map(r => cols.map(c => r[c.key] == null ? '' : String(r[c.key])).join('\u0001')).sort();
const checks = [['items', L.itemColumns().filter(c => c.key !== 'area_name')], ['accidents', L.cardColumns('accident')], ['techs', L.cardColumns('tech')]];
for (const [k, cols] of checks) {
  if (JSON.stringify(norm(res.db[k], cols)) !== JSON.stringify(norm(db[k], cols))) { console.error('왕복 불일치: ' + k); process.exit(1); }
}
console.log('samples/ 생성·왕복 확인 완료:', res.report.read.join(', '), res.report.problems.length ? res.report.problems : '');
