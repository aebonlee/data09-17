/* 브라우저 저장소 — localStorage 를 쓰되, 막혀 있거나 가득 차면 메모리로만 동작합니다 */
(function (root) {
  'use strict';
  var KEY_DB = 'data09-17.db';
  var memory = {};
  var ok = true;
  function get(k) {
    try { return root.localStorage.getItem(k); } catch (e) { ok = false; return memory[k] == null ? null : memory[k]; }
  }
  function set(k, v) {
    try { root.localStorage.setItem(k, v); return true; } catch (e) { ok = false; memory[k] = v; return false; }
  }
  function del(k) {
    try { root.localStorage.removeItem(k); } catch (e) { ok = false; delete memory[k]; }
  }
  function loadDb() {
    var L = root.QCLogic;
    var db = L.emptyDb();
    var raw = get(KEY_DB);
    if (!raw) return db;
    try {
      var p = JSON.parse(raw);
      if (Array.isArray(p.rows)) db.rows = p.rows;
      if (p.mapping && typeof p.mapping === 'object') {
        // 2026-09-30: 「완료여부」를 재발방지대책에 연결해 저장했던 경우 진행상태로 옮기고, 이미 불러온 이력의 상태 값도 옮깁니다.
        var fx = L.fixMapping(p.mapping);
        db.mapping = fx.mapping;
        if (fx.moved && Array.isArray(p.rows)) db._statusMoved = L.moveStatusValues(p.rows);
      }
      if (p.mappingBySource && typeof p.mappingBySource === 'object') db.mappingBySource = p.mappingBySource;
      if (p.dict && typeof p.dict === 'object') L.DICT_FIELDS.forEach(function (f) { if (p.dict[f] && typeof p.dict[f] === 'object') db.dict[f] = p.dict[f]; });
      if (p.rule && typeof p.rule === 'object') db.rule = L.migrateRule(p.rule); // 옛 시작값(30일 3건)이면 확정 기준으로
      if (p.search && typeof p.search === 'object') db.search = Object.assign({}, L.DEFAULT_SEARCH, p.search);
      if (p.draft && typeof p.draft === 'object') db.draft = p.draft;
      if (typeof p.seq === 'number') db.seq = p.seq;
      if (Array.isArray(p.headers)) db.headers = p.headers.filter(function (x) { return typeof x === 'string'; });
      if (p.nextChecks && typeof p.nextChecks === 'object') db.nextChecks = p.nextChecks;
      if (p._sample) db._sample = true;
    } catch (e) { /* 깨진 값은 무시하고 빈 DB */ }
    return db;
  }
  root.QCStore = {
    loadDb: loadDb,
    saveDb: function (db) { return set(KEY_DB, JSON.stringify(db)); },
    clearDb: function () { del(KEY_DB); },
    available: function () { get(KEY_DB); return ok; }
  };
})(window);
