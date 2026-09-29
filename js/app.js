/* 품질불량 이력 분석 도구 — 화면 (품질 이력 · 불러오기 · 표기 정리 · 유사 불량 · 반복·다발 · 월간 현황 · 대책서 초안) */
(function () {
  'use strict';
  var L = window.QCLogic;
  var S = window.QCStore;
  var Sample = window.QCSample;
  var XLSX = window.XLSX;
  var PAGE = 50;

  var db = S.loadDb();
  var imp = null;
  var view = { from: '', to: '', part_no: '', defect_type: '', cause: '', process: '', customer: '', keyword: '', axis: 'defect_type', page: 0 };
  var searchQ = { text: '', part_no: '', defect_type: '' };
  var dictField = 'defect_type';
  var repView = { from: '', to: '', open: {} };
  var monthView = { from: '', to: '', month: '', measure: 'count' };

  // ── 작은 도구 ─────────────────────────────────────────────
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function fmt(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 2 }); }
  function toast(msg, isError) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3500);
  }
  function save() { if (!S.saveDb(db)) document.getElementById('storeBanner').hidden = false; }
  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', null, label), input, hint ? h('small', { class: 'hint' }, hint) : null);
  }
  function select(name, options, value, attrs) {
    var s = h('select', Object.assign({ name: name }, attrs || {}));
    options.forEach(function (o) {
      var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
      s.appendChild(h('option', { value: v, selected: String(v) === String(value) }, t));
    });
    return s;
  }
  function datalist(id, values) { return h('datalist', { id: id }, values.map(function (v) { return h('option', { value: v }); })); }
  function openDialog(title, content, actions) {
    var d = document.getElementById('dialog');
    document.getElementById('dialogTitle').textContent = title;
    var c = document.getElementById('dialogContent'); c.textContent = ''; add(c, content);
    var a = document.getElementById('dialogActions'); a.textContent = ''; add(a, actions);
    if (!d.open) d.showModal();
  }
  function closeDialog() { var d = document.getElementById('dialog'); if (d.open) d.close(); }
  function download(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function writeXlsx(name, sheets) {
    var wb = XLSX.utils.book_new();
    Object.keys(sheets).forEach(function (n) {
      var ws = XLSX.utils.aoa_to_sheet(sheets[n]);
      ws['!cols'] = (sheets[n][0] || []).map(function () { return { wch: 16 }; });
      XLSX.utils.book_append_sheet(wb, ws, n.replace(/[\\\/?*\[\]:]/g, '-').slice(0, 31));
    });
    var out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    download(name, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  function copyText(s) {
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' });
      ta.value = s; document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? '복사했습니다' : '복사하지 못했습니다. 글상자를 눌러 직접 복사하세요', !ok);
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(s).then(function () { toast('복사했습니다'); }, fallback);
    else fallback();
  }
  function today() { return L.toDateStr(new Date()); }
  function tag() { return db._sample ? '_예시데이터' : ''; }
  function cdata() { return L.canonRows(db.dict, db.rows); }
  function addRows(rows, replace) {
    if (replace) { db.rows = []; delete db._sample; }
    rows.forEach(function (r) { db.seq = (db.seq || 0) + 1; r.id = 'r' + db.seq; db.rows.push(r); });
  }
  function byDateDesc(a, b) { return (b.date || '') < (a.date || '') ? -1 : (b.date || '') > (a.date || '') ? 1 : 0; }
  function rowTitle(r) { return [r.mgmt_no, r.date, r.part_no, r.part_name].filter(Boolean).join(' · ') || '(빈 행)'; }
  function emptyNotice(main, title) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, title)));
    main.appendChild(h('section', { class: 'card' },
      h('p', null, '아직 품질 이력이 없습니다. 「품질 이력」에서 Excel을 불러오거나 예시 데이터를 불러오세요.'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/list' }, '품질 이력으로'), sampleButton(false))));
  }

  // ── 라우팅 ────────────────────────────────────────────────
  function route() { return (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'list'; }
  function render() {
    var r = route();
    var main = document.getElementById('main');
    main.textContent = '';
    document.querySelectorAll('#nav a').forEach(function (a) {
      var dr = a.getAttribute('data-route');
      if (dr === r || (r === 'import' && dr === 'list')) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.getElementById('sampleBanner').hidden = !db._sample;
    if (!S.available()) document.getElementById('storeBanner').hidden = false;
    if (r === 'import' && imp) renderImport(main);
    else if (r === 'dict') renderDict(main);
    else if (r === 'search') renderSearch(main);
    else if (r === 'repeat') renderRepeat(main);
    else if (r === 'monthly') renderMonthly(main);
    else if (r === 'draft') renderDraft(main);
    else if (r === 'next') renderNext(main);
    else renderList(main);
    main.setAttribute('data-route', r);
  }
  window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });
  var lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    clearTimeout(render._r);
    render._r = setTimeout(function () {
      if (route() === 'monthly' && Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; render(); }
    }, 200);
  });

  // ── 공통 버튼 ─────────────────────────────────────────────
  function sampleButton(primary) {
    return h('button', { type: 'button', class: 'btn' + (primary ? ' btn-primary' : ''), onclick: loadSample }, '예시 데이터 불러오기');
  }
  function loadSample() {
    function go() {
      var keep = { mapping: db.mapping, rule: db.rule, search: db.search };
      db = L.emptyDb();
      Object.assign(db, keep);
      addRows(Sample.build());
      Object.assign(db.dict.cause_cat, Sample.dictHint);
      Object.assign(db.dict.defect_type, Sample.typeHint);
      db._sample = true;
      save(); closeDialog();
      toast('예시 데이터 ' + db.rows.length + '건을 불러왔습니다');
      if (route() !== 'list') location.hash = '#/list'; else render();
    }
    if (db.rows.length && !db._sample) {
      openDialog('예시 데이터 불러오기', h('p', null, '지금 있는 이력 ' + db.rows.length + '건과 표기 사전을 지우고 예시 데이터로 바꿉니다. 먼저 「Excel 내보내기」로 받아 두세요.'), [
        h('button', { type: 'button', class: 'btn', onclick: closeDialog }, '취소'),
        h('button', { type: 'button', class: 'btn btn-danger', onclick: go }, '지우고 불러오기')
      ]);
    } else go();
  }
  function importButton(primary) {
    var input = h('input', { type: 'file', accept: '.xlsx,.xls,.csv', multiple: true, 'aria-label': 'Excel·CSV 파일 선택', onchange: function (e) { readFiles(e.target.files); } });
    return h('label', { class: 'btn file-btn' + (primary ? ' btn-primary' : '') }, 'Excel·CSV 불러오기', input);
  }
  function templateButton() {
    return h('button', { type: 'button', class: 'btn', onclick: function () { writeXlsx('품질불량이력_표준양식.xlsx', L.templateSheets()); } }, '빈 양식 내려받기');
  }
  function exportAll() {
    var dictAoa = [['항목', '원래 표기(띄어쓰기·기호 뺀 키)', '대표 이름']];
    L.DICT_FIELDS.forEach(function (f) {
      Object.keys(db.dict[f] || {}).forEach(function (k) { dictAoa.push([L.FIELD[f].label, k, db.dict[f][k]]); });
    });
    var rows = db.rows.slice().sort(byDateDesc);
    writeXlsx('품질불량이력' + tag() + '_' + today() + '.xlsx', {
      '품질불량이력': L.standardSheet(rows),
      '표기 정리 적용': L.standardSheet(L.canonRows(db.dict, rows)),
      '표기 사전': dictAoa
    });
  }

  // ── 품질 이력 ─────────────────────────────────────────────
  // ── 다음 단계 ─────────────────────────────────────────────
  // 홈(품질 이력) 위에 두는 짧은 안내. 자세한 것은 #/next.
  function nextPanel() {
    return h('section', { class: 'card next-panel', 'aria-labelledby': 'nextPanelTitle' },
      h('h2', { id: 'nextPanelTitle' }, '다음 단계로 가려면'),
      h('ol', { class: 'next-steps' },
        h('li', null, '실제 품질불량 이력 Excel 을 불러와 열을 맞추고, 유사 불량·반복·월간 현황을 써 봐 주세요. 가려야 할 값은 가린 사본으로 해도 됩니다.'),
        h('li', null, '안 맞았던 점과 기획서 10장 질문의 답을 적어 주세요.'),
        h('li', null, '「다음 단계」에서 요약 글을 만들어 패들릿 댓글로 올려 주세요. 불량유형별 사진과 대책서가 있으면 몇 장·몇 건인지도 함께 알려 주세요.')),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn btn-primary', href: '#/next' }, '다음 단계 안내 보기')));
  }
  function renderNext(main) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '다음 단계로 가려면')));
    main.appendChild(h('p', null, '2단계(실제 데이터 보정 · 대책서·표준 문서 검색 · 사진)는 받은 자료에 맞춰 만듭니다. 아래 순서대로 준비해 주세요. 체크한 항목은 이 브라우저에 기억됩니다.'));
    var checks = db.nextChecks || (db.nextChecks = {});
    function checklist(group) {
      return h('ul', { class: 'checklist' }, L.NEXT_CHECKLIST.filter(function (c) { return c.group === group; }).map(function (c) {
        var cb = h('input', { type: 'checkbox', checked: !!checks[c.key], onchange: function () { checks[c.key] = cb.checked; save(); } });
        return h('li', null, h('label', { class: 'check' }, cb, h('span', null, c.label)));
      }));
    }
    main.appendChild(h('section', { class: 'card' },
      h('h2', null, '1. 지금 1단계 도구로 해 볼 것'),
      checklist('now'),
      h('ul', { class: 'next-detail' },
        h('li', null, '회사 밖으로 내기 어려운 값(품번·고객사·담당자 이름 등)은 사본에서 「A사」「품번1」처럼 바꾼 뒤 써도 됩니다. 도구는 파일을 서버로 보내지 않고 이 브라우저 안에서만 계산합니다.'),
        h('li', null, '「열 맞추기」에서 연결할 곳이 없던 열, 읽지 못한 날짜·수량, 찾고 싶은 사례가 안 나온 검색어를 적어 두면 2단계에서 그대로 고칩니다.'))));
    main.appendChild(h('section', { class: 'card' },
      h('h2', null, '2. 보내 주실 것'),
      checklist('send'),
      h('h3', null, '기획서 10장 질문'),
      h('ol', { class: 'next-detail' }, L.PLAN_QUESTIONS.map(function (q) { return h('li', null, q); })),
      h('h3', null, '사진을 모을 때'),
      h('ul', { class: 'next-detail' },
        h('li', null, '불량유형 이름으로 폴더를 나눠 주세요(예: 스크래치 / 찍힘 / 치수 / 정상). 3~5개 유형부터 시작해도 됩니다.'),
        h('li', null, '유형마다 20장 이상, 가능하면 50장을 모아 주세요. 한 장에 불량 하나, 비슷한 거리·조명이면 좋습니다.'),
        h('li', null, '이력과 이을 수 있게 파일 이름에 관리번호를 넣어 주세요(예: Q-0123_1.jpg).'),
        h('li', null, '사진을 회사 밖으로 낼 수 없으면 유형별 장수와 모은 위치만 알려 주세요. 사진이 PC 밖으로 나가지 않는 방식을 찾아 제안합니다.')),
      h('h3', null, '문서(대책서·표준)를 모을 때'),
      h('ul', { class: 'next-detail' },
        h('li', null, '개선대책서·재발방지대책 3~5건(고객사·이름은 가린 것)과 파일 형식을 알려 주세요.'),
        h('li', null, '검사기준서·작업표준서처럼 원인·대책을 찾을 때 보는 사내 표준의 이름과 형식을 알려 주세요.'),
        h('li', null, '고객사 대응자료는 반출 가능 여부를 먼저 확인해 주세요.'))));

    var ta = h('textarea', { class: 'summary-text', rows: 16, readonly: true, 'aria-label': '보낼 요약 글' });
    var outWrap = h('div', { hidden: true }, ta,
      h('div', { class: 'btn-row', style: 'margin-top:8px' }, h('button', { type: 'button', class: 'btn', onclick: function () { copyText(ta.value); } }, '복사')));
    main.appendChild(h('section', { class: 'card' },
      h('h2', null, '3. 요약 글 만들기'),
      h('p', null, '불러온 이력에서 열 이름·건수·기간·불량유형 이름·검사 결과만 모아 글을 만듭니다. 품번·고객사·원인·대책 값은 넣지 않습니다. 복사해서 빈칸을 채운 뒤 패들릿 댓글로 올려 주세요.'),
      h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        ta.value = L.readinessSummary(cdata(), { mapping: db.mapping, headers: db.headers, sample: db._sample });
        outWrap.hidden = false;
      } }, '요약 글 만들기')),
      outWrap));

    main.appendChild(h('section', { class: 'card' },
      h('h2', null, '4. 2단계에서 만드는 것 — 순서'),
      h('ol', { class: 'next-detail' },
        h('li', null, h('strong', null, '실제 이력에 맞추기'), ' — 받은 열 구성으로 열 맞추기 자동 추천, 분류 코드표로 표기 사전, 품질팀 기준으로 반복·다발 기준과 유사 검색 점수를 고칩니다. 자료를 받는 대로 바로 합니다.'),
        h('li', null, h('strong', null, '대책서에서 항목 뽑기'), ' — 개선대책서·재발방지대책 문서에서 불량현상·발생원인·개선대책·재발방지대책을 뽑아 이력에 합칩니다. 유사 불량 검색에 문서 내용도 걸립니다.'),
        h('li', null, h('strong', null, '문서 근거 질의(RAG)'), ' — 대책서·사내 표준을 근거로 「이 현상의 과거 원인과 대책은?」을 묻고, 답에 근거 문서를 붙입니다. 외부 AI 허용 여부(10장 9번)에 따라 NotebookLM·Dify 또는 사내 허용 AI 로 정합니다.'),
        h('li', null, h('strong', null, '사진으로 현상 쓰기'), ' — 사진을 AI 에 보여 주고 불량현상 문장 초안을 받는 반자동 화면부터 만듭니다. 유형별 사진이 충분히 모이면 사진으로 불량유형을 제안하는 자동 분류로 넓힙니다(기획서 3단계).'),
        h('li', null, h('strong', null, 'KPI·알림'), ' — 불량률 분모(생산 수량)와 KPI 계산식을 받으면 월간 KPI 보고서를, 보안이 허용되면 반복·다발 알림(Make)을 붙입니다.'))));
  }
  function renderList(main) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '품질 이력'),
      h('div', { class: 'btn-row' }, importButton(true), sampleButton(false), templateButton())));

    if (!db.rows.length) {
      main.appendChild(h('section', { class: 'card' },
        h('h2', null, '시작하기'),
        h('ol', { class: 'prompt-steps' },
          h('li', null, '지금 쓰는 품질불량 이력 Excel(여러 시트·여러 파일 가능)이나 CSV를 「Excel·CSV 불러오기」로 엽니다.'),
          h('li', null, '「열 맞추기」에서 파일의 열 이름을 표준 항목(발생일·품번·불량유형·불량현상·원인·대책 등)에 연결합니다. 한 번 맞춘 연결은 기억합니다.'),
          h('li', null, '「표기 정리」에서 같은 불량유형·원인이 다르게 적힌 것을 대표 이름으로 묶습니다.'),
          h('li', null, '「유사 불량」「반복·다발」「월간 현황」에서 찾고 살펴보고, 「대책서 초안」에서 과거 이력을 붙인 AI 프롬프트를 만듭니다.')),
        h('p', { class: 'note' }, '실제 파일이 아직 없으면 「예시 데이터 불러오기」로 가상 데이터를 넣어 흐름을 볼 수 있습니다. samples 폴더의 예시 파일로 열 맞추기도 시험해 볼 수 있습니다: ',
          h('a', { href: 'samples/예시데이터_품질불량이력.xlsx', download: true }, '품질불량 이력 Excel(예시)'), ' · ',
          h('a', { href: 'samples/예시데이터_품질불량이력.csv', download: true }, 'CSV(예시)')),
        h('div', { class: 'btn-row' }, importButton(true), sampleButton(false), templateButton())));
      main.appendChild(nextPanel());
      return;
    }
    main.appendChild(nextPanel());

    var issues = L.validateRows(db.rows);
    var byId = {};
    issues.forEach(function (i) { (byId[i.id] = byId[i.id] || []).push(i); });
    var sum = L.issueSummary(issues);
    if (issues.length) {
      var rowsById = {};
      db.rows.forEach(function (r) { rowsById[r.id] = r; });
      var ul = h('ul', { class: 'miss-list' });
      issues.slice().sort(function (a, b) { return a.level === b.level ? 0 : a.level === 'error' ? -1 : 1; }).slice(0, 8).forEach(function (i) {
        var r = rowsById[i.id];
        ul.appendChild(h('li', null, h('span', { class: 'badge ' + i.level }, i.level === 'error' ? '오류' : '확인'), ' ',
          h('a', { href: '#', onclick: function (e) { e.preventDefault(); editRow(r); } }, rowTitle(r)), ' — ' + i.msg));
      });
      main.appendChild(h('section', { class: 'card' }, h('h2', null, '입력값 검사'),
        h('p', null, h('span', { class: 'badge error' }, '오류 ' + sum.error + '건'), ' ', h('span', { class: 'badge warn' }, '확인 ' + sum.warn + '건'),
          ' (' + sum.rows + '건) — 누르면 고칠 수 있습니다. 발생일이 없는 건은 월간 현황·반복 탐지에서 빠집니다.'),
        ul, issues.length > 8 ? h('p', { class: 'note' }, '외 ' + (issues.length - 8) + '건') : null));
    }

    var all = cdata();
    // 거르기
    var card = h('section', { class: 'card' }, h('h2', null, '거르기'));
    var f = h('form', { class: 'filters', onsubmit: function (e) { e.preventDefault(); } });
    var ctl = {
      from: h('input', { type: 'date', value: view.from }),
      to: h('input', { type: 'date', value: view.to }),
      part_no: select('part_no', [['', '전체']].concat(L.valuesOf(all, 'part_no')), view.part_no),
      defect_type: select('defect_type', [['', '전체']].concat(L.valuesOf(all, 'defect_type')), view.defect_type),
      cause: select('cause', [['', '전체']].concat(L.valuesOf(all, L.causeKey)), view.cause),
      process: select('process', [['', '전체']].concat(L.valuesOf(all, 'process')), view.process),
      customer: select('customer', [['', '전체']].concat(L.valuesOf(all, 'customer')), view.customer),
      keyword: h('input', { type: 'search', value: view.keyword, placeholder: '현상·원인·대책 낱말' })
    };
    Object.keys(ctl).forEach(function (k) {
      ctl[k].addEventListener('change', function () { view[k] = ctl[k].value; view.page = 0; render(); });
    });
    add(f, [field('시작일', ctl.from), field('종료일', ctl.to), field('품번', ctl.part_no), field('불량유형', ctl.defect_type),
      field('원인', ctl.cause), field('공정', ctl.process), field('고객사', ctl.customer), field('낱말 찾기', ctl.keyword)]);
    card.appendChild(f);
    var rows = L.filterRows(all, view).sort(byDateDesc);
    var anyFilter = ['from', 'to', 'part_no', 'defect_type', 'cause', 'process', 'customer', 'keyword'].some(function (k) { return view[k]; });
    card.appendChild(h('div', { class: 'list-meta' },
      h('span', null, '전체 ' + all.length + '건 중 ' + rows.length + '건 · 불량수량 ' + fmt(rows.reduce(function (s, r) { return s + (r.qty || 0); }, 0))),
      anyFilter ? h('button', { type: 'button', class: 'btn', onclick: function () {
        ['from', 'to', 'part_no', 'defect_type', 'cause', 'process', 'customer', 'keyword'].forEach(function (k) { view[k] = ''; });
        render();
      } }, '거르기 풀기') : null));
    main.appendChild(card);

    // 집계
    var axes = [['defect_type', '불량유형별'], ['part_no', '품번별'], ['cause', '원인별'], ['process', '공정별'], ['customer', '고객사별']];
    var agg = h('section', { class: 'card' }, h('h2', null, '건수·수량 집계'),
      h('div', { class: 'axis-tabs', role: 'group', 'aria-label': '집계 기준' }, axes.map(function (a) {
        return h('button', { type: 'button', 'aria-pressed': view.axis === a[0] ? 'true' : 'false', onclick: function () { view.axis = a[0]; render(); } }, a[1]);
      })));
    var groups = L.groupCount(rows, view.axis);
    var maxC = groups.length ? groups[0].count : 1;
    var tb = h('tbody');
    groups.slice(0, 15).forEach(function (g) {
      tb.appendChild(h('tr', null, h('td', null, g.key), h('td', { class: 'num' }, fmt(g.count)), h('td', { class: 'num' }, fmt(g.qty)),
        h('td', null, h('div', { class: 'cell-bar' }, h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: 'width:' + Math.round(g.count / maxC * 100) + '%' }))))));
    });
    agg.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, axes.filter(function (a) { return a[0] === view.axis; })[0][1].replace('별', '')), h('th', null, '건수'), h('th', null, '불량수량'), h('th', null, '비중'))), tb)));
    if (groups.length > 15) agg.appendChild(h('p', { class: 'note' }, '상위 15개만 보입니다(전체 ' + groups.length + '개).'));
    if (view.axis === 'cause') agg.appendChild(h('p', { class: 'note' }, '「원인」은 원인 분류 열이 있으면 그 값을, 없으면 발생원인 문장을 씁니다.'));
    main.appendChild(agg);

    // 목록
    var list = h('section', { class: 'card' }, h('h2', null, '이력 목록'));
    list.appendChild(h('div', { class: 'list-meta' }, h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', onclick: function () { editRow(null); } }, '건 추가'),
      h('button', { type: 'button', class: 'btn', onclick: exportAll }, 'Excel 내보내기'),
      h('button', { type: 'button', class: 'btn', onclick: function () {
        download('품질불량이력' + tag() + '_' + today() + '.csv', new Blob([L.aoaToCsv(L.standardSheet(rows))], { type: 'text/csv;charset=utf-8' }));
      } }, anyFilter ? '거른 결과 CSV' : 'CSV 내보내기'),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: clearAll }, '전체 삭제'))));
    var pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (view.page >= pages) view.page = pages - 1;
    var shown = rows.slice(view.page * PAGE, view.page * PAGE + PAGE);
    var cols = ['mgmt_no', 'date', 'part_no', 'part_name', 'defect_type', 'symptom', 'cause_cat', 'cause', 'action', 'qty', 'process', 'customer'];
    var rawById = {};
    db.rows.forEach(function (r) { rawById[r.id] = r; });
    var body = h('tbody');
    shown.forEach(function (r) {
      var raw = rawById[r.id];
      var lvl = (byId[r.id] || []).some(function (i) { return i.level === 'error'; }) ? 'error' : byId[r.id] ? 'warn' : '';
      body.appendChild(h('tr', { class: 'clickable' + (lvl ? ' row-' + lvl : ''), tabindex: '0',
        onclick: function () { editRow(raw); }, onkeydown: function (e) { if (e.key === 'Enter') editRow(raw); } },
        cols.map(function (k) {
          var v = r[k];
          if (v == null && raw._raw && raw._raw[k] != null) v = raw._raw[k];
          var changed = L.DICT_FIELDS.indexOf(k) >= 0 && raw[k] && raw[k] !== v;
          if (k === 'qty') return h('td', { class: 'num' }, typeof v === 'number' ? fmt(v) : (v || ''));
          if (['symptom', 'cause', 'action'].indexOf(k) >= 0) return h('td', { class: 'clip wide' }, h('span', { class: 'clip-text' }, v || ''));
          return h('td', { title: changed ? '원래 표기: ' + raw[k] : null, class: k === 'date' ? 'num' : null }, v == null ? '' : String(v));
        })));
    });
    list.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map(function (k) { return h('th', null, L.FIELD[k].label); }))), body)));
    list.appendChild(h('p', { class: 'note' }, '불량유형·원인은 「표기 정리」를 적용한 대표 이름으로 보입니다. 원래 표기는 칸에 마우스를 올리거나 건을 열면 보입니다.'));
    if (pages > 1) {
      list.appendChild(h('div', { class: 'pager' },
        h('button', { type: 'button', class: 'btn', disabled: view.page === 0, onclick: function () { view.page--; render(); } }, '이전'),
        h('span', null, (view.page + 1) + ' / ' + pages + ' 쪽'),
        h('button', { type: 'button', class: 'btn', disabled: view.page >= pages - 1, onclick: function () { view.page++; render(); } }, '다음')));
    }
    main.appendChild(list);
  }
  function clearAll() {
    openDialog('전체 삭제', h('p', null, '이 브라우저에 저장된 품질 이력 ' + db.rows.length + '건과 대책서 초안 작업을 지웁니다. 열 연결·표기 사전·탐지 기준은 남깁니다. 되돌릴 수 없습니다.'), [
      h('button', { type: 'button', class: 'btn', onclick: closeDialog }, '취소'),
      h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
        var keep = { mapping: db.mapping, dict: db._sample ? L.emptyDb().dict : db.dict, rule: db.rule, search: db.search };
        db = L.emptyDb(); Object.assign(db, keep);
        save(); closeDialog(); toast('모두 지웠습니다'); render();
      } }, '모두 지우기')
    ]);
  }

  // 건 추가·고치기
  function editRow(r, preset) {
    var isNew = !r;
    var form = h('div', { class: 'form-grid' });
    var inputs = {};
    var long = ['symptom', 'cause', 'action', 'prevention'];
    L.STD_FIELDS.forEach(function (f) {
      var v = r ? r[f.key] : (preset && preset[f.key] != null ? preset[f.key] : (f.key === 'date' ? today() : ''));
      if (r && v == null && r._raw && r._raw[f.key] != null) v = r._raw[f.key];
      var el;
      if (long.indexOf(f.key) >= 0) { el = h('textarea', { name: f.key }); el.value = v || ''; }
      else el = h('input', { name: f.key, type: f.type === 'date' && (!v || L.parseDate(v)) ? 'date' : 'text', inputmode: f.type === 'number' ? 'decimal' : null, value: v == null ? '' : String(v) });
      inputs[f.key] = el;
      var hint = null;
      if (r && L.DICT_FIELDS.indexOf(f.key) >= 0 && r[f.key]) {
        var c = L.canonRows(db.dict, db.rows).filter(function (x) { return x.id === r.id; })[0];
        if (c && c[f.key] !== r[f.key]) hint = '표기 정리 후: ' + c[f.key];
      }
      var fl = field(f.label + (f.required ? ' (필수)' : ''), el, hint);
      if (long.indexOf(f.key) >= 0) fl.classList.add('span-all');
      form.appendChild(fl);
    });
    var msgs = r ? L.validateRows([r]) : [];
    function collect() {
      var src = {};
      Object.keys(inputs).forEach(function (k) { src[k] = inputs[k].value; });
      return L.normalizeRow(src);
    }
    openDialog(isNew ? '품질 이력 건 추가' : '품질 이력 고치기', [
      msgs.length ? h('div', { class: 'alert error' }, h('ul', { class: 'miss-list' }, msgs.map(function (i) { return h('li', null, i.msg); }))) : null,
      r && r._src ? h('p', { class: 'note' }, '가져온 곳: ' + r._src) : null,
      form
    ], [
      isNew ? null : h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
        db.rows = db.rows.filter(function (x) { return x.id !== r.id; });
        save(); closeDialog(); toast('지웠습니다'); render();
      } }, '삭제'),
      isNew ? null : h('button', { type: 'button', class: 'btn', onclick: function () {
        var c = collect();
        searchQ = { text: [c.symptom, c.part_name].filter(Boolean).join(' '), part_no: c.part_no, defect_type: c.defect_type, excludeId: r.id };
        closeDialog(); location.hash = '#/search';
      } }, '유사 불량 찾기'),
      h('button', { type: 'button', class: 'btn', onclick: closeDialog }, '취소'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        var nr = collect();
        if (!nr.date) { toast('발생일은 꼭 적어야 합니다', true); return; }
        if (isNew) addRows([nr]);
        else {
          nr.id = r.id; if (r._src) nr._src = r._src;
          db.rows = db.rows.map(function (x) { return x.id === r.id ? nr : x; });
        }
        save(); closeDialog(); toast(isNew ? '추가했습니다' : '고쳤습니다');
        if (preset && route() !== 'list') location.hash = '#/list'; else render();
      } }, '저장')
    ]);
  }

  // ── 불러오기 ──────────────────────────────────────────────
  function decodeCsv(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
    catch (e) {
      try { return new TextDecoder('euc-kr').decode(buf); } catch (e2) { return new TextDecoder('utf-8').decode(buf); }
    }
  }
  function readFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    var out = [], left = files.length;
    files.forEach(function (file, fi) {
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var isCsv = /\.csv$/i.test(file.name);
          var wb = isCsv ? XLSX.read(decodeCsv(new Uint8Array(rd.result)), { type: 'string', raw: true })
            : XLSX.read(new Uint8Array(rd.result), { type: 'array' });
          out[fi] = { name: file.name, sheets: wb.SheetNames.map(function (n) {
            var aoa = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' });
            var hr = L.detectHeaderRow(aoa);
            return { name: isCsv ? '' : n, aoa: aoa, headerRow: hr, include: aoa.length > hr + 1 && !/안내|설명|guide|표기 정리 적용|표기 사전/i.test(n) };
          }) };
        } catch (e) {
          out[fi] = { name: file.name, error: '읽지 못했습니다(' + e.message + ')', sheets: [] };
        }
        if (--left === 0) startImport(out);
      };
      rd.onerror = function () { out[fi] = { name: file.name, error: '파일을 열지 못했습니다', sheets: [] }; if (--left === 0) startImport(out); };
      rd.readAsArrayBuffer(file);
    });
  }
  function importHeaders() {
    var seen = {}, list = [];
    imp.files.forEach(function (f) {
      f.sheets.forEach(function (s) {
        if (!s.include) return;
        L.headersOf(s.aoa, s.headerRow).forEach(function (hd) { if (hd && !seen[hd]) { seen[hd] = true; list.push(hd); } });
      });
    });
    return list;
  }
  function startImport(files) {
    imp = { files: files, mapping: {}, mode: db.rows.length && !db._sample ? 'append' : 'replace' };
    imp.mapping = L.autoMap(importHeaders(), db.mapping);
    if (location.hash === '#/import') render(); else location.hash = '#/import';
  }
  function convertImport() {
    var rows = [], skipped = 0;
    imp.files.forEach(function (f) {
      f.sheets.forEach(function (s) {
        if (!s.include) return;
        var res = L.applyMapping(s.aoa, { mapping: imp.mapping, headerRow: s.headerRow, sheetName: s.name, fileName: f.name });
        rows = rows.concat(res.rows); skipped += res.skipped;
      });
    });
    return { rows: rows, skipped: skipped };
  }
  function renderImport(main) {
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '불러오기 — 열 맞추기'),
      h('div', { class: 'btn-row' }, h('a', { class: 'btn', href: '#/list', onclick: function () { imp = null; } }, '취소'))));

    var sheetCard = h('section', { class: 'card' }, h('h2', null, '1. 가져올 시트'),
      h('p', { class: 'note' }, '머리행(열 이름이 적힌 줄)을 자동으로 찾았습니다. 다르면 줄 번호를 고치세요. 안내·요약 시트는 빼 주세요.'));
    var ul = h('ul', { class: 'sheet-list' });
    function remap() { imp.mapping = L.autoMap(importHeaders(), Object.assign({}, db.mapping, imp.mapping)); }
    imp.files.forEach(function (f) {
      if (f.error) { ul.appendChild(h('li', { class: 'alert error' }, f.name + ' — ' + f.error)); return; }
      f.sheets.forEach(function (s) {
        var cb = h('input', { type: 'checkbox', checked: s.include, onchange: function () { s.include = cb.checked; remap(); render(); } });
        var hr = h('input', { type: 'number', min: '1', max: String(Math.max(1, s.aoa.length)), value: String(s.headerRow + 1), 'aria-label': '머리행 줄 번호',
          onchange: function () { var n = parseInt(hr.value, 10); if (n >= 1 && n <= s.aoa.length) { s.headerRow = n - 1; remap(); } render(); } });
        ul.appendChild(h('li', { class: 'sheet-item' },
          h('label', { class: 'check' }, cb, h('span', null, h('strong', null, f.name + (s.name ? ' / ' + s.name : '')), ' · 데이터 ' + Math.max(0, s.aoa.length - s.headerRow - 1) + '줄')),
          h('span', { class: 'hr' }, '머리행', hr, '번째 줄')));
      });
    });
    sheetCard.appendChild(ul);
    main.appendChild(sheetCard);

    var headers = importHeaders();
    var mapCard = h('section', { class: 'card' }, h('h2', null, '2. 열 맞추기'),
      h('p', { class: 'note' }, '표준 항목마다 내 파일의 어느 열인지 고릅니다. 없는 항목은 「(없음)」으로 두면 됩니다. 불러오면 이 연결을 저장해 다음에 같은 열 이름을 자동으로 연결합니다.'));
    var grid = h('div', { class: 'map-grid' });
    L.STD_FIELDS.forEach(function (f) {
      var s = select('map_' + f.key, [['', '(없음)']].concat(headers), imp.mapping[f.key] || '');
      s.addEventListener('change', function () { if (s.value) imp.mapping[f.key] = s.value; else delete imp.mapping[f.key]; render(); });
      var hint = f.key === 'cause_cat' ? '원인을 분류 코드로 따로 적는 열이 있을 때만' : null;
      grid.appendChild(field(f.label + (f.required ? ' (필수)' : ''), s, hint));
    });
    mapCard.appendChild(grid);
    main.appendChild(mapCard);

    var conv = convertImport();
    var issues = L.validateRows(conv.rows.map(function (r, i) { return Object.assign({ id: 'p' + i }, r); }));
    var sum = L.issueSummary(issues);
    var prev = h('section', { class: 'card' }, h('h2', null, '3. 미리보기와 확정'));
    if (!imp.mapping.date) prev.appendChild(h('div', { class: 'alert error' }, '「발생일」 열을 연결해야 합니다.'));
    prev.appendChild(h('p', null, '표준 형식으로 바꾼 행 ' + conv.rows.length + '개' + (conv.skipped ? ' (빈 줄 ' + conv.skipped + '개 건너뜀)' : '') + ' · ',
      h('span', { class: 'badge error' }, '오류 ' + sum.error), ' ', h('span', { class: 'badge warn' }, '확인 ' + sum.warn),
      ' — 불러온 뒤 「품질 이력」에서 고칠 수 있습니다.'));
    var cols = ['mgmt_no', 'date', 'part_no', 'defect_type', 'symptom', 'cause', 'action', 'qty'];
    var tb = h('tbody');
    conv.rows.slice(0, 5).forEach(function (r) {
      tb.appendChild(h('tr', null, cols.map(function (k) {
        var v = r[k];
        if (v == null && r._raw && r._raw[k] != null) v = r._raw[k] + ' (못 읽음)';
        return h('td', { class: typeof v === 'number' ? 'num' : (k === 'symptom' || k === 'cause' || k === 'action' ? 'clip' : '') }, v == null ? '' : typeof v === 'number' ? fmt(v) : h('span', { class: 'clip-text' }, String(v)));
      })));
    });
    prev.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
      h('thead', null, h('tr', null, cols.map(function (k) { return h('th', null, L.FIELD[k].label); }))), tb)));
    var mode = select('mode', [['append', '지금 이력 뒤에 추가'], ['replace', '지금 이력을 지우고 바꾸기']], imp.mode);
    mode.addEventListener('change', function () { imp.mode = mode.value; });
    prev.appendChild(h('div', { class: 'form-grid', style: 'margin-top:16px' },
      field('불러오는 방식', mode, db.rows.length ? '지금 ' + db.rows.length + '건' + (db._sample ? '(예시 데이터 — 불러오면 지워집니다)' : '') + '이 있습니다' : null)));
    prev.appendChild(h('div', { class: 'btn-row', style: 'margin-top:16px' },
      h('button', { type: 'button', class: 'btn btn-primary', disabled: !imp.mapping.date || !conv.rows.length, onclick: function () {
        var c = convertImport();
        var wasSample = db._sample;
        db.mapping = Object.assign({}, imp.mapping);
        db.headers = importHeaders(); // 열 이름만 기억합니다(「다음 단계」 요약 글용). 값은 넣지 않습니다.
        if (wasSample) db.dict = L.emptyDb().dict;
        addRows(c.rows, imp.mode === 'replace' || wasSample);
        save();
        var s2 = L.issueSummary(L.validateRows(db.rows));
        imp = null;
        location.hash = '#/list';
        toast(c.rows.length + '건을 불러왔습니다. 검사 오류 ' + s2.error + '건 · 확인 ' + s2.warn + '건');
      } }, conv.rows.length + '건 불러오기')));
    main.appendChild(prev);
  }
  // ── 표기 정리 ─────────────────────────────────────────────
  function renderDict(main) {
    if (!db.rows.length) { emptyNotice(main, '표기 정리'); return; }
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '표기 정리')));
    var fields = [['defect_type', '불량유형'], ['cause_cat', '원인 분류'], ['cause', '발생원인']];
    var card = h('section', { class: 'card' },
      h('p', null, '같은 불량유형·원인이 다르게 적힌 것을 대표 이름 하나로 묶습니다. 띄어쓰기·대소문자·기호만 다른 표기는 이미 한 줄로 묶여 있고, 가장 많이 쓴 표기가 대표 이름이 됩니다.'),
      h('p', { class: 'note' }, '「스크레치」와 「스크래치」처럼 낱말이 다른 경우에는 대표 이름 칸에 같은 이름을 적으면 하나로 묶입니다. 원래 이력은 바꾸지 않고, 화면·집계·탐지·검색에서만 대표 이름으로 봅니다.'),
      h('div', { class: 'axis-tabs', role: 'group', 'aria-label': '정리할 항목' }, fields.map(function (f) {
        return h('button', { type: 'button', 'aria-pressed': dictField === f[0] ? 'true' : 'false', onclick: function () { dictField = f[0]; render(); } }, f[1]);
      })));
    var list = L.distinctValues(db.rows, dictField, db.dict);
    var names = L.valuesOf(cdata(), dictField);
    if (!list.length) card.appendChild(h('p', { class: 'note' }, '이 항목에 적힌 값이 없습니다.'));
    else {
      card.appendChild(h('p', null, '적힌 표기 ' + list.length + '가지 → 대표 이름 ' + names.length + '개'));
      var dl = datalist('dictNames', names);
      card.appendChild(dl);
      var box = h('div');
      list.forEach(function (e) {
        var auto = e.spellings[0];
        var inp = h('input', { type: 'text', value: e.canonical, list: 'dictNames', 'aria-label': e.spellings[0] + '의 대표 이름' });
        inp.addEventListener('change', function () {
          var v = inp.value.trim();
          if (!v || v === auto) delete db.dict[dictField][e.key];
          else db.dict[dictField][e.key] = v;
          save(); toast('대표 이름을 저장했습니다'); render();
        });
        box.appendChild(h('div', { class: 'dict-row' },
          h('div', { class: 'spell' }, e.spellings.map(function (s, i) { return [i ? ' / ' : '', h('strong', null, s)]; }), ' ', h('span', { class: 'note' }, e.count + '건'),
            e.mapped ? [' ', h('span', { class: 'badge ok' }, '사전')] : null),
          inp,
          e.mapped ? h('button', { type: 'button', class: 'btn', onclick: function () { delete db.dict[dictField][e.key]; save(); render(); } }, '되돌리기') : h('span')));
      });
      card.appendChild(box);
    }
    var n = 0;
    L.DICT_FIELDS.forEach(function (f) { n += Object.keys(db.dict[f] || {}).length; });
    card.appendChild(h('div', { class: 'btn-row', style: 'margin-top:16px' },
      h('button', { type: 'button', class: 'btn', onclick: exportAll }, 'Excel 내보내기(사전 포함)'),
      n ? h('button', { type: 'button', class: 'btn btn-danger', onclick: function () {
        openDialog('표기 사전 비우기', h('p', null, '직접 정한 대표 이름 ' + n + '개를 모두 지웁니다.'), [
          h('button', { type: 'button', class: 'btn', onclick: closeDialog }, '취소'),
          h('button', { type: 'button', class: 'btn btn-danger', onclick: function () { db.dict = L.emptyDb().dict; save(); closeDialog(); render(); } }, '비우기')]);
      } }, '사전 비우기') : null));
    main.appendChild(card);
  }

  // ── 유사 불량 검색 ────────────────────────────────────────
  function highlight(textVal, tokens) {
    var s = String(textVal || '');
    if (!s || !tokens.length) return s;
    var low = s.toLowerCase(), out = [], i = 0;
    while (i < s.length) {
      var best = -1, bl = 0;
      tokens.forEach(function (t) {
        var p = low.indexOf(t, i);
        if (p >= 0 && (best < 0 || p < best || (p === best && t.length > bl))) { best = p; bl = t.length; }
      });
      if (best < 0) { out.push(s.slice(i)); break; }
      if (best > i) out.push(s.slice(i, best));
      out.push(h('mark', null, s.slice(best, best + bl)));
      i = best + bl;
    }
    return out;
  }
  function resultItem(res, tokens, extra) {
    var r = res.row;
    var dl = h('dl');
    [['불량유형', r.defect_type], ['불량현상', r.symptom], ['원인', [r.cause_cat, r.cause].filter(Boolean).join(' — ')], ['개선대책', r.action], ['재발방지대책', r.prevention], ['공정·고객사', [r.process, r.customer].filter(Boolean).join(' · ')], ['불량수량', r.qty == null ? '' : fmt(r.qty)]]
      .forEach(function (p) { if (p[1]) { dl.appendChild(h('dt', null, p[0])); dl.appendChild(h('dd', null, highlight(p[1], tokens))); } });
    return h('li', { class: 'result' },
      h('div', { class: 'result-head' }, h('span', { class: 'title' }, rowTitle(r)),
        h('span', { class: 'badge ok score' }, '점수 ' + res.score),
        res.samePart ? h('span', { class: 'badge warn' }, '같은 품번') : null,
        res.sameType ? h('span', { class: 'badge warn' }, '같은 유형') : null),
      res.matched.length ? h('p', { class: 'note' }, '겹친 낱말: ' + res.matched.join(', ')) : null,
      dl, extra || null);
  }
  function renderSearch(main) {
    if (!db.rows.length) { emptyNotice(main, '유사 불량 검색'); return; }
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '유사 불량 검색')));
    var all = cdata();
    var card = h('section', { class: 'card' },
      h('p', { class: 'note' }, '새 불량의 현상·품번·유형을 넣으면 과거 이력에서 겹치는 낱말이 많은 순으로 보여 주고, 당시 원인·대책을 함께 표시합니다.'));
    var fText = h('textarea', { name: 'text', placeholder: '예: 도장면에 기포 발생, 모서리 찍힘' }); fText.value = searchQ.text || '';
    var fPart = h('input', { type: 'text', name: 'part_no', list: 'partList', value: searchQ.part_no || '' });
    var fType = h('input', { type: 'text', name: 'defect_type', list: 'typeList', value: searchQ.defect_type || '' });
    var st = db.search;
    var fPB = h('input', { type: 'number', min: '0', step: '1', value: String(st.partBonus) });
    var fTB = h('input', { type: 'number', min: '0', step: '1', value: String(st.typeBonus) });
    var fLim = h('input', { type: 'number', min: '1', step: '1', value: String(st.limit) });
    card.appendChild(datalist('partList', L.valuesOf(all, 'part_no')));
    card.appendChild(datalist('typeList', L.valuesOf(all, 'defect_type')));
    var fl = field('불량현상·낱말', fText); fl.classList.add('span-all');
    card.appendChild(h('div', { class: 'form-grid' }, fl, field('품번', fPart), field('불량유형', fType)));
    var det = h('details', { style: 'margin-top:12px' }, h('summary', null, '점수 기준 설정'),
      h('p', { class: 'note' }, '점수 = 겹친 낱말 수 + 같은 품번 가산점 + 같은 불량유형 가산점. 품질팀 판단에 맞게 바꾸세요.'),
      h('div', { class: 'filters' }, field('같은 품번 가산점', fPB), field('같은 불량유형 가산점', fTB), field('보여 줄 개수', fLim)));
    card.appendChild(det);
    function run() {
      searchQ = { text: fText.value, part_no: fPart.value.trim(), defect_type: fType.value.trim(), excludeId: searchQ.excludeId };
      var pb = parseInt(fPB.value, 10), tb = parseInt(fTB.value, 10), lim = parseInt(fLim.value, 10);
      db.search = { partBonus: pb >= 0 ? pb : st.partBonus, typeBonus: tb >= 0 ? tb : st.typeBonus, limit: lim >= 1 ? lim : st.limit };
      save(); render();
    }
    card.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: run }, '찾기'),
      h('button', { type: 'button', class: 'btn', onclick: function () { searchQ = { text: '', part_no: '', defect_type: '' }; render(); } }, '비우기')));
    main.appendChild(card);

    var has = (searchQ.text || '').trim() || searchQ.part_no || searchQ.defect_type;
    if (!has) return;
    var q = { text: searchQ.text, part_no: searchQ.part_no, defect_type: L.canon(db.dict, 'defect_type', searchQ.defect_type), excludeId: searchQ.excludeId };
    var res = L.searchSimilar(all, q, db.search);
    var tokens = L.tokenize(searchQ.text);
    var out = h('section', { class: 'card' }, h('h2', null, '찾은 과거 이력 ' + res.length + '건'));
    if (!res.length) out.appendChild(h('p', null, '겹치는 낱말·품번·유형이 있는 이력이 없습니다. 낱말을 줄이거나 다른 말로 넣어 보세요.'));
    else {
      out.appendChild(h('div', { class: 'btn-row', style: 'margin-bottom:12px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          db.draft = { input: { date: today(), part_no: searchQ.part_no, defect_type: searchQ.defect_type, memo: searchQ.text }, picked: null, answer: '', parsed: null };
          save(); location.hash = '#/draft';
        } }, '이 내용으로 대책서 초안 만들기')));
      out.appendChild(h('ul', { class: 'results' }, res.map(function (x) { return resultItem(x, tokens); })));
    }
    main.appendChild(out);
  }

  // ── 반복·다발 ─────────────────────────────────────────────
  function currentRepeats(rows) {
    try { return { list: L.detectRepeats(rows, db.rule) }; } catch (e) { return { error: e.message, list: [] }; }
  }
  function renderRepeat(main) {
    if (!db.rows.length) { emptyNotice(main, '반복·다발 불량'); return; }
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '반복·다발 불량')));
    var rule = db.rule;
    var card = h('section', { class: 'card' }, h('h2', null, '탐지 기준'),
      h('p', { class: 'note' }, '「같은 묶음이 N일 안에 M건 이상」이면 반복·다발로 표시합니다. 기준값은 품질팀 기준(기획서 10장 6번)을 받으면 그에 맞게 바꾸세요. 지금 값은 시작값일 뿐입니다.'));
    var gb = select('groupBy', Object.keys(L.GROUP_BY).map(function (k) { return [k, L.GROUP_BY[k].label]; }), rule.groupBy);
    var fd = h('input', { type: 'number', min: '1', step: '1', value: String(rule.days) });
    var fm = h('input', { type: 'number', min: '2', step: '1', value: String(rule.min) });
    var ff = h('input', { type: 'date', value: repView.from });
    var ft = h('input', { type: 'date', value: repView.to });
    function apply() {
      db.rule = { groupBy: gb.value, days: parseInt(fd.value, 10), min: parseInt(fm.value, 10) };
      repView.from = ff.value; repView.to = ft.value;
      save(); render();
    }
    [gb, fd, fm, ff, ft].forEach(function (el) { el.addEventListener('change', apply); });
    card.appendChild(h('div', { class: 'filters' }, field('묶음 기준', gb), field('기간 N(일)', fd), field('건수 M(건 이상)', fm),
      field('조회 시작일', ff, '비우면 전체'), field('조회 종료일', ft)));
    main.appendChild(card);

    var rows = L.filterRows(cdata(), { from: repView.from, to: repView.to });
    var r = currentRepeats(rows);
    var out = h('section', { class: 'card' });
    if (r.error) { out.appendChild(h('div', { class: 'alert error' }, r.error)); main.appendChild(out); return; }
    out.appendChild(h('h2', null, '탐지 결과 ' + r.list.length + '건'));
    out.appendChild(h('p', { class: 'note' }, L.GROUP_BY[rule.groupBy].label + ' 기준, ' + rule.days + '일 안에 ' + rule.min + '건 이상. 기간이 이어지는 건은 한 구간으로 묶었습니다. 최근 구간이 위에 옵니다.'));
    if (!r.list.length) out.appendChild(h('p', null, '이 기준에 걸리는 반복·다발 불량이 없습니다.'));
    else {
      out.appendChild(h('div', { class: 'btn-row', style: 'margin-bottom:12px' },
        h('button', { type: 'button', class: 'btn', onclick: function () { writeXlsx('반복다발불량' + tag() + '_' + today() + '.xlsx', { '반복·다발': L.repeatsSheet(r.list) }); } }, 'Excel 내보내기')));
      var tb = h('tbody');
      r.list.forEach(function (e, i) {
        var key = e.label + '|' + e.first;
        var open = !!repView.open[key];
        tb.appendChild(h('tr', null,
          h('td', null, h('strong', null, e.label)),
          h('td', { class: 'num' }, e.first + ' ~ ' + e.last),
          h('td', { class: 'num' }, e.span + '일'),
          h('td', { class: 'num' }, e.count + '건'),
          h('td', { class: 'num' }, fmt(e.qty)),
          h('td', null, h('button', { type: 'button', class: 'btn', 'aria-expanded': open ? 'true' : 'false', onclick: function () { repView.open[key] = !open; render(); } }, open ? '접기' : '건 보기'))));
        if (open) {
          tb.appendChild(h('tr', null, h('td', { colspan: '6' }, h('ul', { class: 'miss-list' }, e.rows.map(function (x) {
            return h('li', null, h('a', { href: '#', onclick: function (ev) { ev.preventDefault(); editRow(db.rows.filter(function (y) { return y.id === x.id; })[0]); } }, rowTitle(x)),
              ' — ' + [x.symptom, x.cause_cat || x.cause].filter(Boolean).join(' / '));
          })))));
        }
      });
      out.appendChild(h('div', { class: 'table-wrap' }, h('table', { class: 'list' },
        h('thead', null, h('tr', null, ['묶음', '기간', '일수', '건수', '불량수량', ''].map(function (t) { return h('th', null, t); }))), tb)));
    }
    out.appendChild(h('p', { class: 'note' }, '담당자에게 메일·메신저로 알리는 기능은 2단계(Make 자동화)에서 다룹니다. 지금은 이 화면과 Excel로 확인합니다.'));
    main.appendChild(out);
  }

  // ── 월간 현황 ─────────────────────────────────────────────
  function barChart(data, measure) {
    // 화면 폭에 맞춰 그려 좁은 화면에서도 글자가 11px 로 보이게 합니다
    var mainW = document.getElementById('main').clientWidth || 720;
    var W = Math.max(260, Math.min(960, mainW - 80)), H = 240, padL = 8, padR = 8, padT = 22, padB = 30;
    var n = Math.max(1, data.length);
    var max = Math.max.apply(null, data.map(function (d) { return d[measure]; }).concat([1]));
    var slot = (W - padL - padR) / n, bw = Math.max(4, Math.min(48, slot * 0.6));
    var ns = 'http://www.w3.org/2000/svg';
    function s(tagName, attrs, txt) {
      var el = document.createElementNS(ns, tagName);
      Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
      if (txt != null) el.textContent = txt;
      return el;
    }
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': '월별 ' + (measure === 'count' ? '불량 건수' : '불량수량') + ' 막대 차트' });
    svg.appendChild(s('line', { x1: padL, x2: W - padR, y1: H - padB, y2: H - padB, class: 'axis' }));
    var every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(W / 48))));
    data.forEach(function (d, i) {
      var v = d[measure];
      var bh = (H - padT - padB) * v / max;
      var x = padL + slot * i + (slot - bw) / 2;
      svg.appendChild(s('rect', { x: x.toFixed(1), y: (H - padB - bh).toFixed(1), width: bw.toFixed(1), height: Math.max(0, bh).toFixed(1), class: measure === 'count' ? 'bar' : 'bar-q', rx: 2 }));
      if (v) svg.appendChild(s('text', { x: (x + bw / 2).toFixed(1), y: (H - padB - bh - 5).toFixed(1), 'text-anchor': 'middle', class: 'val' }, fmt(v)));
      if (i % every === 0) svg.appendChild(s('text', { x: (x + bw / 2).toFixed(1), y: H - padB + 16, 'text-anchor': 'middle' }, d.month.slice(2).replace('-', '.')));
    });
    return svg;
  }
  function topTable(title, list) {
    var tb = h('tbody');
    if (!list.length) tb.appendChild(h('tr', null, h('td', { colspan: '3' }, '없음')));
    list.forEach(function (e) { tb.appendChild(h('tr', null, h('td', null, e.key), h('td', { class: 'num' }, fmt(e.count)), h('td', { class: 'num' }, fmt(e.qty)))); });
    return h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('thead', null, h('tr', null, h('th', null, title), h('th', null, '건수'), h('th', null, '불량수량'))), tb));
  }
  function renderMonthly(main) {
    if (!db.rows.length) { emptyNotice(main, '월간 현황'); return; }
    var all = cdata().filter(function (r) { return r.date; });
    var months = L.valuesOf(all, function (r) { return L.monthOf(r.date); });
    if (!months.length) { emptyNotice(main, '월간 현황'); return; }
    var last = months[months.length - 1];
    if (!monthView.to || months.indexOf(monthView.to) < 0) monthView.to = last;
    if (!monthView.from || months.indexOf(monthView.from) < 0) {
      var y = +last.slice(0, 4), m = +last.slice(5, 7) - 11;
      while (m < 1) { m += 12; y--; }
      var start = y + '-' + (m < 10 ? '0' : '') + m;
      monthView.from = months.filter(function (x) { return x >= start; })[0] || months[0];
    }
    if (!monthView.month || months.indexOf(monthView.month) < 0) monthView.month = last;

    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '월간 품질불량 현황'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', onclick: function () { window.print(); } }, '인쇄'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          writeXlsx('월간품질불량현황' + tag() + '_' + monthView.month + '.xlsx', L.monthlySheets(totals, rep));
        } }, 'Excel 내보내기'))));
    main.appendChild(h('p', { class: 'print-only' }, '월간 품질불량 현황 · ' + monthView.month + (db._sample ? ' · 예시 데이터' : '') + ' · 출력일 ' + today()));

    var ctl = h('section', { class: 'card no-print' });
    var fFrom = select('from', months, monthView.from), fTo = select('to', months, monthView.to), fMonth = select('month', months.slice().reverse(), monthView.month);
    var fMeasure = select('measure', [['count', '건수'], ['qty', '불량수량']], monthView.measure);
    [[fFrom, 'from'], [fTo, 'to'], [fMonth, 'month'], [fMeasure, 'measure']].forEach(function (p) { p[0].addEventListener('change', function () { monthView[p[1]] = p[0].value; render(); }); });
    ctl.appendChild(h('div', { class: 'filters' }, field('추이 시작 월', fFrom), field('추이 끝 월', fTo), field('막대 기준', fMeasure), field('보고할 달', fMonth)));
    main.appendChild(ctl);

    var totals = L.monthlyTotals(all, monthView.from <= monthView.to ? monthView.from : monthView.to, monthView.from <= monthView.to ? monthView.to : monthView.from);
    var chartCard = h('section', { class: 'card' }, h('h2', null, '월별 추이'), barChart(totals, monthView.measure),
      h('div', { class: 'legend' }, h('span', null, h('i', { style: 'background:' + (monthView.measure === 'count' ? 'var(--bar)' : '#9db8d8') }), monthView.measure === 'count' ? '불량 건수' : '불량수량')));
    var tb = h('tbody');
    totals.forEach(function (t) { tb.appendChild(h('tr', null, h('td', { class: 'num' }, t.month), h('td', { class: 'num' }, fmt(t.count)), h('td', { class: 'num' }, fmt(t.qty)))); });
    chartCard.appendChild(h('details', { style: 'margin-top:12px' }, h('summary', null, '표로 보기'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'list' }, h('thead', null, h('tr', null, h('th', null, '월'), h('th', null, '건수'), h('th', null, '불량수량'))), tb))));
    main.appendChild(chartCard);

    var rep = L.monthReport(all, monthView.month);
    var prev = L.monthReport(all, L.prevMonth(monthView.month));
    function diff(a, b) { var d = a - b; return d === 0 ? '전월과 같음' : '전월 대비 ' + (d > 0 ? '+' : '') + fmt(d); }
    var mCard = h('section', { class: 'card' }, h('h2', null, monthView.month + ' 보고'),
      h('div', { class: 'kpis' },
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '불량 건수'), h('div', { class: 'v' }, fmt(rep.count), h('small', null, '건')), h('div', { class: 'note' }, diff(rep.count, prev.count))),
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '불량수량'), h('div', { class: 'v' }, fmt(rep.qty)), h('div', { class: 'note' }, diff(rep.qty, prev.qty))),
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '불량유형 수'), h('div', { class: 'v' }, fmt(L.groupCount(rep.rows, 'defect_type').length), h('small', null, '종'))),
        h('div', { class: 'kpi' }, h('div', { class: 'k' }, '관련 품번 수'), h('div', { class: 'v' }, fmt(L.valuesOf(rep.rows, 'part_no').length), h('small', null, '개')))),
      h('div', { class: 'grid-2' },
        h('div', null, h('h3', null, '불량유형별 상위 5'), topTable('불량유형', rep.byType)),
        h('div', null, h('h3', null, '품번별 상위 5'), topTable('품번', rep.byPart))),
      h('div', { class: 'grid-2', style: 'margin-top:16px' },
        h('div', null, h('h3', null, '원인별 상위 5'), topTable('원인', rep.byCause)),
        h('div', null, h('h3', null, '이 달에 걸린 반복·다발'), (function () {
          var rr = currentRepeats(all);
          var hit = rr.list.filter(function (e) { return e.rows.some(function (x) { return L.monthOf(x.date) === monthView.month; }); });
          if (!hit.length) return h('p', { class: 'note' }, rr.error || '현재 탐지 기준(' + rule() + ')으로 걸린 것이 없습니다.');
          return h('ul', { class: 'miss-list' }, hit.map(function (e) { return h('li', null, h('strong', null, e.label), ' — ' + e.first + ' ~ ' + e.last + ', ' + e.count + '건'); }));
        })())),
      h('p', { class: 'note', style: 'margin-top:12px' }, '불량률 같은 KPI는 사내 정의(분모가 되는 생산 수량 등)를 받은 뒤 2단계에서 더합니다.'));
    main.appendChild(mCard);
  }
  function rule() { return L.GROUP_BY[db.rule.groupBy].label + ', ' + db.rule.days + '일 안 ' + db.rule.min + '건 이상'; }

  // ── 대책서 초안 ───────────────────────────────────────────
  function renderDraft(main) {
    if (!db.rows.length) { emptyNotice(main, '대책서 초안'); return; }
    var d = db.draft || (db.draft = {});
    d.input = d.input || { date: today() };
    var all = cdata();
    main.appendChild(h('div', { class: 'page-head' }, h('h1', null, '대책서 초안 프롬프트')));
    main.appendChild(h('div', { class: 'steps-bar' }, h('b', null, '1. 새 불량 정보'), '→', h('b', null, '2. 붙일 과거 이력 고르기'), '→', h('b', null, '3. 프롬프트 복사'), '→', h('b', null, '4. AI 답변 붙여넣기')));
    main.appendChild(h('div', { class: 'alert info' }, '이 도구는 AI를 직접 부르지 않습니다. 만든 프롬프트를 사내에서 허용된 AI에만 붙여넣으세요. 고객사명·품번 등 민감한 내용은 규정에 따라 지우고 보내세요.'));

    // 1. 입력
    var inCard = h('section', { class: 'card' }, h('h2', null, '1. 새 불량 정보'));
    var keys = [['date', '발생일', 'date'], ['part_no', '품번'], ['part_name', '품명'], ['defect_type', '불량유형'], ['process', '공정'], ['customer', '고객사'], ['qty', '불량수량']];
    var inputs = {};
    inCard.appendChild(datalist('dPart', L.valuesOf(all, 'part_no')));
    inCard.appendChild(datalist('dType', L.valuesOf(all, 'defect_type')));
    var grid = h('div', { class: 'form-grid' });
    keys.forEach(function (k) {
      var el = h('input', { type: k[2] || 'text', value: d.input[k[0]] || '', list: k[0] === 'part_no' ? 'dPart' : k[0] === 'defect_type' ? 'dType' : null, inputmode: k[0] === 'qty' ? 'decimal' : null });
      inputs[k[0]] = el;
      el.addEventListener('change', function () { d.input[k[0]] = el.value.trim(); save(); });
      grid.appendChild(field(k[1], el));
    });
    var memo = h('textarea', { placeholder: '현장에서 본 불량 모습, 발견 경위, 수량·로트 등 아는 대로' }); memo.value = d.input.memo || '';
    inputs.memo = memo;
    memo.addEventListener('change', function () { d.input.memo = memo.value.trim(); save(); });
    var mf = field('현장 메모(불량현상·상황)', memo); mf.classList.add('span-all');
    grid.appendChild(mf);
    inCard.appendChild(grid);
    inCard.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' },
      h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        Object.keys(inputs).forEach(function (k) { d.input[k] = inputs[k].value.trim(); });
        d.picked = null; save(); render();
      } }, '과거 유사 이력 찾기'),
      h('button', { type: 'button', class: 'btn', onclick: function () { db.draft = { input: { date: today() } }; save(); render(); } }, '새로 쓰기')));
    main.appendChild(inCard);

    // 2. 과거 이력
    var inp = d.input;
    var q = { text: [inp.memo, inp.part_name].filter(Boolean).join(' '), part_no: inp.part_no, defect_type: L.canon(db.dict, 'defect_type', inp.defect_type) };
    var res = (q.text || q.part_no || q.defect_type) ? L.searchSimilar(all, q, db.search) : [];
    if (!d.picked) { d.picked = {}; res.slice(0, 5).forEach(function (x) { d.picked[x.row.id] = true; }); }
    var pCard = h('section', { class: 'card' }, h('h2', null, '2. 붙일 과거 이력'),
      h('p', { class: 'note' }, '유사 불량 검색 점수가 높은 순입니다(최대 ' + db.search.limit + '건). 처음에는 위 5건을 골라 둡니다. 관계없는 건은 빼세요.'));
    if (!res.length) pCard.appendChild(h('p', null, '찾은 이력이 없습니다. 품번·불량유형·현장 메모를 적고 「과거 유사 이력 찾기」를 누르세요. 이력 없이도 프롬프트는 만들 수 있습니다.'));
    else {
      pCard.appendChild(h('ul', { class: 'pick-list' }, res.map(function (x) {
        var cb = h('input', { type: 'checkbox', checked: !!d.picked[x.row.id], onchange: function () { if (cb.checked) d.picked[x.row.id] = true; else delete d.picked[x.row.id]; save(); render(); } });
        return h('li', null, h('label', null, cb, h('span', null, h('strong', null, rowTitle(x.row)), ' · ' + (x.row.defect_type || '') + ' · 점수 ' + x.score,
          h('br'), h('span', { class: 'note' }, [x.row.symptom, x.row.cause].filter(Boolean).join(' / ')))));
      })));
    }
    main.appendChild(pCard);

    // 3. 프롬프트
    var picked = res.filter(function (x) { return d.picked[x.row.id]; }).map(function (x) { return x.row; });
    var prompt = L.buildPrompt(inp, picked);
    var ta = h('textarea', { class: 'prompt-box', readonly: true, 'aria-label': '생성된 프롬프트' }); ta.value = prompt;
    main.appendChild(h('section', { class: 'card' }, h('h2', null, '3. 프롬프트 (과거 이력 ' + picked.length + '건 첨부)'), ta,
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () { copyText(prompt); } }, '프롬프트 복사'),
        h('button', { type: 'button', class: 'btn', onclick: function () { download('대책서초안_프롬프트_' + today() + '.txt', new Blob([prompt], { type: 'text/plain;charset=utf-8' })); } }, '텍스트 파일로 받기'))));

    // 4. 답변
    var ans = h('textarea', { class: 'prompt-box', style: 'min-height:180px', placeholder: 'AI 답변을 여기에 붙여넣으세요. 【불량현상】【발생원인】【개선대책】【재발방지대책】 제목으로 칸을 나눕니다.' });
    ans.value = d.answer || '';
    var aCard = h('section', { class: 'card' }, h('h2', null, '4. AI 답변 붙여넣기'), ans,
      h('div', { class: 'btn-row', style: 'margin-top:12px' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
        d.answer = ans.value;
        var p = L.parseDraft(ans.value);
        d.parsed = p.found ? p.fields : null;
        save();
        if (!p.found) toast('답변에서 【불량현상】 같은 제목을 찾지 못했습니다. 답변 형식을 확인하세요', true);
        render();
      } }, '칸 나누기')));
    if (d.parsed) {
      var fields = {};
      var g2 = h('div', { class: 'form-grid' });
      L.DRAFT_SECTIONS.forEach(function (s) {
        var t = h('textarea', { name: s.key, style: 'min-height:110px' }); t.value = d.parsed[s.key] || '';
        t.addEventListener('change', function () { d.parsed[s.key] = t.value; save(); });
        fields[s.key] = t;
        var f = field(s.label + (d.parsed[s.key] ? '' : ' (답변에 없음)'), t); f.classList.add('span-all');
        g2.appendChild(f);
      });
      aCard.appendChild(h('h3', { style: 'margin-top:16px' }, '나눈 결과 — 검토하고 고치세요'));
      aCard.appendChild(g2);
      function draftText() {
        var t = '품질 개선대책서 초안 (AI 초안 — 검토 전)\n\n';
        [['발생일', inp.date], ['품번', inp.part_no], ['품명', inp.part_name], ['불량유형', inp.defect_type], ['공정', inp.process], ['고객사', inp.customer], ['불량수량', inp.qty]]
          .forEach(function (p) { if (p[1]) t += p[0] + ': ' + p[1] + '\n'; });
        L.DRAFT_SECTIONS.forEach(function (s) { t += '\n【' + s.label + '】\n' + (fields[s.key].value || '') + '\n'; });
        return t;
      }
      aCard.appendChild(h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: function () {
          var preset = { date: inp.date, part_no: inp.part_no, part_name: inp.part_name, defect_type: inp.defect_type, process: inp.process, customer: inp.customer, qty: inp.qty };
          L.DRAFT_SECTIONS.forEach(function (s) { preset[s.key] = fields[s.key].value; });
          editRow(null, preset);
        } }, '품질 이력에 새 건으로 등록'),
        h('button', { type: 'button', class: 'btn', onclick: function () { copyText(draftText()); } }, '초안 복사'),
        h('button', { type: 'button', class: 'btn', onclick: function () { download('대책서초안_' + (inp.part_no || '품번없음') + '_' + today() + '.txt', new Blob([draftText()], { type: 'text/plain;charset=utf-8' })); } }, '텍스트 파일로 받기')));
      aCard.appendChild(h('p', { class: 'note' }, 'AI 초안에는 틀린 내용이 섞일 수 있습니다. 「확인 필요」「추정」으로 표시된 곳은 현장에서 확인한 뒤 등록하세요.'));
    }
    main.appendChild(aCard);
  }

  render();
})();
