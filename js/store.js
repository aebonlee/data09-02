/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있으면 메모리로만 동작합니다 */
(function (root) {
  'use strict';
  var KEY_DB = 'data09-02.db';
  var memory = {};
  var ok = true;
  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); } catch (e) { ok = false; memory[k] = v; }
  }
  function del(k) {
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; delete memory[k]; }
  }
  function loadDb() {
    var raw = get(KEY_DB);
    var db = root.GTLogic.emptyDb();
    if (!raw) return db;
    try {
      var p = JSON.parse(raw);
      Object.keys(db).forEach(function (k) { if (Array.isArray(p[k])) db[k] = p[k]; });
      if (p._sample) db._sample = true;
    } catch (e) { /* 깨진 값은 무시하고 빈 DB */ }
    // 예전 기술 카드(기술명 + 5항목)를 제목·목차·내용으로 옮깁니다 (2026-09-29 오후)
    var n = root.GTLogic.normalizeDb(db);
    if (db._sample) n._sample = true;
    return n;
  }
  // 자동 모드 설정 — API 키는 DB(엑셀 내보내기)와 따로 두어 파일로 새어 나가지 않게 합니다
  var KEY_AI_KEY = 'data09-02.openai_key', KEY_AI_MODEL = 'data09-02.openai_model';
  var KEY_AUTO_Q = 'data09-02.auto_questions', KEY_AUTO_Q_DATE = 'data09-02.auto_questions_date';
  root.GTStore = {
    getAi: function () {
      var C = root.GTConfig.AI;
      var model = get(KEY_AI_MODEL);
      return { key: get(KEY_AI_KEY) || '', model: C.models.indexOf(model) !== -1 ? model : C.defaultModel };
    },
    setAiKey: function (k) { if (k) set(KEY_AI_KEY, k); else del(KEY_AI_KEY); },
    setAiModel: function (m) { set(KEY_AI_MODEL, m); },
    // 「오늘의 문제」를 열었을 때 문제가 없으면 AI 가 자동 출제 (키가 있을 때만, 기본 켜짐)
    getAutoQuestions: function () { return get(KEY_AUTO_Q) !== '0'; },
    setAutoQuestions: function (on) { set(KEY_AUTO_Q, on ? '1' : '0'); },
    // 같은 날짜를 두 번 자동 출제하지 않도록(실패해 새로고침해도 요금이 다시 나가지 않게) 마지막 시도 날짜를 둡니다
    autoQuestionTried: function (date) { return get(KEY_AUTO_Q_DATE) === date; },
    markAutoQuestion: function (date) { set(KEY_AUTO_Q_DATE, date); },
    loadDb: loadDb,
    saveDb: function (db) { set(KEY_DB, JSON.stringify(db)); },
    clearDb: function () { del(KEY_DB); },
    available: function () { get(KEY_DB); return ok; }
  };
})(window);
