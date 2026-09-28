/*
 * 예시 데이터 — 화면 흐름을 보여 주려고 만든 가상의 학습 기록입니다.
 * - 문제는 교재에 흔히 나오는 일반 주제를 문제 형태로만 적었습니다(출처가 있는 기출문제가 아닙니다).
 * - 답안·평가·모범답안 칸에는 기술 내용을 쓰지 않고 「예시」 자리표시 문구만 넣었습니다.
 *   지어낸 기술 사실이 실제 공부 자료처럼 남지 않게 하기 위함입니다.
 * - 점수는 영역별 현황표·그래프가 어떻게 보이는지 확인하기 위한 임의의 값입니다.
 * - 사고·기술 카드는 양식 확인용 빈 카드 1장씩이며, 실제 사고·기술 정보가 아닙니다.
 * 날짜는 불러오는 날을 기준으로 2일 전·1일 전으로 계산합니다(오늘 문제는 직접 출제해 보도록 비워 둡니다).
 */
(function (root) {
  'use strict';
  function day(now, back) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  var Q = {
    1: ['(예시) 최소점화에너지(MIE)의 정의와 이에 영향을 주는 인자를 설명하시오.', '(예시) 폭연(Deflagration)과 폭굉(Detonation)의 차이를 설명하시오.'],
    2: ['(예시) 위험장소 구분의 개념과 구분할 때 고려할 사항을 설명하시오.', '(예시) 내압방폭구조의 원리와 특징을 설명하시오.'],
    3: ['(예시) 베르누이 방정식의 가정과 가스배관 유량 계산에서의 활용을 설명하시오.', '(예시) 관로 마찰손실에 영향을 주는 인자를 설명하시오.'],
    4: ['(예시) 가스연소기의 역화와 선화의 원인과 대책을 설명하시오.', '(예시) 불완전연소의 원인과 방지대책을 설명하시오.'],
    5: ['(예시) 고압가스 설비에 안전밸브를 설치하는 목적과 선정 시 고려사항을 설명하시오.', '(예시) 고압가스 충전설비의 정전기 방지대책을 설명하시오.'],
    6: ['(예시) LPG 기화기의 종류별 특징을 설명하시오.', '(예시) 액화가스 저장설비에서 BLEVE가 일어나는 과정과 방지대책을 설명하시오.'],
    7: ['(예시) 도시가스 배관의 전기방식 방법을 비교해 설명하시오.', '(예시) 정압기의 기능과 주요 구성요소를 설명하시오.'],
    8: ['(예시) 수소취성의 발생 과정과 방지대책을 설명하시오.', '(예시) 수소충전소의 주요 위험요소와 안전대책을 설명하시오.'],
    9: ['(예시) 이음매 없는 용기와 용접용기의 특징을 비교해 설명하시오.', '(예시) 가스용기 재검사의 목적과 주요 검사 항목을 설명하시오.'],
    10: ['(예시) 저장탱크 방류둑의 설치 목적과 설계 시 고려사항을 설명하시오.', '(예시) 저온 저장탱크의 단열 방식과 특징을 설명하시오.']
  };
  // [영역번호, 가스기술사, 공학박사, 채점위원, 전문기자] — 현황표 확인용 임의 점수
  var S2 = [[1, 72, 68, 75, 60], [2, 55, 50, 62, 48], [3, 80, 85, 78, 70], [5, 66, 70, 64, 58], [7, 74, 72, 80, 65], [8, 52, 58, 55, 50]];
  var S1 = [[1, 76, 70, 78, 66], [2, 60, 54, 65, 52], [4, 70, 66, 72, 62]];
  var ANS = {
    ans_intro: '(예시 답안 — 서론) 문제에서 다루는 개념을 한두 문장으로 정의하는 자리입니다.',
    ans_body: '(예시 답안 — 본론) 1. 원리  2. 영향 인자  3. 현장 적용 순서로 항목을 나누어 쓰는 자리입니다.',
    ans_conclusion: '(예시 답안 — 결론) 실무 시사점과 본인 의견을 정리하는 자리입니다.'
  };
  function evalFields(s) {
    var o = { score_engineer: s[1], score_doctor: s[2], score_grader: s[3], score_reporter: s[4] };
    o.score_total = Math.round((s[1] + s[2] + s[3] + s[4]) / 4 * 10) / 10;
    o.cmt_engineer = '(예시 평가) 가스기술사 관점 의견이 들어가는 자리입니다. 실제 AI 평가가 아닙니다.';
    o.cmt_doctor = '(예시 평가) 공학박사 관점 의견이 들어가는 자리입니다. 실제 AI 평가가 아닙니다.';
    o.cmt_grader = '(예시 평가) 채점위원 관점 의견이 들어가는 자리입니다. 실제 AI 평가가 아닙니다.';
    o.cmt_reporter = '(예시 평가) 전문기자 관점 의견이 들어가는 자리입니다. 실제 AI 평가가 아닙니다.';
    o.cmt_total = '(예시 종합의견) 네 관점을 종합한 총평이 들어가는 자리입니다.';
    return o;
  }
  function makeDay(date, qIndex, scores, extra) {
    var items = [];
    for (var a = 1; a <= 10; a++) {
      var it = { set_date: date, area_id: a, question: Q[a][qIndex], q_source: '예시', created_at: date + ' 07:00' };
      var sc = scores.filter(function (s) { return s[0] === a; })[0];
      if (sc || (extra.answered || []).indexOf(a) !== -1 || (extra.draft || []).indexOf(a) !== -1) {
        it.ans_intro = ANS.ans_intro; it.ans_body = ANS.ans_body; it.ans_conclusion = ANS.ans_conclusion;
        it.ans_saved_at = date + ' 08:30';
        if ((extra.draft || []).indexOf(a) === -1) it.ans_submitted_at = date + ' 08:40';
      }
      if (sc) {
        var ev = evalFields(sc);
        Object.keys(ev).forEach(function (k) { it[k] = ev[k]; });
        it.eval_at = date + ' 09:00';
        if ((extra.model || []).indexOf(a) !== -1) {
          it.model_answer = '[서론]\n(예시 모범답안) AI가 쓴 모범답안을 붙여 넣으면 이 자리에 표시됩니다.\n\n[본론]\n(예시) 항목별 본문 자리입니다.\n\n[결론]\n(예시) 결론 자리입니다.';
          it.model_at = date + ' 09:10';
        }
      }
      items.push(it);
    }
    return items;
  }
  function build(now) {
    now = now || new Date();
    var d2 = day(now, 2), d1 = day(now, 1);
    var items = makeDay(d2, 0, S2, { model: [1, 3, 7] }).concat(makeDay(d1, 1, S1, { answered: [5, 6], draft: [9], model: [1] }));
    return {
      _sample: true,
      items: items,
      accidents: [{
        id: 'ACC-001', title: '(예시 카드) 양식 확인용 — 실제 사고가 아닙니다', when: '', type: '기타', areas: '1;7',
        overview: '사고 개요를 적는 칸입니다. 실제 사례는 1차 출처를 확인한 뒤 적습니다.',
        cause: '사고 원인을 적는 칸입니다.', mechanism: '사고발생 메커니즘을 적는 칸입니다.',
        prevention: '재발방지대책을 적는 칸입니다.', opinion: '가스기술사 종합의견을 적는 칸입니다.',
        src_title: '', src_org: '', src_url: '', src_checked: '', created_at: d1 + ' 10:00', updated_at: d1 + ' 10:00'
      }],
      techs: [{
        id: 'TEC-001', title: '(예시 카드) 양식 확인용 — 실제 기술 정보가 아닙니다', when: '', type: '기타', areas: '8',
        definition: '기술 정의를 적는 칸입니다.', problem: '기존 기술의 문제점을 적는 칸입니다.',
        core: '핵심 기술을 적는 칸입니다.', application: '적용 분야를 적는 칸입니다.', outlook: '향후 발전방향을 적는 칸입니다.',
        src_title: '', src_org: '', src_url: '', src_checked: '', created_at: d1 + ' 10:00', updated_at: d1 + ' 10:00'
      }]
    };
  }
  var api = { build: build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GTSample = api;
})(typeof window !== 'undefined' ? window : this);
