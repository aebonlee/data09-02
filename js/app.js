/*
 * 화면 — 해시 주소로 나눕니다.
 *   #/today[/<날짜>]        오늘의 모의시험 (10개 영역 출제·진행 현황)
 *   #/q/<날짜>/<영역번호>    문제 풀이 4단계: 문제 → 답안 → AI 평가 → 모범답안
 *   #/records               학습 기록 (날짜별·영역별, CSV)
 *   #/print/<날짜>           인쇄용 (PDF 저장)
 *   #/stats                 영역별 현황 (표·그래프, CSV)
 *   #/accidents[/<id|new>]  사고 카드 (5항목 + 출처)
 *   #/techs[/<id|new>]      기술 카드 (6항목 + 출처)
 *   #/prompts               4관점 평가 프롬프트 세트
 *   #/data                  데이터 (예시 데이터·엑셀 내보내기/가져오기)
 */
(function () {
  'use strict';
  var L = window.GTLogic, S = window.GTStore, C = window.GTConfig;
  var db = S.loadDb();
  var main = document.getElementById('main');
  var recFilter = { from: '', to: '', area: '', stage: '' };

  // ── 도우미 ────────────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  // Element.append 는 null 을 "null" 글자로 넣으므로, 조건부 부품은 이 함수로 붙입니다
  function add(el) { for (var i = 1; i < arguments.length; i++) append(el, arguments[i]); return el; }
  function save(newDb) { if (newDb) db = newDb; S.saveDb(db); updateBanner(); }
  function now() { return new Date(); }
  function today() { return L.toDateStr(now()); }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function areaName(id) { var a = L.areaOf(id); return a ? a.name : ''; }
  function fmt(v) { return v == null || v === '' ? '-' : String(v); }

  var toastTimer;
  function toast(msg, isError) {
    var el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }
  function dialog(title, content, buttons) {
    var dlg = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    var box = document.getElementById('dialogContent');
    box.textContent = '';
    append(box, content);
    var acts = document.getElementById('dialogActions');
    acts.textContent = '';
    (buttons || [{ label: '닫기' }]).forEach(function (b) {
      acts.appendChild(h('button', {
        class: 'btn' + (b.primary ? ' btn-primary' : '') + (b.danger ? ' btn-danger' : ''), value: 'close',
        onclick: b.onClick ? function (e) { e.preventDefault(); dlg.close(); b.onClick(); } : null
      }, b.label));
    });
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }
  function confirmDo(title, msg, label, fn) {
    dialog(title, h('p', null, msg), [{ label: '취소' }, { label: label, danger: true, onClick: fn }]);
  }
  function copyText(text) {
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px' });
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).catch(fallback);
    else fallback();
    toast('복사했습니다. AI 대화창에 붙여 넣으십시오.');
  }
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stageBadge(it) {
    var st = L.stageOf(it) || 'question';
    return h('span', { class: 'stage ' + st }, L.STAGE_LABEL[st]);
  }
  function field(label, control, opts) {
    opts = opts || {};
    return h('label', { class: 'field' + (opts.span ? ' span-all' : ''), 'data-field': opts.name || '' },
      h('span', null, label), control,
      opts.hint ? h('small', { class: 'note' }, opts.hint) : null,
      h('small', { class: 'err', hidden: true }));
  }
  var ERR = {
    required: '꼭 입력해야 합니다.', bad_url: 'http:// 또는 https:// 로 시작하는 주소를 넣으십시오.',
    source_needed: '출처를 확인했다고 표시하려면 문서명이나 URL 을 넣으십시오.', bad_code: '목록에 있는 값을 고르십시오.'
  };
  function showErrors(form, errors) {
    form.querySelectorAll('.field').forEach(function (f) {
      f.classList.remove('invalid');
      var e = f.querySelector('.err'); if (e) { e.hidden = true; e.textContent = ''; }
    });
    errors.forEach(function (er) {
      var f = form.querySelector('.field[data-field="' + er.field + '"]');
      if (!f) return;
      f.classList.add('invalid');
      var e = f.querySelector('.err'); e.hidden = false; e.textContent = ERR[er.code] || er.code;
    });
    var first = form.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea');
    if (first) first.focus();
  }
  function promptPanel(title, promptText, note) {
    return h('div', { class: 'ai-step' },
      h('h3', null, title),
      note ? h('p', { class: 'note' }, note) : null,
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { copyText(promptText); } }, '프롬프트 복사')),
      h('pre', { class: 'prompt-box', tabindex: '0' }, promptText));
  }

  // ── 머리·메뉴 ─────────────────────────────────────────────
  var MENU = [
    ['#/today', '오늘의 문제'], ['#/records', '학습 기록'], ['#/stats', '영역별 현황'],
    ['#/accidents', '사고 카드'], ['#/techs', '기술 카드'], ['#/prompts', '프롬프트 세트'], ['#/data', '데이터']
  ];
  function renderNav(route) {
    var nav = document.getElementById('nav');
    nav.textContent = '';
    var base = '#/' + (route.split('/')[1] || '');
    if (base === '#/q' || base === '#/print') base = base === '#/q' ? '#/today' : '#/records';
    MENU.forEach(function (m) {
      nav.appendChild(h('a', { href: m[0], 'aria-current': m[0] === base ? 'page' : null }, m[1]));
    });
  }
  function updateBanner() {
    var b = document.getElementById('sampleBanner');
    b.textContent = '';
    var msgs = [];
    if (db._sample) msgs.push('지금 보이는 기록은 화면 확인용 「예시 데이터」입니다. 실제 기출문제·평가가 아닙니다. 「데이터」 메뉴에서 지우고 시작할 수 있습니다.');
    if (!S.available()) msgs.push('이 브라우저에서는 저장소를 쓸 수 없어 창을 닫으면 기록이 사라집니다. 엑셀로 내보내 두십시오.');
    b.hidden = !msgs.length;
    b.textContent = msgs.join(' ');
  }

  // ── 오늘의 문제 ───────────────────────────────────────────
  function viewToday(date) {
    date = L.isDateStr(date) ? date : today();
    var items = L.itemsOfDate(db, date);
    var byArea = {};
    items.forEach(function (it) { byArea[it.area_id] = it; });
    var missing = L.AREAS.filter(function (a) { return !byArea[a.id]; });
    var n = function (st) { return items.filter(function (it) { return L.stageIndex(it) >= st; }).length; };

    var dateInput = h('input', { type: 'date', value: date, 'aria-label': '출제 날짜' });
    dateInput.addEventListener('change', function () { if (dateInput.value) go('#/today/' + dateInput.value); });

    var head = h('div', { class: 'page-head' },
      h('h1', null, date === today() ? '오늘의 모의시험' : date + ' 모의시험'),
      h('label', { class: 'field', style: 'flex-direction:row;align-items:center;gap:8px' }, h('span', null, '날짜'), dateInput));

    var tiles = h('div', { class: 'set-grid' }, L.AREAS.map(function (a) {
      var it = byArea[a.id];
      if (!it) return h('div', { class: 'q-tile empty' },
        h('div', { class: 'top' }, h('span', { class: 'area' }, a.id + '. ' + a.name), h('span', { class: 'note' }, '미출제')));
      return h('a', { class: 'q-tile', href: '#/q/' + date + '/' + a.id },
        h('div', { class: 'top' }, h('span', { class: 'area' }, a.id + '. ' + a.name), stageBadge(it)),
        h('span', { class: 'qtext' }, it.question),
        it.eval_at ? h('span', { class: 'note' }, '종합 ' + it.score_total + '점') : null);
    }));

    var progress = h('p', { class: 'progress-line' },
      h('span', null, '출제 ', h('b', null, items.length + '/10')),
      h('span', null, '답안 제출 ', h('b', null, String(n(2)))),
      h('span', null, 'AI 평가 ', h('b', null, String(n(3)))),
      h('span', null, '모범답안 ', h('b', null, String(n(4)))));

    var empty = !db.items.length && !db.accidents.length && !db.techs.length;
    add(main, head,
      empty ? h('div', { class: 'alert info' }, '처음 쓰시면 아래에서 문제를 출제하십시오. 화면을 먼저 둘러보려면 ',
        h('button', { type: 'button', class: 'btn btn-small', onclick: function () { save(window.GTSample.build(now())); toast('예시 데이터를 불러왔습니다.'); go('#/records'); } }, '예시 데이터 불러오기'),
        ' 를 누르십시오.') : null,
      progress,
      missing.length ? questionCreator(date, missing) : null,
      h('section', { class: 'card' }, h('h2', null, '영역별 문제'), tiles));
  }

  // 출제: ① AI 프롬프트 → 붙여넣기 ② 직접 입력
  function questionCreator(date, missing) {
    var ids = missing.map(function (a) { return a.id; });
    var prompt = L.buildQuestionPrompt(db, date, ids);
    var paste = h('textarea', { class: 'tall', name: 'q_paste', placeholder: '[1] 연소·폭발공학\n문제 내용…\n\n[2] 방폭공학\n문제 내용…' });
    var preview = h('div');
    var parsed = null;
    function doParse() {
      preview.textContent = '';
      parsed = L.parseQuestions(paste.value);
      var list = parsed.items.filter(function (q) { return ids.indexOf(q.area_id) !== -1; });
      var skipped = parsed.items.length - list.length;
      var warn = [];
      if (!parsed.items.length) warn.push('「[번호] 영역명」 머리줄을 찾지 못했습니다. 답변 형식을 확인하십시오.');
      if (parsed.unknown.length) warn.push('읽지 못한 머리줄: ' + parsed.unknown.join(', '));
      if (parsed.duplicated.length) warn.push('같은 영역이 두 번 나와 첫 문제만 씁니다: ' + parsed.duplicated.map(areaName).join(', '));
      if (skipped) warn.push('이미 출제된 영역의 문제 ' + skipped + '개는 넣지 않습니다.');
      if (warn.length) preview.appendChild(h('div', { class: 'alert warn' }, h('ul', null, warn.map(function (w) { return h('li', null, w); }))));
      if (!list.length) return;
      preview.appendChild(h('ul', { class: 'preview-list' }, ids.map(function (id) {
        var q = list.filter(function (x) { return x.area_id === id; })[0];
        var sim = q ? L.findSimilar(db.items, q.question) : [];
        return h('li', { class: q ? '' : 'miss' }, h('b', null, id + '. ' + areaName(id)), h('br'),
          q ? h('span', { class: 'pre' }, q.question) : '(답변에 없음 — 아래 직접 입력으로 채울 수 있습니다)',
          sim.length ? h('div', { class: 'alert warn' }, '이전 문제와 비슷합니다: ' + sim[0].set_date + ' 「' + sim[0].question + '」') : null);
      })));
      preview.appendChild(h('div', { class: 'btn-row' }, h('button', {
        type: 'button', class: 'btn btn-primary', onclick: function () { commit(list, 'AI'); }
      }, list.length + '문제 저장')));
    }
    function commit(list, source) {
      var r = L.addQuestions(db, date, list, source, now());
      if (!r.ok) { toast('저장하지 못했습니다: ' + r.errors.map(function (e) { return e.code; }).join(', '), true); return; }
      save(r.db);
      toast(r.added + '문제를 저장했습니다.' + (r.warnings.length ? ' (비슷한 문제 경고 ' + r.warnings.length + '건)' : ''));
      render();
    }

    var manual = h('form', { class: 'form-grid' }, missing.map(function (a) {
      return field(a.id + '. ' + a.name, h('textarea', { name: 'm_' + a.id, rows: '3' }), { span: true, name: 'm_' + a.id });
    }), h('div', { class: 'btn-row span-all' }, h('button', { type: 'submit', class: 'btn btn-primary' }, '입력한 문제 저장')));
    manual.addEventListener('submit', function (e) {
      e.preventDefault();
      var list = missing.map(function (a) { return { area_id: a.id, question: manual.elements['m_' + a.id].value }; })
        .filter(function (q) { return q.question.trim(); });
      if (!list.length) { toast('입력한 문제가 없습니다.', true); return; }
      var warns = [];
      list.forEach(function (q) { var s = L.findSimilar(db.items, q.question); if (s.length) warns.push(areaName(q.area_id) + ': ' + s[0].set_date + ' 문제와 비슷함'); });
      if (warns.length) {
        dialog('비슷한 문제가 있습니다', h('ul', null, warns.map(function (w) { return h('li', null, w); })),
          [{ label: '고치기' }, { label: '그대로 저장', primary: true, onClick: function () { commit(list, '직접'); } }]);
      } else commit(list, '직접');
    });

    return h('section', { class: 'card' },
      h('h2', null, '문제 출제 (' + missing.length + '개 영역 남음)'),
      h('p', { class: 'note' }, 'AI 대화창(ChatGPT·Claude 등)에 프롬프트를 붙여 넣고, 받은 답변을 아래 칸에 그대로 붙여 넣으면 영역별로 나눕니다. 프롬프트에는 영역마다 최근 ' + C.HISTORY_IN_PROMPT + '개까지 이전 문제가 들어가 겹치지 않게 출제를 요청합니다.'),
      promptPanel('1) 출제 프롬프트', prompt),
      h('div', { class: 'ai-step' },
        h('h3', null, '2) AI 답변 붙여넣기'),
        field('AI 답변', paste, { hint: '형식: 「[번호] 영역명」 줄 다음에 문제. 번호 대신 「[영역명]」도 읽습니다.' }),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: doParse }, '영역별로 나누기'))),
      preview,
      h('details', { style: 'margin-top:16px' }, h('summary', null, '직접 입력하기 (교재·기출문제에서 옮길 때)'), h('div', { style: 'margin-top:12px' }, manual)));
  }

  // ── 문제 풀이 4단계 ───────────────────────────────────────
  var autosaveTimer = null, flushDraft = null;
  function viewQuestion(date, areaId) {
    var it = L.findItem(db, date, areaId);
    if (!it) { add(main, h('p', null, '문제를 찾지 못했습니다. '), h('a', { href: '#/today/' + date }, '목록으로')); return; }
    var st = L.stageIndex(it);
    var steps = [['1', '문제'], ['2', '답안 작성'], ['3', 'AI 평가'], ['4', '모범답안']];
    var cur = st <= 1 ? 1 : st === 2 ? 2 : st === 3 ? 3 : 4;
    var stepper = h('ol', { class: 'stepper', 'aria-label': '진행 단계' }, steps.map(function (s, i) {
      var cls = i < cur ? 'done' : i === cur ? 'current' : '';
      if (cur === 4 && st === 4) cls = 'done';
      return h('li', { class: cls }, h('b', null, s[0] + '단계'), s[1]);
    }));

    var idx = L.AREAS.map(function (a) { return a.id; }).indexOf(Number(areaId));
    var prev = L.AREAS[idx - 1], next = L.AREAS[idx + 1];
    var pager = h('div', { class: 'pager' },
      h('a', { class: 'btn', href: '#/today/' + date }, '10문제 목록'),
      h('div', { class: 'btn-row' },
        prev && L.findItem(db, date, prev.id) ? h('a', { class: 'btn', href: '#/q/' + date + '/' + prev.id }, '이전 영역') : null,
        next && L.findItem(db, date, next.id) ? h('a', { class: 'btn', href: '#/q/' + date + '/' + next.id }, '다음 영역') : null));

    add(main, 
      h('div', { class: 'page-head' }, h('h1', null, it.area_id + '. ' + areaName(it.area_id)), stageBadge(it)),
      h('p', { class: 'note' }, date + ' · 출제: ' + (it.q_source || '-')),
      stepper,
      h('section', { class: 'card' }, h('h2', null, '1단계 · 문제'), h('div', { class: 'question-box' }, it.question),
        st === 0 ? h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn', onclick: function () { editQuestion(it); } }, '문제 고치기')) : null),
      answerSection(it),
      evalSection(it),
      modelSection(it),
      pager);
  }
  function editQuestion(it) {
    var ta = h('textarea', { rows: '5' }); ta.value = it.question;
    dialog('문제 고치기', field('문제', ta), [{ label: '취소' }, { label: '저장', primary: true, onClick: function () {
      var r = L.addQuestions(db, it.set_date, [{ area_id: it.area_id, question: ta.value }], it.q_source, now());
      if (!r.ok) { toast('고칠 수 없습니다.', true); return; }
      save(r.db); render();
    } }]);
  }

  function answerSection(it) {
    var sec = h('section', { class: 'card' }, h('h2', null, '2단계 · 답안 작성'));
    if (it.ans_submitted_at) {
      add(sec, h('p', { class: 'note' }, '제출: ' + it.ans_submitted_at),
        h('div', { class: 'answer-view' },
          [['서론', it.ans_intro], ['본론', it.ans_body], ['결론', it.ans_conclusion]].map(function (p) {
            return h('section', null, h('h3', null, p[0]), h('div', { class: 'pre' }, p[1] || '(비어 있음)'));
          })),
        !it.eval_at ? h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', {
          type: 'button', class: 'btn', onclick: function () {
            var r = L.reopenAnswer(db, it.set_date, it.area_id);
            if (r.ok) { save(r.db); render(); }
          }
        }, '제출 취소하고 다시 고치기')) : null);
      return sec;
    }
    var form = h('form', { class: 'form-grid' },
      field('서론', h('textarea', { name: 'intro', rows: '4' }), { span: true, hint: '문제의 핵심 개념 정의, 답안 방향' }),
      field('본론', h('textarea', { name: 'body', class: 'tall' }), { span: true, name: 'body', hint: '번호를 붙인 항목·표·도식 설명' }),
      field('결론', h('textarea', { name: 'conclusion', rows: '4' }), { span: true, hint: '실무 시사점, 본인 의견' }),
      h('p', { class: 'note span-all', id: 'saveState' }, it.ans_saved_at ? '임시저장: ' + it.ans_saved_at : '입력하면 자동으로 임시저장됩니다.'),
      h('div', { class: 'btn-row span-all' },
        h('button', { type: 'button', class: 'btn', onclick: function () { draft(true); } }, '임시저장'),
        h('button', { type: 'submit', class: 'btn btn-primary' }, '답안 제출')));
    form.elements.intro.value = it.ans_intro || '';
    form.elements.body.value = it.ans_body || '';
    form.elements.conclusion.value = it.ans_conclusion || '';
    function parts() { return { intro: form.elements.intro.value, body: form.elements.body.value, conclusion: form.elements.conclusion.value }; }
    function draft(announce) {
      var r = L.saveAnswer(db, it.set_date, it.area_id, parts(), { now: now() });
      if (!r.ok) return;
      save(r.db);
      var el = document.getElementById('saveState');
      if (el) el.textContent = '임시저장: ' + L.findItem(db, it.set_date, it.area_id).ans_saved_at;
      if (announce) toast('임시저장했습니다.');
    }
    form.addEventListener('input', function () {
      clearTimeout(autosaveTimer);
      flushDraft = function () { draft(false); };
      autosaveTimer = setTimeout(function () { flushDraft = null; draft(false); }, 800);
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      clearTimeout(autosaveTimer); flushDraft = null;
      var r = L.saveAnswer(db, it.set_date, it.area_id, parts(), { now: now(), submit: true });
      if (!r.ok) {
        if (r.code === 'empty_body') showErrors(form, [{ field: 'body', code: 'required' }]);
        return;
      }
      save(r.db); toast('답안을 제출했습니다. 3단계에서 AI 평가를 받으십시오.'); render();
    });
    add(sec, form);
    return sec;
  }

  function roleCards(it) {
    return h('div', { class: 'role-grid' }, L.ROLES.map(function (r) {
      return h('div', { class: 'role-card' },
        h('div', { class: 'head' }, h('span', null, h('span', { class: 'who' }, r.label), h('span', { class: 'focus' }, r.focus)),
          h('span', { class: 'score' }, fmt(it['score_' + r.key]) + '점')),
        h('div', { class: 'pre' }, it['cmt_' + r.key] || ''));
    }), h('div', { class: 'role-card total' },
      h('div', { class: 'head' }, h('span', { class: 'who' }, '종합 (네 관점 평균)'), h('span', { class: 'score' }, fmt(it.score_total) + '점')),
      h('div', { class: 'pre' }, it.cmt_total || '')));
  }
  function evalSection(it) {
    var sec = h('section', { class: 'card' }, h('h2', null, '3단계 · 4관점 AI 평가'));
    if (!it.ans_submitted_at) { add(sec, h('p', { class: 'locked' }, '답안을 제출하면 평가 프롬프트가 열립니다.')); return sec; }
    if (it.eval_at) {
      add(sec, h('p', { class: 'note' }, '평가 저장: ' + it.eval_at), roleCards(it));
      return sec;
    }
    var paste = h('textarea', { class: 'tall', placeholder: '[가스기술사] 점수: 75\n평가: …\n\n[공학박사] 점수: …' });
    var out = h('div');
    function doParse() {
      out.textContent = '';
      var p = L.parseEval(paste.value);
      // 확인·수정용 칸
      var form = h('form', { class: 'form-grid' });
      L.ROLES.forEach(function (r) {
        add(form, field(r.label + ' 점수 (0~100)', h('input', { name: 's_' + r.key, type: 'number', min: '0', max: '100', step: '0.1', value: p.scores[r.key] == null ? '' : p.scores[r.key] }), { name: 's_' + r.key }),
          field(r.label + ' 평가', h('textarea', { name: 'c_' + r.key, rows: '4' }), { name: 'c_' + r.key }));
        form.elements['c_' + r.key].value = p.comments[r.key] || '';
      });
      add(form, field('종합의견', h('textarea', { name: 'summary', rows: '4' }), { span: true }),
        h('div', { class: 'btn-row span-all' }, h('button', { type: 'submit', class: 'btn btn-primary' }, '평가 저장')));
      form.elements.summary.value = p.summary;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var parsed = { scores: {}, comments: {}, summary: form.elements.summary.value };
        var errs = [];
        L.ROLES.forEach(function (r) {
          var v = form.elements['s_' + r.key].value;
          var n = v === '' ? null : Number(v);
          if (n == null || isNaN(n) || n < 0 || n > 100) errs.push({ field: 's_' + r.key, code: 'required' });
          parsed.scores[r.key] = n;
          parsed.comments[r.key] = form.elements['c_' + r.key].value;
        });
        if (errs.length) { showErrors(form, errs); return; }
        var r = L.saveEval(db, it.set_date, it.area_id, parsed, now());
        if (!r.ok) { toast('저장하지 못했습니다(' + r.code + ').', true); return; }
        save(r.db); toast('평가를 저장했습니다. 4단계에서 모범답안을 여십시오.'); render();
      });
      var warn = p.missing.length || p.problems.length;
      add(out, warn ? h('div', { class: 'alert warn' }, h('ul', null,
        p.missing.length ? h('li', null, '찾지 못한 항목: ' + p.missing.join(', ') + ' — 아래 칸에 직접 채우십시오.') : null,
        p.problems.map(function (x) { return h('li', null, x); }))) : h('div', { class: 'alert info' }, '네 관점 점수와 종합의견을 모두 읽었습니다. 확인 후 저장하십시오.'),
      form);
    }
    add(sec, 
      promptPanel('평가 프롬프트', L.buildEvalPrompt(it), '문제와 제출한 답안, 네 관점의 평가 기준, 답변 형식이 들어 있습니다. 종합 점수는 네 관점 점수의 평균으로 계산합니다.'),
      h('div', { class: 'ai-step' }, h('h3', null, 'AI 답변 붙여넣기'), field('AI 답변', paste),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', onclick: doParse }, '관점별로 나누기'),
          h('button', { type: 'button', class: 'btn', onclick: function () { paste.value = ''; doParse(); } }, '직접 입력'))),
      out);
    return sec;
  }

  function modelSection(it) {
    var sec = h('section', { class: 'card' }, h('h2', null, '4단계 · 모범답안'));
    if (!it.eval_at) { add(sec, h('p', { class: 'locked' }, 'AI 평가를 저장하면 모범답안이 열립니다. 본인 답안을 먼저 쓰고 평가받은 뒤에 보도록 순서를 고정했습니다.')); return sec; }
    if (it.model_answer) {
      var chk = L.checkModelAnswer(it.model_answer);
      add(sec, h('p', { class: 'note' }, '저장: ' + it.model_at),
        chk.needsCheck ? h('div', { class: 'alert warn' }, '[확인 필요] 표시가 ' + chk.needsCheck + '곳 있습니다. 법령·기준 문서로 확인한 뒤 공부 자료로 쓰십시오.') : null,
        h('div', { class: 'answer-view' }, h('section', null, h('div', { class: 'pre' }, it.model_answer))),
        h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn', onclick: function () { editModel(it); } }, '모범답안 고치기')));
      return sec;
    }
    var ta = h('textarea', { class: 'tall', name: 'model' });
    add(sec, promptPanel('모범답안 프롬프트', L.buildModelPrompt(it), 'A4 1~2쪽, 서론-본론-결론 형식을 요청합니다. 종합 평가에서 지적된 점도 함께 넣었습니다.'),
      h('div', { class: 'ai-step' }, h('h3', null, 'AI 답변 붙여넣기'), field('모범답안', ta, { name: 'model' }),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { submitModel(it, ta.value); } }, '모범답안 저장'))));
    return sec;
  }
  function submitModel(it, text) {
    var chk = L.checkModelAnswer(text);
    if (!chk.ok) { toast('모범답안을 붙여 넣으십시오.', true); return; }
    function doSave() {
      var r = L.saveModel(db, it.set_date, it.area_id, text, now());
      if (!r.ok) { toast('저장하지 못했습니다(' + r.code + ').', true); return; }
      save(r.db); toast('모범답안을 저장했습니다.'); render();
    }
    if (chk.missingSections.length) {
      dialog('형식 확인', h('p', null, '답변에 「' + chk.missingSections.join('·') + '」 부분이 보이지 않습니다. 그래도 저장하시겠습니까?'),
        [{ label: '다시 붙여넣기' }, { label: '그대로 저장', primary: true, onClick: doSave }]);
    } else doSave();
  }
  function editModel(it) {
    var ta = h('textarea', { class: 'tall' }); ta.value = it.model_answer;
    dialog('모범답안 고치기', field('모범답안', ta), [{ label: '취소' }, { label: '저장', primary: true, onClick: function () {
      var r = L.saveModel(db, it.set_date, it.area_id, ta.value, now());
      if (r.ok) { save(r.db); render(); } else toast('저장하지 못했습니다.', true);
    } }]);
  }

  // ── 학습 기록 ─────────────────────────────────────────────
  function viewRecords() {
    var sums = L.setSummaries(db);
    add(main, h('div', { class: 'page-head' }, h('h1', null, '학습 기록')));
    if (!db.items.length) {
      add(main, h('p', { class: 'card' }, '아직 기록이 없습니다. 「오늘의 문제」에서 출제하거나 「데이터」 메뉴에서 예시 데이터를 불러와 보십시오.'));
      return;
    }
    add(main, h('section', { class: 'card' }, h('h2', null, '날짜별'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['날짜', '출제', '답안 제출', 'AI 평가', '모범답안', '평균 점수', ''].map(function (x, i) { return h('th', { class: i && i < 6 ? 'num' : null }, x); }))),
        h('tbody', null, sums.map(function (s) {
          return h('tr', null, h('td', { class: 'nowrap' }, h('a', { href: '#/today/' + s.set_date }, s.set_date)),
            h('td', { class: 'num' }, s.count), h('td', { class: 'num' }, s.submitted), h('td', { class: 'num' }, s.evaluated), h('td', { class: 'num' }, s.done),
            h('td', { class: 'num' }, fmt(s.avg)),
            h('td', { class: 'nowrap' }, h('a', { class: 'btn btn-small', href: '#/print/' + s.set_date }, '인쇄·PDF')));
        }))))));

    var f = recFilter;
    var form = h('form', { class: 'filters' },
      field('시작일', h('input', { type: 'date', name: 'from', value: f.from })),
      field('종료일', h('input', { type: 'date', name: 'to', value: f.to })),
      field('영역', h('select', { name: 'area' }, h('option', { value: '' }, '전체'), L.AREAS.map(function (a) { return h('option', { value: String(a.id), selected: String(a.id) === f.area }, a.id + '. ' + a.name); }))),
      field('단계', h('select', { name: 'stage' }, h('option', { value: '' }, '전체'), L.STAGES.map(function (s) { return h('option', { value: s, selected: s === f.stage }, L.STAGE_LABEL[s]); }))));
    form.addEventListener('change', function () {
      recFilter = { from: form.elements.from.value, to: form.elements.to.value, area: form.elements.area.value, stage: form.elements.stage.value };
      render();
    });
    var rows = L.itemRows(db.items).filter(function (it) {
      if (f.from && it.set_date < f.from) return false;
      if (f.to && it.set_date > f.to) return false;
      if (f.area && String(it.area_id) !== f.area) return false;
      if (f.stage && L.stageOf(it) !== f.stage) return false;
      return true;
    }).reverse();
    add(main, h('section', { class: 'card' }, h('h2', null, '문제별'), form,
      h('div', { class: 'btn-row', style: 'margin-bottom:12px' }, h('span', { class: 'note' }, rows.length + '건'),
        h('button', { type: 'button', class: 'btn btn-small', onclick: function () {
          download('학습기록_' + today() + (db._sample ? '_예시데이터' : '') + '.csv', new Blob([L.toCsv(L.itemColumns(), rows)], { type: 'text/csv;charset=utf-8' }));
        } }, 'CSV 내보내기')),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['날짜', '영역', '문제', '단계'].concat(L.ROLES.map(function (r) { return r.label; })).concat(['종합']).map(function (x, i) { return h('th', { class: i >= 4 ? 'num' : null }, x); }))),
        h('tbody', null, rows.map(function (it) {
          var tr = h('tr', { class: 'click', tabindex: '0' },
            h('td', { class: 'nowrap' }, it.set_date), h('td', { class: 'nowrap' }, it.area_id + '. ' + it.area_name),
            h('td', { class: 'clip' }, h('span', { class: 'clip-text' }, it.question)), h('td', null, stageBadge(it)),
            L.ROLES.map(function (r) { return h('td', { class: 'num' }, fmt(it['score_' + r.key])); }),
            h('td', { class: 'num' }, h('b', null, fmt(it.score_total))));
          function open() { go('#/q/' + it.set_date + '/' + it.area_id); }
          tr.addEventListener('click', open);
          tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
          return tr;
        }))))));
  }

  function viewPrint(date) {
    var items = L.itemsOfDate(db, date);
    add(main, h('div', { class: 'page-head no-print' }, h('h1', null, date + ' 학습지'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/records' }, '학습 기록으로'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { window.print(); } }, '인쇄 / PDF로 저장'))),
      h('p', { class: 'note no-print' }, '인쇄 창에서 「PDF로 저장」을 고르면 PDF 파일이 됩니다. 문제마다 새 쪽에서 시작합니다.'));
    if (!items.length) { add(main, h('p', null, '이 날짜의 기록이 없습니다.')); return; }
    add(main, h('div', null, items.map(function (it) {
      return h('article', { class: 'card print-item' },
        h('h2', null, date + ' · ' + it.area_id + '. ' + areaName(it.area_id)),
        h('div', { class: 'question-box' }, it.question),
        h('h3', { style: 'margin-top:12px' }, '내 답안'),
        h('div', { class: 'answer-view' }, [['서론', it.ans_intro], ['본론', it.ans_body], ['결론', it.ans_conclusion]].map(function (p) {
          return h('section', null, h('h3', null, p[0]), h('div', { class: 'pre' }, p[1] || '(없음)'));
        })),
        h('h3', { style: 'margin-top:12px' }, '4관점 평가'),
        it.eval_at ? roleCards(it) : h('p', { class: 'note' }, '(평가 전)'),
        h('h3', { style: 'margin-top:12px' }, '모범답안'),
        it.model_answer ? h('div', { class: 'pre' }, it.model_answer) : h('p', { class: 'note' }, '(없음)'));
    })));
  }

  // ── 영역별 현황 ───────────────────────────────────────────
  function viewStats() {
    var rows = L.areaStats(db);
    var cols = [
      { key: 'area_id', label: '영역번호' }, { key: 'area_name', label: '영역' }, { key: 'count', label: '출제' },
      { key: 'submitted', label: '답안 제출' }, { key: 'evaluated', label: 'AI 평가' }, { key: 'avg', label: '평균 점수' },
      { key: 'last', label: '최근 점수' }, { key: 'last_date', label: '최근 평가일' }
    ].concat(L.ROLES.map(function (r) { return { key: 'avg_' + r.key, label: r.label + ' 평균' }; }));
    add(main, h('div', { class: 'page-head' }, h('h1', null, '영역별 현황'),
      h('button', { type: 'button', class: 'btn', onclick: function () {
        download('영역별현황_' + today() + (db._sample ? '_예시데이터' : '') + '.csv', new Blob([L.toCsv(cols, rows)], { type: 'text/csv;charset=utf-8' }));
      } }, 'CSV 내보내기')));
    var anyEval = rows.some(function (r) { return r.avg != null; });
    add(main, h('section', { class: 'card' }, h('h2', null, '영역별 평균 점수 (종합, 100점 만점)'),
      anyEval ? h('div', { class: 'bars' }, rows.map(function (r) {
        return h('div', { class: 'bar-row' },
          h('span', { class: 'bar-label' }, r.area_name),
          h('div', { class: 'bar-track', role: 'img', 'aria-label': r.area_name + ' 평균 ' + fmt(r.avg) + '점' },
            h('div', { class: 'bar-fill' + (r.weakest ? ' weak' : ''), style: 'width:' + (r.avg || 0) + '%' })),
          h('span', { class: 'bar-val' }, r.avg == null ? '-' : r.avg + '점'));
      })) : h('p', { class: 'note' }, 'AI 평가를 저장하면 그래프가 그려집니다.'),
      anyEval ? h('p', { class: 'note', style: 'margin-top:10px' }, '빨간 막대는 평가가 있는 영역 중 평균이 가장 낮은 영역입니다. 출제 비중 자동 조절은 3단계에서 만듭니다.') : null));
    add(main, h('section', { class: 'card' }, h('h2', null, '현황표'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, cols.slice(1).map(function (c, i) { return h('th', { class: i ? 'num' : null }, c.label); }))),
        h('tbody', null, rows.map(function (r) {
          return h('tr', null, h('td', { class: 'nowrap' }, r.area_id + '. ' + r.area_name, r.weakest ? ' ' : null, r.weakest ? h('span', { class: 'badge weak' }, '취약') : null),
            cols.slice(2).map(function (c) { return h('td', { class: 'num' }, fmt(r[c.key])); }));
        }))))));
  }

  // ── 사고·기술 카드 ────────────────────────────────────────
  var KIND = {
    accident: { key: 'accidents', route: '#/accidents', name: '사고 카드', titleLabel: '사고명', whenLabel: '발생 시기', typeLabel: '사고 유형', types: C.ACCIDENT_TYPES, fields: C.ACCIDENT_FIELDS },
    tech: { key: 'techs', route: '#/techs', name: '기술 카드', titleLabel: '기술명', whenLabel: '연도', typeLabel: '기술 분야', types: C.TECH_CATEGORIES, fields: C.TECH_FIELDS }
  };
  function verifyBadge(c) {
    return L.cardVerified(c) ? h('span', { class: 'badge verified' }, '출처 확인') : h('span', { class: 'badge unverified' }, '미확인');
  }
  function viewCards(kind) {
    var K = KIND[kind];
    var list = db[K.key];
    add(main, h('div', { class: 'page-head' }, h('h1', null, K.name),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', disabled: list.length ? null : true, onclick: function () {
          download(K.name.replace(' ', '') + '_' + today() + '.csv', new Blob([L.toCsv(L.cardColumns(kind), list)], { type: 'text/csv;charset=utf-8' }));
        } }, 'CSV 내보내기'),
        h('a', { class: 'btn btn-primary', href: K.route + '/new' }, '새 카드'))),
      h('div', { class: 'alert info' }, kind === 'accident'
        ? '1단계는 빈 양식과 저장 구조만 있습니다. 사고의 날짜·장소·피해 규모는 공공기관 보고서 같은 1차 출처를 확인한 것만 적고, 출처를 확인하지 않은 카드는 「미확인」으로 표시합니다. AI 초안 작성은 2단계에서 붙입니다.'
        : '1단계는 빈 양식과 저장 구조만 있습니다. 특허 번호·출원인 같은 사실은 특허 검색 서비스 등 1차 출처로 확인한 것만 적고, 출처를 확인하지 않은 카드는 「미확인」으로 표시합니다. AI 초안 작성은 2단계에서 붙입니다.'));
    if (!list.length) { add(main, h('p', { class: 'card' }, '아직 카드가 없습니다. 「새 카드」로 시작하십시오.')); return; }
    add(main, h('div', { class: 'card-list' }, list.map(function (c) {
      var filled = K.fields.filter(function (f) { return String(c[f.key] || '').trim(); }).length;
      return h('div', { class: 'db-card' },
        h('div', { class: 'btn-row' }, h('span', { class: 'note' }, c.id), verifyBadge(c)),
        h('span', { class: 'title' }, c.title),
        h('span', { class: 'meta' }, [c.type, c.when, '항목 ' + filled + '/' + K.fields.length].filter(Boolean).join(' · ')),
        c.areas ? h('span', { class: 'meta' }, '관련 영역: ' + String(c.areas).split(/[;,]/).map(function (x) { return areaName(x.trim()); }).filter(Boolean).join(', ')) : null,
        h('div', { class: 'actions' }, h('a', { class: 'btn btn-small', href: K.route + '/' + c.id }, '열기·고치기')));
    })));
  }
  function viewCardForm(kind, id) {
    var K = KIND[kind];
    var c = id === 'new' ? {} : db[K.key].filter(function (x) { return x.id === id; })[0];
    if (!c) { add(main, h('p', null, '카드를 찾지 못했습니다.')); return; }
    var areas = String(c.areas || '').split(/[;,]/).map(function (x) { return x.trim(); });
    var form = h('form', { class: 'form-grid' },
      field(K.titleLabel + ' (필수)', h('input', { name: 'title', value: c.title || '', maxlength: '200' }), { span: true, name: 'title' }),
      field(K.whenLabel, h('input', { name: 'when', value: c.when || '', placeholder: kind === 'accident' ? '예: 2020-05 또는 1990년대' : '예: 2024' }), { name: 'when' }),
      field(K.typeLabel, h('select', { name: 'type' }, h('option', { value: '' }, '선택'), K.types.map(function (t) { return h('option', { value: t, selected: t === c.type }, t); })), { name: 'type' }),
      h('div', { class: 'field span-all' }, h('span', null, '관련 출제 영역'),
        h('div', { class: 'checks' }, L.AREAS.map(function (a) {
          return h('label', null, h('input', { type: 'checkbox', name: 'areas', value: String(a.id), checked: areas.indexOf(String(a.id)) !== -1 }), a.name);
        }))),
      K.fields.map(function (f) { return field(f.label, h('textarea', { name: f.key, rows: '5' }), { span: true, name: f.key }); }),
      h('h2', { class: 'span-all', style: 'margin:8px 0 0' }, '출처'),
      field('문서명', h('input', { name: 'src_title', value: c.src_title || '' }), { name: 'src_title', hint: '보고서·공보·특허 공보 제목' }),
      field('발행기관', h('input', { name: 'src_org', value: c.src_org || '' }), { name: 'src_org' }),
      field('URL', h('input', { name: 'src_url', value: c.src_url || '', inputmode: 'url', placeholder: 'https://' }), { span: true, name: 'src_url' }),
      h('label', { class: 'check span-all' }, h('input', { type: 'checkbox', name: 'src_checked', checked: c.src_checked === 'Y' }),
        '1차 출처 원문을 직접 확인했습니다 (체크하지 않으면 「미확인」 카드로 표시됩니다)'),
      h('div', { class: 'btn-row span-all' },
        h('button', { type: 'submit', class: 'btn btn-primary' }, '저장'),
        h('a', { class: 'btn', href: K.route }, '목록으로'),
        c.id ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
          confirmDo('카드 삭제', '「' + c.title + '」 카드를 지웁니다. 되돌릴 수 없습니다.', '삭제', function () {
            var r = L.deleteCard(db, kind, c.id);
            if (r.ok) { save(r.db); toast('삭제했습니다.'); go(K.route); }
          });
        } }, '삭제') : null));
    K.fields.forEach(function (f) { form.elements[f.key].value = c[f.key] || ''; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var card = { id: c.id };
      ['title', 'when', 'type', 'src_title', 'src_org', 'src_url'].concat(K.fields.map(function (f) { return f.key; })).forEach(function (k) { card[k] = form.elements[k].value.trim(); });
      card.areas = Array.prototype.filter.call(form.querySelectorAll('input[name=areas]'), function (x) { return x.checked; }).map(function (x) { return x.value; }).join(';');
      card.src_checked = form.elements.src_checked.checked;
      var r = L.upsertCard(db, kind, card, now());
      if (!r.ok) { showErrors(form, r.errors); return; }
      save(r.db); toast('저장했습니다 (' + r.id + ').'); go(K.route);
    });
    add(main, h('div', { class: 'page-head' }, h('h1', null, c.id ? K.name + ' ' + c.id : '새 ' + K.name), c.id ? verifyBadge(c) : null),
      h('section', { class: 'card' }, form));
  }

  // ── 프롬프트 세트 ─────────────────────────────────────────
  function viewPrompts() {
    var sampleItem = { area_id: 1, question: '[문제]', ans_intro: '[서론]', ans_body: '[본론]', ans_conclusion: '[결론]' };
    var roles = L.ROLES.map(function (r) {
      return '### ' + r.label + ' — ' + r.focus + '\n당신은 ' + r.label + '입니다. 가스기술사 필기시험 답안을 「' + r.focus + '」에서 평가합니다.\n평가 기준:\n' +
        r.criteria.map(function (c) { return '- ' + c; }).join('\n') + '\n답변 형식:\n[' + r.label + '] 점수: (0~100 사이 정수)\n평가: (잘한 점, 부족한 점, 보완 방법을 3~6줄로)';
    }).join('\n\n');
    var summary = '### 종합 — 네 관점 결과를 모아 총평\n네 평가를 읽고 이 답안에서 가장 먼저 고칠 점 3가지와 총평을 써 주세요.\n답변 형식:\n[종합의견]\n(내용)';
    var all = '# 가스기술사 4관점 평가 프롬프트 세트 (' + today() + ')\n\n## 역할별 (Dify 에이전트로 나눌 때)\n\n' + roles + '\n\n' + summary +
      '\n\n## 한 번에 평가 (채팅창 하나로 쓸 때)\n\n' + L.buildEvalPrompt(sampleItem) + '\n\n## 모범답안\n\n' + L.buildModelPrompt(sampleItem) +
      '\n\n## 출제\n\n' + L.buildQuestionPrompt(L.emptyDb(), '[날짜]');
    add(main, h('div', { class: 'page-head' }, h('h1', null, '4관점 평가 프롬프트 세트'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: function () { copyText(all); } }, '전체 복사'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { download('4관점_프롬프트세트.txt', new Blob([all], { type: 'text/plain;charset=utf-8' })); } }, '텍스트 파일로 받기'))),
      h('p', { class: 'note' }, '문제 풀이 화면이 쓰는 프롬프트와 같은 내용입니다. 역할별 블록은 Dify(DAY4)에서 에이전트를 넷으로 나눌 때 각 에이전트의 지시문으로 옮겨 쓸 수 있습니다. 평가 기준 문구는 js/config.js 에서 고칩니다.'),
      h('section', { class: 'card' }, promptPanel('역할별 지시문', roles + '\n\n' + summary)),
      h('section', { class: 'card' }, promptPanel('한 번에 평가 (문제 풀이 3단계와 같음)', L.buildEvalPrompt(sampleItem), '[문제]·[서론]·[본론]·[결론] 자리에 실제 문제와 답안이 들어갑니다.')),
      h('section', { class: 'card' }, promptPanel('모범답안 (문제 풀이 4단계와 같음)', L.buildModelPrompt(sampleItem))));
  }

  // ── 데이터 ────────────────────────────────────────────────
  function viewData() {
    var counts = '학습기록 ' + db.items.length + '건 · 사고 카드 ' + db.accidents.length + '장 · 기술 카드 ' + db.techs.length + '장';
    var file = h('input', { type: 'file', accept: '.xlsx,.xls', 'aria-label': '엑셀 파일' });
    add(main, h('div', { class: 'page-head' }, h('h1', null, '데이터')),
      h('section', { class: 'card' }, h('h2', null, '지금 이 브라우저의 데이터'), h('p', null, counts + (db._sample ? ' (예시 데이터)' : '')),
        h('p', { class: 'note' }, '데이터는 이 브라우저(localStorage)에만 저장됩니다. 다른 기기에서 이어 쓰려면 엑셀로 내보낸 뒤 그 기기에서 가져오십시오.')),
      h('section', { class: 'card' }, h('h2', null, '엑셀 내보내기'),
        h('p', { class: 'note' }, '시트 3개(학습기록·사고카드·기술카드)가 든 xlsx 파일을 받습니다.'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: exportExcel }, '엑셀로 내보내기')),
      h('section', { class: 'card' }, h('h2', null, '엑셀 가져오기'),
        h('p', { class: 'note' }, '이 도구에서 내보낸 xlsx 파일을 읽어 지금 데이터를 바꿉니다. 먼저 지금 데이터를 내보내 두십시오.'),
        h('div', { class: 'btn-row' }, file, h('button', { type: 'button', class: 'btn', onclick: function () { importExcel(file.files[0]); } }, '가져오기'))),
      h('section', { class: 'card' }, h('h2', null, '예시 데이터'),
        h('p', { class: 'note' }, '화면 흐름을 확인하는 가상의 기록 2일치(문제 20개, 일부 답안·평가)와 양식 확인용 빈 카드 2장입니다. 문제는 교재에 흔한 일반 주제를 문제 형태로만 적었고, 답안·평가 칸은 자리표시 문구입니다.'),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', onclick: function () {
            var load = function () { save(window.GTSample.build(now())); toast('예시 데이터를 불러왔습니다.'); go('#/records'); };
            if (db.items.length || db.accidents.length || db.techs.length) confirmDo('예시 데이터 불러오기', '지금 데이터를 지우고 예시 데이터로 바꿉니다.', '바꾸기', load);
            else load();
          } }, '예시 데이터 불러오기'),
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
            confirmDo('모두 지우기', '이 브라우저의 학습 기록과 카드를 모두 지웁니다. 되돌릴 수 없습니다.', '모두 지우기', function () {
              S.clearDb(); db = L.emptyDb(); save(); toast('모두 지웠습니다.'); go('#/today');
            });
          } }, '모두 지우기'))));
  }
  function exportExcel() {
    if (!window.XLSX) { toast('엑셀 라이브러리를 불러오지 못했습니다.', true); return; }
    var sheets = L.dbToSheets(db);
    var wb = XLSX.utils.book_new();
    Object.keys(sheets).forEach(function (n) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheets[n]), n); });
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download('가스기술사학습_' + today() + (db._sample ? '_예시데이터' : '') + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  function importExcel(f) {
    if (!f) { toast('파일을 고르십시오.', true); return; }
    if (!window.XLSX) { toast('엑셀 라이브러리를 불러오지 못했습니다.', true); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: true });
        var sheets = {};
        wb.SheetNames.forEach(function (n) { sheets[n.trim()] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); });
        var r = L.sheetsToDb(sheets);
        if (!r.report.read.length) { toast('읽을 수 있는 시트가 없습니다(학습기록·사고카드·기술카드).', true); return; }
        confirmDo('가져오기 확인', '읽은 내용: ' + r.report.read.join(', ') + (r.report.problems.length ? ' / 확인할 점 ' + r.report.problems.length + '건' : '') + '. 지금 데이터를 이 내용으로 바꿉니다.', '바꾸기', function () {
          save(r.db); render();
          dialog('가져오기 결과', h('div', null, h('p', null, '읽음: ' + r.report.read.join(', ')),
            r.report.skipped.length ? h('p', null, '없는 시트: ' + r.report.skipped.join(', ')) : null,
            r.report.problems.length ? h('ul', null, r.report.problems.map(function (p) { return h('li', null, p); })) : null));
        });
      } catch (e) { toast('파일을 읽지 못했습니다: ' + e.message, true); }
    };
    reader.readAsArrayBuffer(f);
  }

  // ── 라우팅 ────────────────────────────────────────────────
  function render() {
    var route = location.hash || '#/today';
    var parts = route.slice(2).split('/').map(decodeURIComponent);
    // 자동 임시저장 대기 중에 다른 화면으로 가면 먼저 저장합니다
    clearTimeout(autosaveTimer);
    if (flushDraft) { var fd = flushDraft; flushDraft = null; fd(); }
    main.textContent = '';
    renderNav(route);
    updateBanner();
    switch (parts[0]) {
      case 'q': viewQuestion(parts[1], parts[2]); break;
      case 'records': viewRecords(); break;
      case 'print': viewPrint(parts[1]); break;
      case 'stats': viewStats(); break;
      case 'accidents': parts[1] ? viewCardForm('accident', parts[1]) : viewCards('accident'); break;
      case 'techs': parts[1] ? viewCardForm('tech', parts[1]) : viewCards('tech'); break;
      case 'prompts': viewPrompts(); break;
      case 'data': viewData(); break;
      default: viewToday(parts[1]);
    }
    main.setAttribute('data-route', route);
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);
  render();
})();
