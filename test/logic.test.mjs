// 실행: node test/logic.test.mjs   (의존성 없음)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const L = require('../js/logic.js');
const C = require('../js/config.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const NOW = new Date(2026, 8, 28, 10, 0); // 2026-09-28
const D = '2026-09-28';
function dbWith(list) { const r = L.addQuestions(L.emptyDb(), D, list, 'AI', NOW); assert.ok(r.ok); return r.db; }
const EVAL_TEXT = [
  '**[가스기술사] 점수: 70**', '평가: 현장 대책이 부족합니다.', '',
  '[공학박사] 점수: 80점', '원리 설명은 정확합니다.', '',
  '[채점위원] 점수 : 65 / 100', '결론이 약합니다.', '',
  '[전문기자] 점수: 90', '동향 연결이 좋습니다.', '',
  '[종합의견]', '결론을 보강하십시오.'
].join('\n');

console.log('설정 (기획서 3장·제출 원문)');
test('영역 10개, 원문 순서·이름 그대로', () => {
  assert.deepEqual(C.AREAS.map(a => a.name), ['연소·폭발공학', '방폭공학', '기초역학', '연소기기 및 가스용품', '고압가스', 'LPG 설비', '도시가스', '수소안전', '가스용기', '저장탱크']);
  assert.deepEqual(C.AREAS.map(a => a.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
test('평가 관점 4개, 사고 카드 5항목, 기술 카드 기술명+5항목', () => {
  assert.deepEqual(C.ROLES.map(r => r.label), ['가스기술사', '공학박사', '채점위원', '전문기자']);
  assert.deepEqual(C.ACCIDENT_FIELDS.map(f => f.label), ['사고 개요', '사고 원인', '사고발생 메커니즘', '재발방지대책', '가스기술사 종합의견']);
  assert.deepEqual(C.TECH_FIELDS.map(f => f.label), ['기술 정의', '기존 기술의 문제점', '핵심 기술', '적용 분야', '향후 발전방향']);
  assert.equal(L.cardColumns('tech')[1].label, '기술명');
});

console.log('출제');
test('출제 프롬프트: 10개 영역 머리줄 + 이전 문제 포함', () => {
  const db = dbWith([{ area_id: 3, question: '베르누이 방정식을 설명하시오.' }]);
  const p = L.buildQuestionPrompt(db, '2026-09-29');
  for (const a of C.AREAS) assert.ok(p.includes('[' + a.id + '] ' + a.name), a.name);
  assert.ok(p.includes('- 베르누이 방정식을 설명하시오.'));
  assert.equal((p.match(/이미 출제된 문제: 없음/g) || []).length, 9);
});
test('답변 나누기: [번호] 영역명 / [영역명] 문장 / 굵게·「문제:」 머리', () => {
  const r = L.parseQuestions('**[1] 연소·폭발공학**\n문제: MIE를 설명하시오.\n\n[방폭공학] 내압방폭구조를 설명하시오.\n[3] 기초역학 (Fluid)\nQ: 관로 손실\n두 줄째');
  assert.deepEqual(r.items, [
    { area_id: 1, question: 'MIE를 설명하시오.' },
    { area_id: 2, question: '내압방폭구조를 설명하시오.' },
    { area_id: 3, question: '관로 손실\n두 줄째' }]);
  assert.deepEqual(r.missing, [4, 5, 6, 7, 8, 9, 10]);
});
test('영역이 아닌 대괄호 줄은 본문으로 남고, 없는 번호는 unknown', () => {
  const r = L.parseQuestions('[1] 연소·폭발공학\n문제 본문\n[확인 필요] 조항\n[11] 없는 영역\n내용');
  assert.equal(r.items[0].question, '문제 본문\n[확인 필요] 조항');
  assert.deepEqual(r.unknown, ['11']);
});
test('같은 영역이 두 번이면 첫 문제만', () => {
  const r = L.parseQuestions('[2] 방폭공학\nA\n[2] 방폭공학\nB');
  assert.equal(r.items.length, 1); assert.equal(r.items[0].question, 'A'); assert.deepEqual(r.duplicated, [2]);
});
test('비슷한 문제 경고 (띄어쓰기·문장부호 무시), 다른 문제는 통과', () => {
  const db = dbWith([{ area_id: 1, question: '최소점화에너지의 정의와 영향 인자를 설명하시오.' }]);
  assert.equal(L.findSimilar(db.items, '최소 점화에너지의 정의와 영향인자를 설명하시오').length, 1);
  assert.equal(L.findSimilar(db.items, '수소취성의 발생 과정과 방지대책을 설명하시오.').length, 0);
  const r = L.addQuestions(db, '2026-09-29', [{ area_id: 1, question: '최소점화에너지의 정의와 영향 인자를 설명하시오' }], 'AI', NOW);
  assert.ok(r.ok); assert.equal(r.warnings[0].code, 'similar');
});
test('잘못된 날짜·영역은 저장 거부', () => {
  assert.equal(L.addQuestions(L.emptyDb(), '2026-02-30', [{ area_id: 1, question: 'x' }]).ok, false);
  assert.equal(L.addQuestions(L.emptyDb(), D, [{ area_id: 11, question: 'x' }]).ok, false);
});

console.log('풀이 단계 (문제 → 답안 → AI 평가 → 모범답안)');
test('순서 고정: 제출 전 평가 불가, 평가 전 모범답안 불가', () => {
  let db = dbWith([{ area_id: 5, question: 'Q' }]);
  assert.equal(L.stageOf(L.findItem(db, D, 5)), 'question');
  assert.equal(L.saveEval(db, D, 5, L.parseEval(EVAL_TEXT), NOW).code, 'not_submitted');
  assert.equal(L.saveModel(db, D, 5, '[서론]', NOW).code, 'not_evaluated');
  db = L.saveAnswer(db, D, 5, { intro: '서', body: '', conclusion: '' }, { now: NOW }).db;
  assert.equal(L.stageOf(L.findItem(db, D, 5)), 'draft');
  assert.equal(L.saveAnswer(db, D, 5, { body: '  ' }, { now: NOW, submit: true }).code, 'empty_body');
  db = L.saveAnswer(db, D, 5, { intro: '서', body: '본', conclusion: '결' }, { now: NOW, submit: true }).db;
  assert.equal(L.stageOf(L.findItem(db, D, 5)), 'submitted');
  assert.equal(L.saveAnswer(db, D, 5, { body: '고침' }, { now: NOW }).code, 'already_submitted');
  assert.equal(L.addQuestions(db, D, [{ area_id: 5, question: '문제 고침' }]).ok, false, '답안이 있으면 문제 고정');
  db = L.saveEval(db, D, 5, L.parseEval(EVAL_TEXT), NOW).db;
  assert.equal(L.stageOf(L.findItem(db, D, 5)), 'evaluated');
  assert.equal(L.reopenAnswer(db, D, 5).code, 'already_evaluated');
  db = L.saveModel(db, D, 5, '[서론] a [본론] b [결론] c', NOW).db;
  assert.equal(L.stageOf(L.findItem(db, D, 5)), 'done');
});
test('평가 프롬프트에 문제·답안 세 부분·네 관점 기준·형식이 들어감', () => {
  const p = L.buildEvalPrompt({ area_id: 8, question: '수소 문제', ans_intro: 'INTRO', ans_body: 'BODY', ans_conclusion: '' });
  for (const s of ['수소안전', '수소 문제', '[서론]\nINTRO', '[본론]\nBODY', '[결론]\n(비어 있음)', '[종합의견]', '[확인 필요]']) assert.ok(p.includes(s), s);
  for (const r of C.ROLES) { assert.ok(p.includes('[' + r.label + '] 점수')); r.criteria.forEach(c => assert.ok(p.includes(c))); }
});
test('평가 답변 나누기: 네 점수·의견·종합, 종합 점수 = 평균', () => {
  const r = L.parseEval(EVAL_TEXT);
  assert.deepEqual(r.scores, { engineer: 70, doctor: 80, grader: 65, reporter: 90 });
  assert.equal(r.comments.engineer, '현장 대책이 부족합니다.');
  assert.equal(r.comments.grader, '결론이 약합니다.');
  assert.equal(r.summary, '결론을 보강하십시오.');
  assert.equal(r.total, 76.3);
  assert.deepEqual(r.missing, []);
});
test('빠진 관점·범위 밖 점수는 알리고 저장 거부', () => {
  const r = L.parseEval('[가스기술사] 점수: 120\nx\n[공학박사] 점수: 50\ny');
  assert.equal(r.scores.engineer, null);
  assert.ok(r.problems[0].includes('0~100'));
  assert.deepEqual(r.missing, ['가스기술사', '채점위원', '전문기자', '종합의견']);
  assert.equal(r.total, null);
  let db = dbWith([{ area_id: 1, question: 'Q' }]);
  db = L.saveAnswer(db, D, 1, { body: 'b' }, { now: NOW, submit: true }).db;
  assert.equal(L.saveEval(db, D, 1, r, NOW).code, 'missing_scores');
});
test('모범답안 형식 확인: 빠진 부분과 [확인 필요] 개수', () => {
  const c = L.checkModelAnswer('[서론] a\n[본론] b [확인 필요] c [확인 필요]');
  assert.deepEqual(c.missingSections, ['결론']); assert.equal(c.needsCheck, 2);
  assert.equal(L.checkModelAnswer('  ').ok, false);
});

console.log('학습 기록·영역별 현황');
test('날짜별 요약과 영역별 평균·최근·취약 영역', () => {
  const db = Sample.build(NOW);
  const sums = L.setSummaries(db);
  assert.equal(sums.length, 2);
  assert.ok(sums[0].set_date > sums[1].set_date, '최신 날짜가 먼저');
  assert.equal(sums[1].evaluated, 6);
  const st = L.areaStats(db);
  const a1 = st.find(r => r.area_id === 1);
  assert.equal(a1.evaluated, 2);
  assert.equal(a1.avg, 70.7); // 저장된 종합 68.8(=68.75 반올림)과 72.5의 평균
  assert.equal(a1.last, (76 + 70 + 78 + 66) / 4);
  assert.equal(st.find(r => r.area_id === 10).avg, null);
  const weak = st.filter(r => r.weakest).map(r => r.area_id);
  assert.deepEqual(weak, [8]); // 예시 점수에서 수소안전(53.8)이 가장 낮음
});

console.log('사고·기술 카드');
test('제목 필수, URL 형식, 출처 없이 「확인」 체크 불가', () => {
  assert.deepEqual(L.validateCard('accident', {}).errors, [{ field: 'title', code: 'required' }]);
  assert.equal(L.validateCard('tech', { title: 't', src_url: 'www.x' }).errors[0].code, 'bad_url');
  assert.equal(L.validateCard('tech', { title: 't', src_checked: true }).errors[0].code, 'source_needed');
  assert.equal(L.validateCard('tech', { title: 't', type: '없는 분야' }).errors[0].code, 'bad_code');
});
test('출처가 있고 원문 확인 체크까지 해야 「확인」, 아니면 미확인', () => {
  assert.equal(L.cardVerified({ src_title: '보고서' }), false);
  assert.equal(L.cardVerified({ src_checked: 'Y' }), false);
  assert.equal(L.cardVerified({ src_url: 'https://a.b', src_checked: 'Y' }), true);
});
test('카드 저장: 번호 채번·수정·삭제', () => {
  let r = L.upsertCard(L.emptyDb(), 'accident', { title: '가', overview: 'o', src_checked: false }, NOW);
  assert.equal(r.id, 'ACC-001');
  r = L.upsertCard(r.db, 'accident', { title: '나' }, NOW);
  assert.equal(r.id, 'ACC-002');
  r = L.upsertCard(r.db, 'accident', { id: 'ACC-001', title: '가2', src_title: 's', src_checked: true }, NOW);
  assert.equal(r.created, false);
  assert.equal(r.db.accidents[0].title, '가2'); assert.equal(r.db.accidents[0].src_checked, 'Y');
  const d = L.deleteCard(r.db, 'accident', 'ACC-002');
  assert.equal(d.db.accidents.length, 1);
  assert.equal(L.upsertCard(L.emptyDb(), 'tech', { title: 't' }, NOW).id, 'TEC-001');
});

console.log('내보내기·가져오기');
test('CSV: BOM·따옴표·줄바꿈 처리', () => {
  const csv = L.toCsv([{ key: 'a', label: '가' }, { key: 'b', label: '나' }], [{ a: '1,2', b: '줄\n바꿈"' }]);
  assert.equal(csv, '﻿가,나\r\n"1,2","줄\n바꿈"""');
});
test('엑셀 시트 왕복: 예시 데이터가 그대로 돌아옴', () => {
  const db = Sample.build(NOW);
  const back = L.sheetsToDb(L.dbToSheets(db));
  assert.deepEqual(back.report.problems, []);
  assert.equal(back.db.items.length, db.items.length);
  const pick = it => [it.set_date, it.area_id, it.question, it.score_total, it.eval_at, it.model_answer || ''].join('|');
  assert.deepEqual(back.db.items.map(pick).sort(), db.items.map(pick).sort());
  assert.deepEqual(back.db.accidents[0].title, db.accidents[0].title);
  assert.equal(L.stageOf(back.db.items.find(i => i.area_id === 9 && !i.ans_submitted_at && i.ans_body)), 'draft');
});
test('가져오기: 나쁜 행은 건너뛰고 알림, 필드 키 머리행도 읽음', () => {
  const r = L.sheetsToDb({
    '학습기록': [['set_date', 'area_id', 'question', '종합 점수'], ['2026.09.01', 1, 'q1', 70], ['2026-09-01', 1, 'dup', ''], ['x', 2, 'q', ''], ['2026-09-02', 3, 'q3', 'abc']],
    '사고카드': [['카드번호', '사고명'], ['ACC-001', '']]
  });
  assert.equal(r.db.items.length, 2);
  assert.equal(r.db.items[0].set_date, '2026-09-01');
  assert.equal(r.db.items[0].score_total, 70);
  assert.equal(r.db.items[1].score_total, '');
  assert.equal(r.report.problems.length, 3);
  assert.equal(r.db.accidents.length, 0);
  assert.deepEqual(r.report.skipped, ['기술카드']);
});

console.log('예시 데이터');
test('예시 데이터: 「예시」 표시, 날짜·영역 중복 없음, 점수 범위, 카드는 미확인', () => {
  const db = Sample.build(NOW);
  assert.equal(db._sample, true);
  const keys = new Set(db.items.map(i => i.set_date + '/' + i.area_id));
  assert.equal(keys.size, db.items.length);
  for (const it of db.items) {
    assert.ok(it.question.startsWith('(예시)'), it.question);
    assert.equal(it.q_source, '예시');
    if (it.ans_body) assert.ok(it.ans_body.startsWith('(예시'));
    if (it.eval_at) { assert.equal(it.score_total, L.totalScore({ engineer: it.score_engineer, doctor: it.score_doctor, grader: it.score_grader, reporter: it.score_reporter })); assert.ok(it.cmt_engineer.includes('예시')); }
    if (it.model_answer) assert.ok(it.eval_at);
  }
  // 두 날짜의 문제끼리 겹치지 않음 (출제 이력 중복 검사를 통과해야 함)
  for (const it of db.items) assert.equal(L.findSimilar(db.items, it.question, { exclude: it }).length, 0, it.question);
  assert.ok([...db.accidents, ...db.techs].every(c => !L.cardVerified(c) && c.title.includes('예시')));
  assert.equal(L.itemsOfDate(db, '2026-09-28').length, 0, '오늘은 비워 둠');
});

console.log(process.exitCode ? '\n실패가 있습니다.' : '\n전체 ' + passed + '개 통과');
