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
    return db;
  }
  // 자동 모드 설정 — API 키는 DB(엑셀 내보내기)와 따로 두어 파일로 새어 나가지 않게 합니다
  var KEY_AI_KEY = 'data09-02.openai_key', KEY_AI_MODEL = 'data09-02.openai_model';
  root.GTStore = {
    getAi: function () {
      var C = root.GTConfig.AI;
      var model = get(KEY_AI_MODEL);
      return { key: get(KEY_AI_KEY) || '', model: C.models.indexOf(model) !== -1 ? model : C.defaultModel };
    },
    setAiKey: function (k) { if (k) set(KEY_AI_KEY, k); else del(KEY_AI_KEY); },
    setAiModel: function (m) { set(KEY_AI_MODEL, m); },
    loadDb: loadDb,
    saveDb: function (db) { set(KEY_DB, JSON.stringify(db)); },
    clearDb: function () { del(KEY_DB); },
    available: function () { get(KEY_DB); return ok; }
  };
})(window);
