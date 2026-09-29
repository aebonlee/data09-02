/*
 * 가스기술사 학습 도구 — 순수 로직 모듈 (화면·저장소와 무관)
 * 브라우저에서는 window.GTLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때
 * 브라우저가 module 스크립트를 막기 때문입니다.
 *
 * 저장 구조 (엑셀 내보내기의 시트와 같습니다)
 *   items     : 학습기록 — 날짜×영역 한 행에 문제·답안·4관점 평가·모범답안
 *   accidents : 사고 카드 (5항목 + 출처)
 *   techs     : 기술 카드 (기술명 + 5항목 + 출처)
 */
(function (root) {
  'use strict';
  var C = (typeof module !== 'undefined' && module.exports) ? require('./config.js') : root.GTConfig;

  function emptyDb() { return { items: [], accidents: [], techs: [], news: [] }; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // ── 날짜 ─────────────────────────────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function toDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function toDateTimeStr(d) { return toDateStr(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function parseDate(s) {
    if (s instanceof Date) return isNaN(s) ? null : s;
    if (!s) return null;
    var m = String(s).trim().match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
    return d.getMonth() === +m[2] - 1 ? d : null; // 2월 30일 같은 값은 거부
  }
  function isDateStr(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !!parseDate(s); }

  // ── 영역·관점 ────────────────────────────────────────────────
  function areaOf(id) { id = Number(id); return C.AREAS.filter(function (a) { return a.id === id; })[0] || null; }
  function normName(s) { return String(s || '').replace(/[\s·ㆍ.,()]/g, '').toLowerCase(); }
  function areaByName(name) {
    var n = normName(name);
    if (!n) return null;
    return C.AREAS.filter(function (a) { return normName(a.name) === n; })[0] || null;
  }

  // ── 문제 중복 검사 (출제 이력 참조) ──────────────────────────
  function normText(s) { return String(s || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase(); }
  function bigrams(s) { var out = {}; for (var i = 0; i < s.length - 1; i++) out[s.slice(i, i + 2)] = (out[s.slice(i, i + 2)] || 0) + 1; return out; }
  // 글자 2개씩 묶어 겹치는 비율(다이스 계수). 1 = 같음, 0 = 전혀 다름
  function similarity(a, b) {
    a = normText(a); b = normText(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    var A = bigrams(a), B = bigrams(b), inter = 0, na = 0, nb = 0, k;
    for (k in A) { na += A[k]; if (B[k]) inter += Math.min(A[k], B[k]); }
    for (k in B) nb += B[k];
    return (2 * inter) / (na + nb);
  }
  // 이전 기록 중 비슷한 문제 (자기 자신 제외)
  function findSimilar(items, question, opts) {
    opts = opts || {};
    var th = opts.threshold == null ? C.SIMILAR_THRESHOLD : opts.threshold;
    return items.filter(function (it) {
      if (opts.exclude && it.set_date === opts.exclude.set_date && Number(it.area_id) === Number(opts.exclude.area_id)) return false;
      return similarity(it.question, question) >= th;
    }).map(function (it) { return { set_date: it.set_date, area_id: Number(it.area_id), question: it.question, score: similarity(it.question, question) }; });
  }
  // 영역별 최근 문제 (출제 프롬프트용, 최신순)
  function recentQuestions(items, areaId, limit) {
    return items.filter(function (it) { return Number(it.area_id) === Number(areaId) && it.question; })
      .sort(function (a, b) { return a.set_date < b.set_date ? 1 : a.set_date > b.set_date ? -1 : 0; })
      .slice(0, limit == null ? C.HISTORY_IN_PROMPT : limit)
      .map(function (it) { return it.question; });
  }

  // ── 1. 출제 ─────────────────────────────────────────────────
  function buildQuestionPrompt(db, date, areaIds) {
    var ids = areaIds && areaIds.length ? areaIds : C.AREAS.map(function (a) { return a.id; });
    var lines = [
      '당신은 가스기술사 필기시험 출제위원입니다.',
      '아래 영역마다 1문제씩, 가스기술사 필기시험 형식의 서술형 문제를 출제해 주세요.',
      '',
      '조건',
      '- 서론-본론-결론 구조로 A4 1~2쪽 분량의 답안을 쓸 수 있는 문제로 내 주세요.',
      '- 영역마다 「이미 출제된 문제」와 같거나 비슷한 문제는 피해 주세요.',
      '- 문제만 쓰고 답은 쓰지 마세요.',
      '- 특정 사고의 날짜·장소·피해 규모나 법령 조항 번호처럼 확인이 필요한 사실을 문제에 넣지 마세요.',
      '',
      '답변 형식 (번호와 영역명을 대괄호 줄로 쓰고, 다음 줄부터 문제를 씁니다)',
      '[번호] 영역명',
      '문제 내용',
      '',
      '출제일: ' + date,
      ''
    ];
    ids.forEach(function (id) {
      var a = areaOf(id);
      if (!a) return;
      lines.push('[' + a.id + '] ' + a.name);
      var hist = recentQuestions(db.items, a.id);
      if (hist.length) {
        lines.push('이미 출제된 문제:');
        hist.forEach(function (q) { lines.push('- ' + q.replace(/\s+/g, ' ')); });
      } else {
        lines.push('이미 출제된 문제: 없음');
      }
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  // AI 답변 → [{area_id, question}]. 「[3] 기초역학」 또는 「[기초역학]」 머리줄을 찾습니다.
  function parseQuestions(text) {
    var src = String(text || '').replace(/\r\n?/g, '\n');
    var re = /^[ \t>*#-]*\[\s*([^\]\n]{1,30})\s*\][ \t]*([^\n]*)$/gm;
    var heads = [], m, unknown = [];
    while ((m = re.exec(src))) {
      var tag = m[1].replace(/\*/g, '').trim();
      var rest = m[2].replace(/\*/g, '').trim();
      var area = null;
      var num = tag.match(/^(\d{1,2})\s*[.)]?\s*(.*)$/);
      if (num) area = areaOf(+num[1]);
      if (!area) area = areaByName(tag);
      if (!area && rest) area = areaByName(rest);
      // 영역으로 읽히지 않는 대괄호 줄(예: [확인 필요])은 머리줄이 아니라 본문으로 둡니다
      // 번호 머리줄인데 영역이 없으면(예: [11]) 알리고, 앞 문제가 거기서 끝나도록 경계로만 둡니다
      if (!area) { if (num) { unknown.push(tag); heads.push({ idx: m.index, end: re.lastIndex, area: null }); } continue; }
      heads.push({ idx: m.index, end: re.lastIndex, area: area, rest: rest });
    }
    var items = [], dup = [];
    var seen = {};
    heads.forEach(function (hd, i) {
      var body = src.slice(hd.end, i + 1 < heads.length ? heads[i + 1].idx : src.length);
      var area = hd.area;
      if (!area) return;
      var q = body.replace(/^\s*(문제|Q)\s*[:：.]\s*/m, '').replace(/\*\*/g, '').trim();
      // 머리줄에 영역명 뒤로 문장이 이어지면 그 문장도 문제로 봅니다
      var rest = hd.rest;
      var an = area.name;
      if (rest.indexOf(an) === 0) rest = rest.slice(an.length);
      else if (normName(rest) === normName(an)) rest = '';
      rest = rest.replace(/^\s*(\([^)]*\))?\s*[-:：]?\s*/, '').replace(/^\s*(문제|Q)\s*[:：.]\s*/, '').trim();
      if (rest) q = (rest + (q ? '\n' + q : '')).trim();
      if (!q) { unknown.push(area.name + '(문제 없음)'); return; }
      if (seen[area.id]) { dup.push(area.id); return; }
      seen[area.id] = true;
      items.push({ area_id: area.id, question: q });
    });
    items.sort(function (a, b) { return a.area_id - b.area_id; });
    var missing = C.AREAS.filter(function (a) { return !seen[a.id]; }).map(function (a) { return a.id; });
    return { items: items, missing: missing, unknown: unknown, duplicated: dup };
  }

  function findItem(db, date, areaId) {
    return db.items.filter(function (it) { return it.set_date === date && Number(it.area_id) === Number(areaId); })[0] || null;
  }
  function itemsOfDate(db, date) {
    return db.items.filter(function (it) { return it.set_date === date; })
      .sort(function (a, b) { return a.area_id - b.area_id; });
  }

  // 문제 넣기 (새 문제 추가 또는 아직 답안이 없는 문제 고치기)
  function addQuestions(db, date, list, source, now) {
    var errors = [], warnings = [];
    if (!isDateStr(date)) errors.push({ code: 'bad_date' });
    var out = clone(db);
    var added = 0, updated = 0;
    (list || []).forEach(function (q) {
      var area = areaOf(q.area_id);
      var text = String(q.question || '').trim();
      if (!area) { errors.push({ code: 'bad_area', area_id: q.area_id }); return; }
      if (!text) return;
      var cur = findItem(out, date, area.id);
      if (cur && stageOf(cur) !== 'question') { errors.push({ code: 'locked', area_id: area.id }); return; }
      var sim = findSimilar(out.items, text, { exclude: { set_date: date, area_id: area.id } });
      if (sim.length) warnings.push({ code: 'similar', area_id: area.id, matches: sim });
      if (cur) { cur.question = text; cur.q_source = source || cur.q_source; updated++; }
      else {
        out.items.push({ set_date: date, area_id: area.id, question: text, q_source: source || '직접', created_at: toDateTimeStr(now || new Date()) });
        added++;
      }
    });
    if (errors.length) return { ok: false, errors: errors, warnings: warnings };
    return { ok: true, db: out, added: added, updated: updated, warnings: warnings };
  }

  // ── 단계 ────────────────────────────────────────────────────
  // question(문제만) → draft(임시저장) → submitted(답안 제출) → evaluated(AI 평가) → done(모범답안 공개)
  var STAGES = ['question', 'draft', 'submitted', 'evaluated', 'done'];
  var STAGE_LABEL = { question: '문제', draft: '답안 작성 중', submitted: '답안 제출', evaluated: 'AI 평가 완료', done: '모범답안 공개' };
  function stageOf(it) {
    if (!it) return null;
    if (it.model_answer && it.eval_at) return 'done';
    if (it.eval_at) return 'evaluated';
    if (it.ans_submitted_at) return 'submitted';
    if (it.ans_intro || it.ans_body || it.ans_conclusion) return 'draft';
    return 'question';
  }
  function stageIndex(it) { return STAGES.indexOf(stageOf(it)); }

  // ── 2. 답안 ─────────────────────────────────────────────────
  function answerText(it) {
    return ['서론', '본론', '결론'].map(function (lab, i) {
      var v = String(it[['ans_intro', 'ans_body', 'ans_conclusion'][i]] || '').trim();
      return '[' + lab + ']\n' + (v || '(비어 있음)');
    }).join('\n\n');
  }
  // submit=true 면 제출(평가 단계로). 제출 뒤에는 고칠 수 없습니다(평가 대상이 바뀌지 않게).
  function saveAnswer(db, date, areaId, parts, opts) {
    opts = opts || {};
    var out = clone(db);
    var it = findItem(out, date, areaId);
    if (!it) return { ok: false, code: 'no_item' };
    if (it.ans_submitted_at) return { ok: false, code: 'already_submitted' };
    it.ans_intro = String(parts.intro || '');
    it.ans_body = String(parts.body || '');
    it.ans_conclusion = String(parts.conclusion || '');
    var ts = toDateTimeStr(opts.now || new Date());
    it.ans_saved_at = ts;
    if (opts.submit) {
      if (!String(parts.body || '').trim()) return { ok: false, code: 'empty_body' };
      it.ans_submitted_at = ts;
    }
    return { ok: true, db: out };
  }
  // 제출 취소는 평가 전까지만
  function reopenAnswer(db, date, areaId) {
    var out = clone(db);
    var it = findItem(out, date, areaId);
    if (!it || !it.ans_submitted_at) return { ok: false, code: 'not_submitted' };
    if (it.eval_at) return { ok: false, code: 'already_evaluated' };
    it.ans_submitted_at = '';
    return { ok: true, db: out };
  }

  // ── 3. 4관점 AI 평가 ────────────────────────────────────────
  function rolePromptBlock() {
    var lines = [];
    C.ROLES.forEach(function (r, i) {
      lines.push((i + 1) + '. ' + r.label + ' — ' + r.focus);
      r.criteria.forEach(function (c) { lines.push('   - ' + c); });
    });
    return lines.join('\n');
  }
  function evalFormatBlock() {
    var lines = [];
    C.ROLES.forEach(function (r) {
      lines.push('[' + r.label + '] 점수: (0~100 사이 정수)');
      lines.push('평가: (잘한 점, 부족한 점, 보완 방법을 3~6줄로)');
      lines.push('');
    });
    lines.push('[' + C.SUMMARY_LABEL + ']');
    lines.push('(네 관점을 종합해 이 답안에서 가장 먼저 고칠 점 3가지와 총평)');
    return lines.join('\n');
  }
  function buildEvalPrompt(it) {
    var area = areaOf(it.area_id) || { name: '' };
    return [
      '가스기술사 필기시험 답안을 네 전문가 관점에서 차례로 평가해 주세요.',
      '각 관점은 100점 만점으로 따로 점수를 매겨 주세요.',
      '',
      '평가 관점과 기준',
      rolePromptBlock(),
      '',
      '주의',
      '- 법령·KGS 코드 조항 번호, 사고의 날짜·장소·피해 규모처럼 확인이 필요한 사실은 확실할 때만 쓰고, 확실하지 않으면 [확인 필요]라고 표시해 주세요.',
      '- 모범답안은 아직 쓰지 마세요. 평가만 해 주세요.',
      '',
      '답변 형식 (대괄호 머리줄을 그대로 써 주세요)',
      evalFormatBlock(),
      '',
      '---',
      '영역: ' + area.name,
      '문제: ' + it.question,
      '',
      '수험자 답안',
      answerText(it)
    ].join('\n');
  }

  function roleByLabel(label) {
    var n = normName(label);
    return C.ROLES.filter(function (r) {
      var ln = normName(r.label);
      return n === ln || n.indexOf(ln) !== -1;
    })[0] || null;
  }
  function parseScore(seg) {
    var m = seg.match(/점수\s*[:：]?\s*(\d{1,3}(?:\.\d+)?)\s*(?:점|\/\s*100)?/);
    if (!m) return { value: null, raw: null };
    var v = Number(m[1]);
    return { value: v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null, raw: m[0], outOfRange: !(v >= 0 && v <= 100) };
  }
  // AI 답변 → { scores:{engineer:..}, comments:{...}, summary, total, missing:[], problems:[] }
  function parseEval(text) {
    var src = String(text || '').replace(/\r\n?/g, '\n');
    var re = /^[ \t>*#-]*\[\s*([^\]\n]{1,20})\s*\][ \t]*([^\n]*)$/gm;
    var heads = [], m;
    while ((m = re.exec(src))) heads.push({ idx: m.index, end: re.lastIndex, tag: m[1].replace(/\*/g, ''), rest: m[2] });
    var res = { scores: {}, comments: {}, summary: '', total: null, missing: [], problems: [] };
    heads.forEach(function (hd, i) {
      var body = src.slice(hd.end, i + 1 < heads.length ? heads[i + 1].idx : src.length);
      if (normName(hd.tag).indexOf(normName(C.SUMMARY_LABEL)) !== -1 || normName(hd.tag) === '종합') {
        res.summary = (hd.rest.replace(/^\s*점수[^\n]*/, '') + '\n' + body).trim();
        return;
      }
      var role = roleByLabel(hd.tag);
      if (!role || res.scores[role.key] != null) return;
      var seg = hd.rest + '\n' + body;
      var sc = parseScore(seg);
      if (sc.outOfRange) res.problems.push(role.label + ': 점수가 0~100 밖입니다');
      res.scores[role.key] = sc.value;
      var cmt = seg.replace(sc.raw || '\u0000', '').replace(/^\s*(평가|의견)\s*[:：]\s*/m, '').replace(/\*\*/g, '').trim();
      res.comments[role.key] = cmt;
    });
    C.ROLES.forEach(function (r) {
      if (res.scores[r.key] == null) res.missing.push(r.label);
    });
    if (!res.summary) res.missing.push(C.SUMMARY_LABEL);
    res.total = totalScore(res.scores);
    return res;
  }
  // 종합 점수 = 네 관점 점수의 평균(소수 첫째 자리). 하나라도 없으면 null (기획서 10장: 합산 방식 확인 필요)
  function totalScore(scores) {
    var sum = 0;
    for (var i = 0; i < C.ROLES.length; i++) {
      var v = scores[C.ROLES[i].key];
      if (v == null || v === '' || isNaN(Number(v))) return null;
      sum += Number(v);
    }
    return Math.round(sum / C.ROLES.length * 10) / 10;
  }
  function saveEval(db, date, areaId, parsed, now) {
    var out = clone(db);
    var it = findItem(out, date, areaId);
    if (!it) return { ok: false, code: 'no_item' };
    if (!it.ans_submitted_at) return { ok: false, code: 'not_submitted' };
    var total = totalScore(parsed.scores || {});
    if (total == null) return { ok: false, code: 'missing_scores' };
    C.ROLES.forEach(function (r) {
      it['score_' + r.key] = Number(parsed.scores[r.key]);
      it['cmt_' + r.key] = String((parsed.comments || {})[r.key] || '');
    });
    it.score_total = total;
    it.cmt_total = String(parsed.summary || '');
    it.eval_at = toDateTimeStr(now || new Date());
    return { ok: true, db: out };
  }

  // ── 4. 모범답안 ─────────────────────────────────────────────
  function buildModelPrompt(it) {
    var area = areaOf(it.area_id) || { name: '' };
    var lines = [
      '다음 가스기술사 필기시험 문제의 모범답안을 써 주세요.',
      '',
      '형식',
      '- 기술사 시험 답안 형식, A4 1~2쪽 분량',
      '- [서론] [본론] [결론] 세 부분으로 나누고, 각 부분을 대괄호 머리줄로 시작해 주세요.',
      '- 본론은 번호를 붙인 항목으로 쓰고, 필요하면 표나 간단한 도식(글자로 그린 것)을 넣어 주세요.',
      '- 법령·KGS 코드 조항 번호, 사고의 날짜·장소·피해 규모처럼 확인이 필요한 사실은 확실할 때만 쓰고, 확실하지 않으면 [확인 필요]라고 표시해 주세요.',
      '',
      '영역: ' + area.name,
      '문제: ' + it.question
    ];
    if (it.eval_at && it.cmt_total) {
      lines.push('', '참고: 수험자 답안에 대한 종합 평가 (모범답안이 이 부족한 점을 채우도록 써 주세요)', it.cmt_total);
    }
    return lines.join('\n');
  }
  function checkModelAnswer(text) {
    var s = String(text || '');
    var miss = ['서론', '본론', '결론'].filter(function (k) { return s.indexOf(k) === -1; });
    return { ok: s.trim().length > 0, missingSections: miss, needsCheck: (s.match(/\[확인 필요\]/g) || []).length };
  }
  function saveModel(db, date, areaId, text, now) {
    var out = clone(db);
    var it = findItem(out, date, areaId);
    if (!it) return { ok: false, code: 'no_item' };
    if (!it.eval_at) return { ok: false, code: 'not_evaluated' }; // 평가 전에는 모범답안을 열지 않습니다
    if (!String(text || '').trim()) return { ok: false, code: 'empty' };
    it.model_answer = String(text).trim();
    it.model_at = toDateTimeStr(now || new Date());
    return { ok: true, db: out };
  }

  // ── 3·4단계 한 번에 (2026-09-29 추가 요청: 평가·모범답안을 AI 가 자동으로) ──────
  // 답안 분량 — 채점 기준 「분량」을 AI 가 어림하지 않고 실제 글자 수로 판단하도록 프롬프트에 넣습니다
  function answerStats(it) {
    var len = function (s) { return String(s || '').replace(/\s/g, '').length; };
    var intro = len(it.ans_intro), body = len(it.ans_body), concl = len(it.ans_conclusion);
    return { intro: intro, body: body, conclusion: concl, total: intro + body + concl };
  }
  var MARK_EVAL = '=====평가=====';
  var MARK_MODEL = '=====모범답안=====';
  // format: 'text'(채팅창에 붙여넣기용 — 구분자 두 줄) | 'json'(API 자동 모드 — JSON 한 덩어리)
  function buildCombinedPrompt(it, format) {
    var area = areaOf(it.area_id) || { name: '' };
    var st = answerStats(it);
    var lines = [
      '가스기술사 필기시험 답안을 평가하고, 이어서 같은 문제의 모범답안을 써 주세요.',
      '',
      '할 일 1. 네 전문가 관점에서 차례로 평가 (관점마다 100점 만점으로 따로 점수)',
      rolePromptBlock(),
      '',
      '모든 관점에 공통으로 적용할 가스기술사 답안 채점 기준',
      C.GRADING_GUIDE.map(function (g) { return '- ' + g; }).join('\n'),
      '',
      '할 일 2. 모범답안',
      '- 기술사 시험 답안 형식, A4 1~2쪽 분량',
      '- [서론] [본론] [결론] 세 부분으로 나누고, 각 부분을 대괄호 머리줄로 시작해 주세요.',
      '- 본론은 번호를 붙인 항목으로 쓰고, 핵심 키워드는 드러나게, 필요한 곳에 표나 글자로 그린 도식을 넣어 주세요.',
      '- 평가에서 지적한 부족한 점을 모범답안이 채우도록 써 주세요.',
      '',
      '주의',
      '- 법령·KGS 코드 조항 번호, 사고의 날짜·장소·피해 규모처럼 확인이 필요한 사실은 확실할 때만 쓰고, 확실하지 않으면 [확인 필요]라고 표시해 주세요.',
      ''
    ];
    if (format === 'json') {
      lines.push('답변 형식 — 아래 JSON 객체 하나만 출력하세요 (설명·코드블록 없이)',
        JSON.stringify({
          evaluations: C.ROLES.map(function (r) { return { role: r.label, score: 0, comment: '잘한 점, 부족한 점, 보완 방법 3~6줄' }; }),
          summary: '가장 먼저 고칠 점 3가지와 총평',
          model_answer: '[서론]\n…\n\n[본론]\n1. …\n\n[결론]\n…'
        }, null, 2),
        '- score 는 0~100 사이 정수입니다. role 은 위 네 관점 이름을 그대로 씁니다.');
    } else {
      lines.push('답변 형식 — 구분선 두 줄(' + MARK_EVAL + ', ' + MARK_MODEL + ')과 대괄호 머리줄을 그대로 써 주세요',
        MARK_EVAL, evalFormatBlock(), '', MARK_MODEL, '[서론]', '…', '[본론]', '…', '[결론]', '…');
    }
    lines.push('', '---',
      '영역: ' + area.name,
      '문제: ' + it.question,
      '',
      '수험자 답안 (공백 뺀 글자 수: 서론 ' + st.intro + ' · 본론 ' + st.body + ' · 결론 ' + st.conclusion + ' · 합계 ' + st.total + '자)',
      answerText(it));
    return lines.join('\n');
  }
  // ```json … ``` 으로 감싸 오거나 앞뒤에 말이 붙어도 가장 바깥 { … } 를 찾아 읽습니다
  function extractJson(text) {
    var s = String(text || '');
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1];
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a === -1 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }
  function fromJson(obj) {
    var res = { scores: {}, comments: {}, summary: '', total: null, missing: [], problems: [] };
    var list = Array.isArray(obj.evaluations) ? obj.evaluations : [];
    list.forEach(function (e) {
      var role = roleByLabel(e && (e.role || e.label || e.name));
      if (!role || res.scores[role.key] != null) return;
      var v = Number(e.score);
      if (e.score === '' || e.score == null || isNaN(v)) v = null;
      else if (v < 0 || v > 100) { res.problems.push(role.label + ': 점수가 0~100 밖입니다'); v = null; }
      else v = Math.round(v * 10) / 10;
      res.scores[role.key] = v;
      res.comments[role.key] = String(e.comment || e.evaluation || '').trim();
    });
    res.summary = String(obj.summary || obj[C.SUMMARY_LABEL] || '').trim();
    C.ROLES.forEach(function (r) { if (res.scores[r.key] == null) res.missing.push(r.label); });
    if (!res.summary) res.missing.push(C.SUMMARY_LABEL);
    res.total = totalScore(res.scores);
    return res;
  }
  // AI 답변(JSON 또는 구분선 텍스트) → { format, eval: parseEval 형태, model, problems }
  // format: 'json' | 'marker' | 'plain'(구분선 없음 — 평가만 읽고 모범답안은 비움)
  function parseCombined(text) {
    var src = String(text || '').replace(/\r\n?/g, '\n');
    var obj = extractJson(src);
    if (obj && (obj.evaluations || obj.model_answer)) {
      var ev = fromJson(obj);
      return { format: 'json', eval: ev, model: String(obj.model_answer || '').trim(), problems: ev.problems.slice() };
    }
    var norm = function (s) { return s.replace(/[\s=*#-]/g, ''); };
    var lines = src.split('\n');
    var iEval = -1, iModel = -1;
    lines.forEach(function (ln, i) {
      var n = norm(ln);
      if (iEval === -1 && n === norm(MARK_EVAL)) iEval = i;
      else if (iModel === -1 && n === norm(MARK_MODEL)) iModel = i;
    });
    if (iModel !== -1) {
      var evalText = lines.slice(iEval === -1 ? 0 : iEval + 1, iModel > iEval ? iModel : lines.length).join('\n');
      var modelText = lines.slice(iModel + 1, iEval > iModel ? iEval : lines.length).join('\n').trim();
      var ev2 = parseEval(evalText);
      return { format: 'marker', eval: ev2, model: modelText, problems: ev2.problems.slice() };
    }
    var ev3 = parseEval(src);
    return { format: 'plain', eval: ev3, model: '', problems: ev3.problems.concat(['「' + MARK_MODEL + '」 구분선을 찾지 못해 모범답안은 비워 두었습니다']) };
  }
  // 평가와 모범답안을 한 번에 저장 (평가가 완전할 때만 — 모범답안은 평가 뒤에만 열리는 규칙 유지)
  function saveCombined(db, date, areaId, parsed, now) {
    var r = saveEval(db, date, areaId, parsed.eval, now);
    if (!r.ok) return r;
    if (!String(parsed.model || '').trim()) return { ok: true, db: r.db, model: false };
    var m = saveModel(r.db, date, areaId, parsed.model, now);
    return m.ok ? { ok: true, db: m.db, model: true } : { ok: true, db: r.db, model: false };
  }

  // ── 자동 모드: OpenAI API 요청·응답 (키는 인자로만 받고 저장하지 않습니다) ──────
  // opts.json === false 면 글자 답변(출제용 — 「[번호] 영역명」 형식을 parseQuestions 가 읽음)
  function buildOpenAIRequest(prompt, model, opts) {
    var json = !opts || opts.json !== false;
    var req = {
      model: model || C.AI.defaultModel,
      temperature: json ? 0.3 : 0.8,
      messages: [
        { role: 'system', content: json ? '당신은 가스기술사 필기시험 채점위원이자 모범답안 집필자입니다. 반드시 요청한 JSON 형식으로만 답합니다.'
          : '당신은 가스기술사 필기시험 출제위원입니다. 요청한 답변 형식을 그대로 지킵니다.' },
        { role: 'user', content: prompt }
      ]
    };
    if (json) req.response_format = { type: 'json_object' };
    return req;
  }
  // 응답 JSON → 본문 글자. 오류 응답이면 사람이 읽을 메시지를 담아 던집니다.
  function extractOpenAIText(json, status) {
    if (json && json.error) throw new Error((status ? status + ' ' : '') + (json.error.message || json.error.code || '알 수 없는 오류'));
    var c = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content;
    if (!c) throw new Error('응답에 내용이 없습니다');
    return c;
  }
  function looksLikeApiKey(key) { return /^sk-[A-Za-z0-9_\-]{16,}$/.test(String(key || '').trim()); }
  // 화면 표시용 — 앞 3글자와 끝 4글자만 보입니다
  function maskKey(key) {
    var k = String(key || '').trim();
    if (!k) return '';
    if (k.length <= 8) return '••••';
    return k.slice(0, 3) + '••••••••' + k.slice(-4);
  }

  // ── 가스사고 기사 목록 (공개 RSS 메타데이터 + 사용자가 붙여 넣은 기사) ─────────
  function decodeEntities(s) {
    return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
      .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(+n); })
      .replace(/&amp;/g, '&');
  }
  function tagText(block, tag) {
    var m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i'));
    return m ? decodeEntities(m[1]).trim() : '';
  }
  // 한국 시각(UTC+9) 기준 날짜·시각 문자열
  function kstParts(d) {
    var k = new Date(d.getTime() + 9 * 3600 * 1000);
    var ds = k.getUTCFullYear() + '-' + pad(k.getUTCMonth() + 1) + '-' + pad(k.getUTCDate());
    return { date: ds, datetime: ds + ' ' + pad(k.getUTCHours()) + ':' + pad(k.getUTCMinutes()) };
  }
  // 기사 날짜 읽기 — 2026-09-28 · 2026.9.28. · 2026/09/28 · 2026년 9월 28일 · RFC 822(RSS) 모두 → 'YYYY-MM-DD'
  function parseNewsDate(s, now) {
    var t = String(s || '').trim();
    if (!t) return '';
    var m = t.match(/(\d{4})\s*(?:[-.\/]|년)\s*(\d{1,2})\s*(?:[-.\/]|월)\s*(\d{1,2})/);
    if (m) {
      var d = parseDate(m[1] + '-' + m[2] + '-' + m[3]);
      return d ? toDateStr(d) : '';
    }
    if (/[A-Za-z]{3},?\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}/.test(t) || /^\d{4}-\d{2}-\d{2}T/.test(t)) {
      var r = new Date(t);
      return isNaN(r) ? '' : kstParts(r).date;
    }
    // 연도 없는 「9월 28일」은 올해로 보되, 미래가 되면 작년으로
    var md = t.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (md && now) {
      var y = now.getFullYear();
      var dd = parseDate(y + '-' + md[1] + '-' + md[2]);
      if (dd && dd > now) dd = parseDate((y - 1) + '-' + md[1] + '-' + md[2]);
      return dd ? toDateStr(dd) : '';
    }
    return '';
  }
  // Google 뉴스 제목은 「기사 제목 - 언론사」 꼴이라 끝의 언론사를 떼어 냅니다
  function splitTitleSource(title, source) {
    var t = String(title || '').trim();
    if (source && t.slice(-(source.length + 3)) === ' - ' + source) return t.slice(0, -(source.length + 3)).trim();
    return t;
  }
  // RSS 2.0 XML → [{title, link, date, published, source, origin:'rss', query}] (기사 본문은 읽지 않습니다)
  function parseRss(xml, query) {
    var out = [];
    var re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi, m;
    while ((m = re.exec(String(xml || '')))) {
      var b = m[1];
      var source = tagText(b, 'source');
      var link = tagText(b, 'link');
      var title = splitTitleSource(tagText(b, 'title'), source);
      var pub = tagText(b, 'pubDate');
      var pd = pub ? new Date(pub) : null;
      if (!title || !link) continue;
      out.push({
        title: title, link: link, source: source,
        date: pd && !isNaN(pd) ? kstParts(pd).date : '',
        published: pd && !isNaN(pd) ? kstParts(pd).datetime : '',
        origin: 'rss', query: query || ''
      });
    }
    return out;
  }
  // 붙여넣기 — 빈 줄로 나눈 덩어리마다 기사 하나. 주소(http…)·날짜가 있는 줄을 찾고, 남은 첫 줄이 제목, 나머지가 본문
  function parseNewsPaste(text, now) {
    var blocks = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/);
    var items = [], problems = [];
    blocks.forEach(function (blk, i) {
      var lines = blk.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      if (!lines.length) return;
      var link = '', date = '', rest = [];
      lines.forEach(function (ln) {
        var u = ln.match(/https?:\/\/\S+/);
        if (u && !link) { link = u[0].replace(/[)\]>.,]+$/, ''); var left = ln.replace(u[0], '').replace(/^(URL|주소|링크)\s*[:：]\s*/i, '').trim(); if (left) rest.push(left); return; }
        var dt = !date && ln.length <= 40 ? parseNewsDate(ln.replace(/^(날짜|일자|입력|발행)\s*[:：]?\s*/, ''), now) : '';
        if (dt) { date = dt; return; }
        rest.push(ln);
      });
      var title = (rest.shift() || '').replace(/^(제목)\s*[:：]\s*/, '');
      var body = rest.join('\n').replace(/^(본문|내용)\s*[:：]\s*/, '');
      if (!date) { var inner = parseNewsDate(title + ' ' + body, now); if (inner) date = inner; }
      if (!title) { problems.push((i + 1) + '번째 덩어리: 제목을 찾지 못해 건너뜀'); return; }
      if (link && !/^https?:\/\/\S+$/i.test(link)) link = '';
      if (!date) problems.push((i + 1) + '번째 「' + title.slice(0, 20) + '」: 날짜를 찾지 못했습니다');
      items.push({ title: title, link: link, date: date, published: date, source: '', origin: 'paste', excerpt: excerpt(body) });
    });
    return { items: items, problems: problems };
  }
  // 본문 발췌 — 첫 문장들 위주로 n 자까지
  function excerpt(text, n) {
    n = n || 200;
    var s = String(text || '').replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    var cut = s.slice(0, n);
    var end = Math.max(cut.lastIndexOf('다. '), cut.lastIndexOf('. '));
    return (end > n * 0.5 ? cut.slice(0, end + 1) : cut) + '…';
  }
  // 같은 기사 판단: 주소가 같거나, 제목 글자가 거의 같으면(언론사만 다른 전재 포함) 한 건으로 봅니다
  function newsKey(n) { return normText(n.title).slice(0, 40); }
  function mergeNews(lists, opts) {
    opts = opts || {};
    var all = [];
    lists.forEach(function (l) { (l || []).forEach(function (n) { if (n && n.title) all.push(n); }); });
    var byLink = {}, byTitle = {}, out = [];
    all.forEach(function (n) {
      var lk = String(n.link || '');
      var tk = newsKey(n);
      var hit = (lk && byLink[lk]) || byTitle[tk];
      if (hit) {
        // 먼저 들어온 쪽을 두되, 빈 칸(날짜·발췌·언론사)은 뒤의 것으로 채웁니다
        ['date', 'published', 'source', 'excerpt', 'link'].forEach(function (k) { if (!hit[k] && n[k]) hit[k] = n[k]; });
        return;
      }
      var c = clone(n);
      out.push(c);
      if (lk) byLink[lk] = c;
      byTitle[tk] = c;
    });
    if (opts.now && opts.keepDays) {
      var lim = toDateStr(new Date(opts.now.getTime() - opts.keepDays * 86400000));
      out = out.filter(function (n) { return !n.date || n.date >= lim; });
    }
    out.sort(function (a, b) {
      var x = a.published || a.date || '', y = b.published || b.date || '';
      return x < y ? 1 : x > y ? -1 : 0; // 최신순, 날짜 없는 기사는 맨 뒤
    });
    if (opts.max) out = out.slice(0, opts.max);
    return out;
  }
  // 기사 → 사고 카드 초안 (출처는 「미확인」으로 시작 — 원문 확인은 사용자가 체크)
  function newsToCardDraft(n) {
    return {
      title: n.title, when: n.date ? n.date.slice(0, 7) : '', type: guessAccidentType(n.title + ' ' + (n.excerpt || '')),
      overview: n.excerpt ? n.excerpt : '', src_title: n.title, src_org: n.source || '', src_url: n.link || '', src_checked: false
    };
  }
  function guessAccidentType(s) {
    s = String(s || '');
    if (/폭발/.test(s)) return '폭발';
    if (/화재|불이|불길/.test(s)) return '화재';
    if (/누출|샘|유출/.test(s)) return '누출';
    return '';
  }
  var NEWS_COLUMNS = [{ key: 'date', label: '날짜' }, { key: 'title', label: '제목' }, { key: 'source', label: '언론사' },
    { key: 'link', label: 'URL' }, { key: 'excerpt', label: '발췌(붙여넣은 기사만)' }, { key: 'origin', label: '구분' }];

  // ── 학습 기록·영역별 현황 ─────────────────────────────────────
  function setSummaries(db) {
    var by = {};
    db.items.forEach(function (it) {
      var s = by[it.set_date] || (by[it.set_date] = { set_date: it.set_date, count: 0, submitted: 0, evaluated: 0, done: 0, sum: 0 });
      s.count++;
      var st = stageIndex(it);
      if (st >= 2) s.submitted++;
      if (st >= 3) { s.evaluated++; s.sum += Number(it.score_total) || 0; }
      if (st >= 4) s.done++;
    });
    return Object.keys(by).sort().reverse().map(function (k) {
      var s = by[k];
      s.avg = s.evaluated ? Math.round(s.sum / s.evaluated * 10) / 10 : null;
      delete s.sum;
      return s;
    });
  }
  function avg(list) {
    if (!list.length) return null;
    return Math.round(list.reduce(function (a, b) { return a + b; }, 0) / list.length * 10) / 10;
  }
  function areaStats(db) {
    var rows = C.AREAS.map(function (a) {
      var its = db.items.filter(function (it) { return Number(it.area_id) === a.id; });
      var ev = its.filter(function (it) { return it.eval_at && it.score_total !== '' && it.score_total != null; })
        .sort(function (x, y) { return x.set_date < y.set_date ? -1 : x.set_date > y.set_date ? 1 : 0; });
      var row = {
        area_id: a.id, area_name: a.name,
        count: its.length,
        submitted: its.filter(function (it) { return !!it.ans_submitted_at; }).length,
        evaluated: ev.length,
        avg: avg(ev.map(function (it) { return Number(it.score_total); })),
        last: ev.length ? Number(ev[ev.length - 1].score_total) : null,
        last_date: ev.length ? ev[ev.length - 1].set_date : ''
      };
      C.ROLES.forEach(function (r) { row['avg_' + r.key] = avg(ev.map(function (it) { return Number(it['score_' + r.key]); })); });
      return row;
    });
    // 평가가 있는 영역 중 평균이 가장 낮은 영역 (동점이면 모두)
    var scored = rows.filter(function (r) { return r.avg != null; });
    var min = scored.length ? Math.min.apply(null, scored.map(function (r) { return r.avg; })) : null;
    rows.forEach(function (r) { r.weakest = scored.length > 1 && r.avg != null && r.avg === min; });
    return rows;
  }

  // ── 사고·기술 카드 ───────────────────────────────────────────
  var CARD_COMMON = ['id', 'title', 'when', 'type', 'areas', 'src_title', 'src_org', 'src_url', 'src_checked', 'created_at', 'updated_at'];
  // 기술 카드는 2026-09-29 오후부터 「제목·목차·내용」만 둡니다 (공부한 내용을 적는 노트)
  var TECH_COMMON = ['id', 'title', 'toc', 'content', 'created_at', 'updated_at'];
  function cardFields(kind) { return kind === 'accident' ? C.ACCIDENT_FIELDS.map(function (f) { return f.key; }) : []; }
  function commonKeys(kind) { return kind === 'accident' ? CARD_COMMON : TECH_COMMON; }
  // 목차 이름 맞추기 — 띄어쓰기·가운뎃점 차이(「연소·폭발공학」「LPG 설비」)와 영역 번호(1~10)도 받습니다
  function tocOf(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (/^\d{1,2}$/.test(s)) return C.TECH_TOC[Number(s) - 1] && Number(s) <= 10 ? C.TECH_TOC[Number(s) - 1] : '';
    var n = normName(s).replace(/폭팔/g, '폭발');
    return C.TECH_TOC.filter(function (t) { return normName(t) === n; })[0] || '';
  }
  // 예전 기술 카드(기술명 + 5항목 + 출처) → 제목·목차·내용. 이미 새 형식이면 목차만 맞춥니다.
  function migrateTech(c) {
    c = c || {};
    var legacy = C.TECH_FIELDS.some(function (f) { return String(c[f.key] || '').trim(); }) ||
      ['when', 'type', 'src_title', 'src_org', 'src_url'].some(function (k) { return String(c[k] || '').trim(); });
    var content = String(c.content || '').trim();
    if (legacy) {
      var parts = content ? [content] : [];
      var meta = [];
      if (String(c.type || '').trim()) meta.push('기술 분야: ' + String(c.type).trim());
      if (String(c.when || '').trim()) meta.push('연도: ' + String(c.when).trim());
      if (meta.length) parts.push(meta.join(' · '));
      C.TECH_FIELDS.forEach(function (f) {
        var v = String(c[f.key] || '').trim();
        if (v) parts.push('■ ' + f.label + '\n' + v);
      });
      var src = [c.src_title, c.src_org, c.src_url].map(function (x) { return String(x || '').trim(); }).filter(Boolean);
      if (src.length) parts.push('출처: ' + src.join(' · ') + ((c.src_checked === true || c.src_checked === 'Y') ? ' (원문 확인함)' : ''));
      content = parts.join('\n\n');
    }
    var toc = tocOf(c.toc);
    if (!toc) {
      var first = String(c.areas || '').split(/[;,]/)[0];
      toc = tocOf(first) || '기타';
    }
    return { id: c.id || '', title: String(c.title || '').trim(), toc: toc, content: content,
      created_at: c.created_at || '', updated_at: c.updated_at || '' };
  }
  // 저장소·엑셀에서 읽은 DB 를 지금 형식으로 (기술 카드 이관)
  function normalizeDb(db) {
    var out = clone(db);
    out.techs = (out.techs || []).map(migrateTech);
    if (!Array.isArray(out.news)) out.news = [];
    return out;
  }
  // 목차별 묶음 — 목차 순서대로, 각 목차 안은 최근 수정순
  function techsByToc(techs) {
    return C.TECH_TOC.map(function (t) {
      var list = (techs || []).filter(function (c) { return (tocOf(c.toc) || '기타') === t; })
        .sort(function (a, b) { var x = a.updated_at || '', y = b.updated_at || ''; return x < y ? 1 : x > y ? -1 : 0; });
      return { toc: t, list: list };
    });
  }
  function cardKey(kind) { return kind === 'accident' ? 'accidents' : 'techs'; }
  // 출처(문서명 또는 URL)가 있고, 원문을 직접 확인했다고 표시한 카드만 「확인」
  function cardVerified(card) {
    var has = !!(String(card.src_title || '').trim() || String(card.src_url || '').trim());
    return has && (card.src_checked === true || card.src_checked === 'Y');
  }
  function validateCard(kind, card) {
    var errors = [];
    if (!String(card.title || '').trim()) errors.push({ field: 'title', code: 'required' });
    if (kind === 'tech') { // 기술 카드는 출처 칸이 없습니다(제목·목차·내용)
      if (!tocOf(card.toc)) errors.push({ field: 'toc', code: 'bad_code' });
      return { ok: !errors.length, errors: errors };
    }
    var url = String(card.src_url || '').trim();
    if (url && !/^https?:\/\/\S+$/i.test(url)) errors.push({ field: 'src_url', code: 'bad_url' });
    if ((card.src_checked === true || card.src_checked === 'Y') && !String(card.src_title || '').trim() && !url) {
      errors.push({ field: 'src_title', code: 'source_needed' });
    }
    if (card.type && C.ACCIDENT_TYPES.indexOf(card.type) === -1) errors.push({ field: 'type', code: 'bad_code' });
    return { ok: !errors.length, errors: errors };
  }
  function nextCardId(list, prefix) {
    var max = 0;
    list.forEach(function (c) { var m = String(c.id || '').match(/(\d+)$/); if (m) max = Math.max(max, +m[1]); });
    return prefix + ('00' + (max + 1)).slice(-3);
  }
  function upsertCard(db, kind, card, now) {
    var v = validateCard(kind, card);
    if (!v.ok) return { ok: false, errors: v.errors };
    var out = clone(db);
    var list = out[cardKey(kind)];
    var ts = toDateTimeStr(now || new Date());
    var row = {};
    commonKeys(kind).concat(cardFields(kind)).forEach(function (k) { row[k] = card[k] == null ? '' : card[k]; });
    row.title = String(row.title).trim();
    if (kind === 'tech') row.toc = tocOf(row.toc);
    else row.src_checked = (card.src_checked === true || card.src_checked === 'Y') ? 'Y' : '';
    var cur = card.id ? list.filter(function (c) { return c.id === card.id; })[0] : null;
    if (cur) {
      row.created_at = cur.created_at; row.updated_at = ts;
      list[list.indexOf(cur)] = row;
    } else {
      row.id = nextCardId(list, kind === 'accident' ? 'ACC-' : 'TEC-');
      row.created_at = ts; row.updated_at = ts;
      list.push(row);
    }
    return { ok: true, db: out, id: row.id, created: !cur };
  }
  function deleteCard(db, kind, id) {
    var out = clone(db);
    var k = cardKey(kind);
    var before = out[k].length;
    out[k] = out[k].filter(function (c) { return c.id !== id; });
    return { ok: out[k].length < before, db: out };
  }

  // ── 내보내기·가져오기 ─────────────────────────────────────────
  function itemColumns() {
    var cols = [
      { key: 'set_date', label: '날짜' }, { key: 'area_id', label: '영역번호' }, { key: 'area_name', label: '영역' },
      { key: 'question', label: '문제' }, { key: 'q_source', label: '출제 방식' },
      { key: 'ans_intro', label: '답안_서론' }, { key: 'ans_body', label: '답안_본론' }, { key: 'ans_conclusion', label: '답안_결론' },
      { key: 'ans_submitted_at', label: '답안 제출' }
    ];
    C.ROLES.forEach(function (r) {
      cols.push({ key: 'score_' + r.key, label: r.label + ' 점수' });
      cols.push({ key: 'cmt_' + r.key, label: r.label + ' 평가' });
    });
    cols.push({ key: 'score_total', label: '종합 점수' }, { key: 'cmt_total', label: '종합의견' }, { key: 'eval_at', label: '평가 일시' },
      { key: 'model_answer', label: '모범답안' }, { key: 'model_at', label: '모범답안 일시' },
      { key: 'created_at', label: '출제 일시' }, { key: 'ans_saved_at', label: '답안 저장' });
    return cols;
  }
  function cardColumns(kind) {
    if (kind === 'tech') {
      return [{ key: 'id', label: '카드번호' }, { key: 'title', label: '제목', alias: ['기술명'] }, { key: 'toc', label: '목차' },
        { key: 'content', label: '내용' }, { key: 'created_at', label: '작성 일시' }, { key: 'updated_at', label: '수정 일시' }];
    }
    var cols = [{ key: 'id', label: '카드번호' },
      { key: 'title', label: '사고명' },
      { key: 'when', label: '발생 시기' },
      { key: 'type', label: '사고 유형' },
      { key: 'areas', label: '관련 영역번호' }];
    C.ACCIDENT_FIELDS.forEach(function (f) { cols.push({ key: f.key, label: f.label }); });
    cols.push({ key: 'src_title', label: '출처_문서명' }, { key: 'src_org', label: '출처_발행기관' }, { key: 'src_url', label: '출처_URL' },
      { key: 'src_checked', label: '출처 확인(Y)' }, { key: 'created_at', label: '작성 일시' }, { key: 'updated_at', label: '수정 일시' });
    return cols;
  }
  // 예전(1차) 기술카드 시트의 칸 — 가져올 때만 읽어 「내용」으로 합칩니다
  function legacyTechColumns() {
    var cols = [{ key: 'when', label: '연도' }, { key: 'type', label: '기술 분야' }, { key: 'areas', label: '관련 영역번호' }];
    C.TECH_FIELDS.forEach(function (f) { cols.push({ key: f.key, label: f.label }); });
    return cols.concat([{ key: 'src_title', label: '출처_문서명' }, { key: 'src_org', label: '출처_발행기관' }, { key: 'src_url', label: '출처_URL' }, { key: 'src_checked', label: '출처 확인(Y)' }]);
  }
  var SHEET_NAMES = { items: '학습기록', accidents: '사고카드', techs: '기술카드' };
  function sheetColumns(key) { return key === 'items' ? itemColumns() : cardColumns(key === 'accidents' ? 'accident' : 'tech'); }

  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // 엑셀에서 한글이 깨지지 않도록 BOM 을 붙입니다
  function toCsv(cols, rows) {
    var out = [cols.map(function (c) { return csvCell(c.label); }).join(',')];
    rows.forEach(function (r) { out.push(cols.map(function (c) { return csvCell(r[c.key]); }).join(',')); });
    return '﻿' + out.join('\r\n');
  }
  function itemRows(items) {
    return items.slice().sort(function (a, b) {
      return a.set_date < b.set_date ? -1 : a.set_date > b.set_date ? 1 : a.area_id - b.area_id;
    }).map(function (it) { var o = clone(it); o.area_name = (areaOf(it.area_id) || {}).name || ''; return o; });
  }
  function dbToSheets(db) {
    var res = {};
    Object.keys(SHEET_NAMES).forEach(function (k) {
      var cols = sheetColumns(k);
      var rows = k === 'items' ? itemRows(db.items) : db[k];
      res[SHEET_NAMES[k]] = [cols.map(function (c) { return c.label; })].concat(rows.map(function (r) {
        return cols.map(function (c) { return r[c.key] == null ? '' : r[c.key]; });
      }));
    });
    return res;
  }
  function cellToString(v) {
    if (v instanceof Date) return toDateStr(v);
    return v == null ? '' : String(v).trim();
  }
  // { 시트명: [[머리행], …] } → DB. 머리행은 한글 이름이나 필드 키 둘 다 받습니다.
  function sheetsToDb(sheets) {
    var db = emptyDb();
    var report = { read: [], skipped: [], problems: [] };
    Object.keys(SHEET_NAMES).forEach(function (k) {
      var name = SHEET_NAMES[k];
      var rows = sheets[name];
      if (!rows || !rows.length) { report.skipped.push(name); return; }
      var cols = sheetColumns(k);
      if (k === 'techs') cols = cols.concat(legacyTechColumns());
      var head = (rows[0] || []).map(cellToString);
      var idx = cols.map(function (c) {
        var j = head.indexOf(c.label);
        (c.alias || []).forEach(function (a) { if (j === -1) j = head.indexOf(a); });
        return j === -1 ? head.indexOf(c.key) : j;
      });
      if (idx[0] === -1 || idx[1] === -1) { report.problems.push(name + ': 머리행(' + cols[0].label + '·' + cols[1].label + ')을 찾지 못했습니다'); return; }
      var list = [];
      rows.slice(1).forEach(function (r, n) {
        if (!r || !r.some(function (c) { return cellToString(c) !== ''; })) return;
        var o = {};
        cols.forEach(function (c, i) { o[c.key] = idx[i] === -1 ? '' : cellToString(r[idx[i]]); });
        if (k === 'items') {
          var d = parseDate(o.set_date);
          o.set_date = d ? toDateStr(d) : '';
          o.area_id = Number(o.area_id);
          if (!o.set_date || !areaOf(o.area_id)) { report.problems.push(name + ' ' + (n + 2) + '행: 날짜나 영역번호가 올바르지 않아 건너뜀'); return; }
          if (findItem({ items: list }, o.set_date, o.area_id)) { report.problems.push(name + ' ' + (n + 2) + '행: 같은 날짜·영역이 이미 있어 건너뜀'); return; }
          delete o.area_name;
          C.ROLES.map(function (r) { return 'score_' + r.key; }).concat(['score_total']).forEach(function (sk) {
            if (o[sk] === '') return;
            var v = Number(o[sk]);
            if (isNaN(v) || v < 0 || v > 100) { report.problems.push(name + ' ' + (n + 2) + '행: ' + sk + ' 값 "' + o[sk] + '"을 비움'); o[sk] = ''; }
            else o[sk] = v;
          });
          if (o.eval_at && totalScore(pick(o)) == null) { report.problems.push(name + ' ' + (n + 2) + '행: 평가 점수가 빠져 평가를 비움'); o.eval_at = ''; }
        } else if (!o.title) {
          return;
        } else if (k === 'techs') {
          o = migrateTech(o);
        }
        list.push(o);
      });
      db[k] = list;
      report.read.push(name + ' ' + list.length + '건');
    });
    return { db: db, report: report };
  }
  function pick(o) { var s = {}; C.ROLES.forEach(function (r) { s[r.key] = o['score_' + r.key] === '' ? null : o['score_' + r.key]; }); return s; }

  var api = {
    AREAS: C.AREAS, ROLES: C.ROLES, STAGES: STAGES, STAGE_LABEL: STAGE_LABEL, SHEET_NAMES: SHEET_NAMES,
    emptyDb: emptyDb, toDateStr: toDateStr, toDateTimeStr: toDateTimeStr, parseDate: parseDate, isDateStr: isDateStr,
    areaOf: areaOf, areaByName: areaByName, similarity: similarity, findSimilar: findSimilar, recentQuestions: recentQuestions,
    buildQuestionPrompt: buildQuestionPrompt, parseQuestions: parseQuestions, addQuestions: addQuestions,
    findItem: findItem, itemsOfDate: itemsOfDate, stageOf: stageOf, stageIndex: stageIndex,
    answerText: answerText, saveAnswer: saveAnswer, reopenAnswer: reopenAnswer,
    rolePromptBlock: rolePromptBlock, evalFormatBlock: evalFormatBlock,
    buildEvalPrompt: buildEvalPrompt, parseEval: parseEval, totalScore: totalScore, saveEval: saveEval,
    buildModelPrompt: buildModelPrompt, checkModelAnswer: checkModelAnswer, saveModel: saveModel,
    setSummaries: setSummaries, areaStats: areaStats,
    cardVerified: cardVerified, validateCard: validateCard, upsertCard: upsertCard, deleteCard: deleteCard,
    cardColumns: cardColumns, itemColumns: itemColumns, itemRows: itemRows,
    toCsv: toCsv, dbToSheets: dbToSheets, sheetsToDb: sheetsToDb,
    answerStats: answerStats, buildCombinedPrompt: buildCombinedPrompt, extractJson: extractJson,
    parseCombined: parseCombined, saveCombined: saveCombined, MARK_EVAL: MARK_EVAL, MARK_MODEL: MARK_MODEL,
    buildOpenAIRequest: buildOpenAIRequest, extractOpenAIText: extractOpenAIText, looksLikeApiKey: looksLikeApiKey, maskKey: maskKey,
    parseNewsDate: parseNewsDate, parseRss: parseRss, parseNewsPaste: parseNewsPaste, excerpt: excerpt,
    TECH_TOC: C.TECH_TOC, tocOf: tocOf, migrateTech: migrateTech, normalizeDb: normalizeDb, techsByToc: techsByToc,
    mergeNews: mergeNews, newsToCardDraft: newsToCardDraft, guessAccidentType: guessAccidentType, NEWS_COLUMNS: NEWS_COLUMNS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GTLogic = api;
})(typeof window !== 'undefined' ? window : this);
