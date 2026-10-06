/* 進学知識ドリル — 静的SPA（ビルド不要）
 * データ: data/cards.json / mocks.json / reading.json / hayami.json（vault の原稿から build_data.py で生成）
 * 進捗: localStorage（使えない環境ではメモリのみ）
 */
(function () {
  'use strict';

  var EXAM = { y: 2026, m: 10, d: 11, label: '10月11日（日）' };
  var KEY = 'sdrill2026:v1';
  var HOUR = 3600 * 1000;
  // Leitner の箱ごとの次回出題までの間隔（本番まで5日に圧縮）
  var INTERVAL = [0, 6 * HOUR, 20 * HOUR, 44 * HOUR, 96 * HOUR];
  var KANA = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク', 'ケ', 'コ', 'サ', 'シ', 'ス', 'セ', 'ソ'];

  var D = { cards: [], byId: {}, mocks: [], reading: [], hayami: [] };
  var S = loadState();
  var session = null;
  var mockRun = null;
  var timerId = null;
  var app = document.getElementById('app');

  /* ---------------- storage ---------------- */
  function defaultState() {
    return { cards: {}, read: {}, mocks: {}, settings: { n: 20, recall: true, theme: 'auto' }, filter: { area: 'all', onlyA: true } };
  }
  function loadState() {
    var s = null;
    try { s = JSON.parse(window.localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    var d = defaultState();
    if (!s || typeof s !== 'object') return d;
    s.cards = s.cards || {}; s.read = s.read || {}; s.mocks = s.mocks || {};
    s.settings = Object.assign(d.settings, s.settings || {});
    s.filter = Object.assign(d.filter, s.filter || {});
    return s;
  }
  function save() {
    try { window.localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode 等 */ }
  }
  function cs(id) {
    if (!S.cards[id]) S.cards[id] = { box: 0, due: 0, ok: 0, ng: 0, last: 0, lastNg: 0 };
    return S.cards[id];
  }
  function applyTheme() {
    var t = S.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  /* ---------------- utils ---------------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function now() { return Date.now(); }
  function jstParts(t) {
    var d = new Date(t + 9 * HOUR);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  function daysLeft() {
    var p = jstParts(now());
    var a = Date.UTC(p.y, p.m - 1, p.d), b = Date.UTC(EXAM.y, EXAM.m - 1, EXAM.d);
    return Math.round((b - a) / (24 * HOUR));
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // 表記ゆれの吸収: 旧字体・附属/付属・大学/大・ヶ/ケ など
  var VARIANT = { '應': '応', '澤': '沢', '國': '国', '學': '学', '齋': '斎', '齊': '斉', '髙': '高', '﨑': '崎', '邊': '辺', '邉': '辺', '藏': '蔵', '濱': '浜', '櫻': '桜', '附': '付', 'ヶ': 'ケ', 'ヵ': 'カ', 'ゞ': '', '々': '々' };
  function normText(s) {
    var t = String(s || '').normalize('NFKC').toLowerCase()
      .replace(/[\s　・･,，、。.「」『』()（）]/g, '')
      .replace(/[應澤國學齋齊髙﨑邊邉藏濱櫻附ヶヵ]/g, function (c) { return VARIANT[c]; })
      .replace(/大学/g, '大');
    // 末尾の「中学校」「高等学校」「学園」などは重なっていても全部外す（例: 洗足学園中学校 → 洗足）
    var prev;
    do { prev = t; t = t.replace(/(中等教育学校|高等学校|高等部|中学校|中等部|高校|中学|学校|学園|学院)$/, ''); } while (t !== prev && t.length > 1);
    return t || prev;
  }
  function parseNum(s) {
    var t = String(s || '').normalize('NFKC').replace(/[,，\s]/g, '').replace(/[^0-9.\-]/g, '');
    if (t === '' || t === '-' || t === '.') return NaN;
    return parseFloat(t);
  }
  var ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2z"/><path d="M22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 10l2 2 4-4"/><path d="M8 16h8"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
    ng: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10"/><path d="M17 7L7 17"/></svg>',
    again: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>'
  };

  /* ---------------- questions ---------------- */

  function answerText(q) {
    if (q.t === 'num') return String(q.a) + (q.unit || '');
    if (q.t === 'text') return q.a[0];
    if (q.t === 'mc') return KANA[q.a] + '　' + q.c[q.a];
    if (q.t === 'multi') return q.a.slice().sort(function (x, y) { return x - y; }).map(function (i) { return KANA[i] + ' ' + q.c[i]; }).join('、');
    return '';
  }
  function respText(q, r) {
    if (r == null || r === '' || (Array.isArray(r) && !r.length)) return '（無回答）';
    if (q.t === 'num') return String(r) + (q.unit || '');
    if (q.t === 'text') return String(r);
    if (q.t === 'mc') return KANA[r] + '　' + q.c[r];
    if (q.t === 'multi') return r.slice().sort(function (x, y) { return x - y; }).map(function (i) { return KANA[i] + ' ' + q.c[i]; }).join('、');
    return '';
  }
  function hasResp(q, r) {
    if (q.t === 'multi') return Array.isArray(r) && r.length > 0;
    if (q.t === 'mc') return typeof r === 'number';
    return r != null && String(r).trim() !== '';
  }
  function grade(q, r) {
    if (!hasResp(q, r)) return false;
    if (q.t === 'num') { var n = parseNum(r); return !isNaN(n) && Math.abs(n - Number(q.a)) < 1e-9; }
    if (q.t === 'text') {
      var v = normText(r);
      return q.a.some(function (x) { return normText(x) === v; });
    }
    if (q.t === 'mc') return r === q.a;
    if (q.t === 'multi') {
      var a = q.a.slice().sort().join(','), b = r.slice().sort().join(',');
      return a === b;
    }
    return false;
  }

  // 誤答の注意書き: confuse の文のうち、選んだ（書いた）答えを含む文だけを出す
  function wrongNote(card, q, r) {
    if (!card.confuse || !hasResp(q, r) || q.t === 'multi') return '';
    var key;
    if (q.t === 'mc') key = q.c[r];
    else if (q.t === 'num') { var n = parseNum(r); if (isNaN(n)) return ''; key = String(n) + (q.unit || ''); }
    else key = String(r).trim();
    key = key.normalize('NFKC').replace(/[\s,，]/g, '');
    if (!key) return '';
    var sents = card.confuse.split('。').map(function (x) { return x.trim(); }).filter(Boolean);
    var hit = sents.filter(function (x) { return x.normalize('NFKC').replace(/[\s,，]/g, '').indexOf(key) >= 0; });
    if (!hit.length) return '';
    return '<span class="s">' + hit.map(function (x) {
      var t = x.normalize('NFKC').replace(/[\s,，]/g, '');
      var lead = (q.t === 'mc' && t.indexOf(key) === 0) ? KANA[r] + 'の' : '';
      return esc(lead + x + '。');
    }).join('') + '</span>';
  }
  // 確認問題: 記述・数値の問いを優先し、選択式しかなければ選択肢も見せる
  function recallQ(card) {
    var q = card.qs.filter(function (x) { return x.t === 'num' || x.t === 'text'; })[0] || card.qs[0];
    var text = q.q;
    if (q.t === 'mc' || q.t === 'multi') text += '\n' + q.c.map(function (t, i) { return KANA[i] + '　' + t; }).join('\n');
    return { q: q, text: text };
  }

  /* ---------------- card selection ---------------- */
  function filtered() {
    return D.cards.filter(function (c) {
      if (S.filter.area !== 'all' && c.area !== S.filter.area) return false;
      if (S.filter.onlyA && c.imp !== 'A') return false;
      return true;
    });
  }
  function counts(list) {
    var t = now(), r = { due: 0, fresh: 0, learning: 0, mastered: 0 };
    (list || D.cards).forEach(function (c) {
      var s = S.cards[c.id];
      if (!s || s.box === 0) { r.fresh++; return; }
      if (s.due <= t) r.due++;
      if (s.box >= 3) r.mastered++; else r.learning++;
    });
    return r;
  }
  var IMP_RANK = { A: 0, B: 1, C: 2 };
  function pickCards(list, n) {
    var t = now();
    var due = list.filter(function (c) { var s = S.cards[c.id]; return s && s.box > 0 && s.due <= t; });
    due.sort(function (a, b) {
      var x = S.cards[a.id], y = S.cards[b.id];
      return (x.box - y.box) || (y.ng - x.ng) || (x.due - y.due);
    });
    var fresh = list.filter(function (c) { var s = S.cards[c.id]; return !s || s.box === 0; });
    // 新しいカードは章ごとに重要度順に並べ、章をまたいで1枚ずつ交互に出す（1つの章に偏らない）
    var byCh = {}, order = [];
    fresh.sort(function (a, b) { return (IMP_RANK[a.imp] - IMP_RANK[b.imp]) || (a.ord - b.ord); });
    fresh.forEach(function (c) { if (!byCh[c.ch]) { byCh[c.ch] = []; order.push(c.ch); } byCh[c.ch].push(c); });
    order = shuffle(order);
    fresh = [];
    for (var k = 0, more = true; more; k++) {
      more = false;
      order.forEach(function (ch) { if (byCh[ch][k]) { fresh.push(byCh[ch][k]); more = true; } });
    }
    var out = due.slice(0, n);
    for (var i = 0; out.length < n && i < fresh.length; i++) out.push(fresh[i]);
    if (!out.length) {
      // すべて期限前: 期限の近い順に先取り復習
      var rest = list.slice().sort(function (a, b) { return (S.cards[a.id].due - S.cards[b.id].due); });
      out = rest.slice(0, n);
    }
    return out.map(function (c) { return c.id; });
  }

  /* ---------------- session engine ---------------- */
  // mode: 'drill'（Leitner 更新）| 'final'（正解1回で外す・箱は誤答時のみ下げる）
  function startSession(ids, mode, title, back) {
    if (!ids.length) { alert('出題できるカードがありません。'); return; }
    var need = {};
    ids.forEach(function (id) {
      var s = S.cards[id];
      need[id] = mode === 'final' ? 1 : (s && s.box >= 2 ? 1 : 2);
    });
    session = {
      mode: mode, title: title, back: back || '#/',
      queue: shuffleKeepFirst(ids), p: 0, need: need, total: ids.length,
      done: {}, wrong: {}, shaky: {}, lastQi: {}, ok: 0, ng: 0,
      cur: null, phase: 'ask'
    };
    nextItem();
    go('#/session');
  }
  function shuffleKeepFirst(ids) {
    // 期限到来カードを前半に保ちつつ、近いもの同士をばらす
    var head = ids.slice(0, Math.ceil(ids.length / 2)), tail = ids.slice(head.length);
    return shuffle(head).concat(shuffle(tail));
  }
  function nextItem() {
    var q = session.queue;
    while (session.p < q.length && session.done[q[session.p]]) session.p++;
    if (session.p >= q.length) { session.cur = null; return; }
    var id = q[session.p], card = D.byId[id];
    var last = session.lastQi[id];
    var qi = last == null ? 0 : (last + 1) % card.qs.length;
    session.lastQi[id] = qi;
    var qq = card.qs[qi];
    session.cur = { id: id, qi: qi, q: qq, resp: qq.t === 'multi' ? [] : null, revealed: !(S.settings.recall && (qq.t === 'mc' || qq.t === 'multi')), result: null };
    session.phase = 'ask';
  }
  function requeue(id, gap) {
    var q = session.queue;
    // 以降の重複を消してから gap 後ろへ
    for (var i = q.length - 1; i > session.p; i--) if (q[i] === id) q.splice(i, 1);
    var pos = Math.min(q.length, session.p + 1 + gap);
    q.splice(pos, 0, id);
    return pos - session.p - 1;
  }
  function submit(conf) {
    var c = session.cur, card = D.byId[c.id];
    var ok = grade(c.q, c.resp);
    finishAnswer(ok, conf);
  }
  function finishAnswer(ok, conf) {
    var c = session.cur, id = c.id, s = cs(id);
    c.result = { ok: ok, conf: conf, laterIn: null };
    s.last = now();
    if (ok) { s.ok++; session.ok++; } else { s.ng++; s.lastNg = now(); session.ng++; }
    if (ok && conf === 'sure') {
      session.need[id]--;
    } else if (ok) {
      session.shaky[id] = true;
    } else {
      session.wrong[id] = true;
      session.need[id] = session.mode === 'final' ? 1 : 2;
      if (session.mode === 'final') { s.box = 1; s.due = now(); }
    }
    if (session.need[id] <= 0) {
      session.done[id] = true;
      if (session.mode === 'drill') {
        if (session.wrong[id] || session.shaky[id]) { s.box = 1; s.due = now() + INTERVAL[1]; }
        else { s.box = Math.min(s.box + 1, 4); s.due = now() + INTERVAL[s.box]; }
      }
    } else {
      var gap = ok ? 4 + Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 3);
      c.result.laterIn = requeue(id, gap);
    }
    save();
    session.phase = 'feedback';
    render();
  }
  function overrideCorrect() {
    // 記述の表記ゆれ: 自己判定で正解にする
    var c = session.cur, id = c.id, s = cs(id);
    s.ng = Math.max(0, s.ng - 1); session.ng = Math.max(0, session.ng - 1);
    s.ok++; session.ok++;
    // 誤答で入れた再出題をいったん取り消す
    var q = session.queue;
    for (var i = q.length - 1; i > session.p; i--) if (q[i] === id) q.splice(i, 1);
    delete session.wrong[id];
    session.need[id] = (session.need[id] || 1) - 1;
    if (session.need[id] <= 0) {
      session.done[id] = true;
      if (session.mode === 'drill') {
        if (session.shaky[id]) { s.box = 1; s.due = now() + INTERVAL[1]; }
        else { s.box = Math.min(s.box + 1, 4); s.due = now() + INTERVAL[s.box]; }
      }
      c.result = { ok: true, conf: 'sure', laterIn: null, overridden: true };
    } else {
      c.result = { ok: true, conf: 'sure', laterIn: requeue(id, 4), overridden: true };
    }
    save();
    render();
  }

  /* ---------------- views ---------------- */
  function topbar(opts) {
    var left = opts.close
      ? '<a class="iconbtn" href="' + esc(opts.back || '#/') + '" aria-label="中断してもどる">' + ICON.close + '</a>'
      : '<a class="iconbtn" href="' + esc(opts.back || '#/') + '" aria-label="もどる">' + ICON.back + '</a>';
    return '<header class="topbar' + (opts.surface ? ' on-surface' : '') + '">' + left + (opts.mid || '') + (opts.right || '') + '</header>';
  }
  function ttl(sub, main) {
    return '<div class="ttl"><span class="sub">' + esc(sub) + '</span><span class="main">' + esc(main) + '</span></div>';
  }

  function viewHome() {
    var scope = filtered(), c = counts(scope), total = scope.length || 1;
    var dl = daysLeft();
    var dayHtml = dl > 0
      ? '<span class="lbl">本番 ' + EXAM.label + ' まで</span><div><span class="big tnum">' + dl + '</span><span>日</span></div>'
      : (dl === 0 ? '<span class="lbl">本番 ' + EXAM.label + '</span><div><span class="big">今日</span></div>' : '<span class="lbl">本番 ' + EXAM.label + '</span><div><span class="big" style="font-size:36px">おつかれさま</span></div>');
    var dueLabel = c.due > 0 ? '今日の復習' : '新しいカード';
    var dueNum = c.due > 0 ? c.due : c.fresh;
    var weak = D.cards.filter(function (k) { var s = S.cards[k.id]; return s && s.ng > 0; })
      .sort(function (a, b) { return S.cards[b.id].ng - S.cards[a.id].ng || S.cards[b.id].lastNg - S.cards[a.id].lastNg; }).slice(0, 3);
    var readN = D.reading.filter(function (r) { return S.read[r.id]; }).length;
    var weakHtml = weak.length ? weak.map(function (k) {
      return '<button class="it" data-act="weak-one" data-id="' + esc(k.id) + '"><span class="l"><span class="a">' + esc(k.title) + '</span><span class="b">' + esc(k.area) + ' ・ ' + esc(k.src) + '</span></span><span class="r tnum">×' + S.cards[k.id].ng + '</span></button>';
    }).join('') : '<div class="empty">まだ記録がありません。ドリルを解くと、よく間違えるカードがここに並びます。</div>';
    var bestMock = Object.keys(S.mocks).length ? Math.max.apply(null, Object.keys(S.mocks).map(function (k) { return S.mocks[k].best || 0; })) : null;

    return '<div class="home-head"><div><div class="k">事業部研修 進学知識テスト</div><div class="t">進学知識ドリル</div></div>' +
      '<a class="iconbtn boxed" href="#/settings" aria-label="設定">' + ICON.gear + '</a></div>' +
      '<section class="hero"><div class="row"><div>' + dayHtml + '</div>' +
      '<div style="text-align:right"><div class="lbl">' + dueLabel + '</div><div class="due tnum">' + dueNum + '<span style="font-size:14px;font-weight:500"> 枚</span></div></div></div>' +
      '<div><div class="bar"><div class="a" style="width:' + (c.mastered / total * 100) + '%"></div><div class="b" style="width:' + (c.learning / total * 100) + '%"></div></div>' +
      '<div class="legend tnum" style="margin-top:6px"><span>' + (S.filter.onlyA ? '最重要' : '全') + scope.length + '枚：</span><span>定着 ' + c.mastered + '</span><span style="opacity:.85">学習中 ' + c.learning + '</span><span style="opacity:.85">未学習 ' + c.fresh + '</span></div></div>' +
      '<button class="cta" data-act="quick">' + (c.due > 0 ? '今日の復習をはじめる' : 'ドリルをはじめる') + ICON.arrow + '</button></section>' +
      '<div class="sec-ttl">モード</div><div class="modes">' +
      '<a class="mode" href="#/read">' + ICON.book + '<div><div class="n">読む</div><div class="d">' + D.reading.length + '章のうち ' + readN + '章読了</div></div></a>' +
      '<a class="mode" href="#/drill">' + ICON.check + '<div><div class="n">ドリル</div><div class="d">忘れかけを優先して出題</div></div></a>' +
      '<a class="mode" href="#/mock">' + ICON.clock + '<div><div class="n">予想問題</div><div class="d">本番形式 50問・20分' + (bestMock != null ? '<br>最高 ' + bestMock + '点' : '') + '</div></div></a>' +
      '<a class="mode warm" href="#/final">' + ICON.bolt + '<div><div class="n">試験直前</div><div class="d">早見表と弱点の一周</div></div></a></div>' +
      '<div class="sec-ttl"><span>よく間違えるカード</span>' + (weak.length ? '<button data-act="weak-all">まとめて復習</button>' : '') + '</div>' +
      '<div class="list">' + weakHtml + '</div>' +
      '<div class="foot"><div>学習の記録はこのスマホに残ります。別の端末やブラウザでは引き継がれません。</div></div>';
  }

  function viewDrillSetup() {
    var list = filtered(), c = counts(list);
    var areas = [['all', '全部'], ['中学', '中学'], ['高校', '高校']];
    return topbar({ back: '#/', mid: ttl('ドリル', '出題の設定') }) +
      '<div class="sec-ttl">範囲</div><div class="filter">' + areas.map(function (a) {
        return '<button data-act="area" data-v="' + a[0] + '" aria-pressed="' + (S.filter.area === a[0]) + '">' + a[1] + '</button>';
      }).join('') + '<button data-act="onlyA" aria-pressed="' + S.filter.onlyA + '">最重要だけ（' + D.cards.filter(function (k) { return k.imp === 'A'; }).length + '枚）</button></div>' +
      '<div class="sheet" style="margin-top:16px"><div class="opt-row"><span>まだ解いていないカード</span><strong class="tnum">' + c.fresh + '枚</strong></div>' +
      '<div class="opt-row"><span>学習中のカード</span><strong class="tnum">' + c.learning + '枚</strong></div>' +
      '<div class="opt-row"><span>定着したカード</span><strong class="tnum">' + c.mastered + '枚</strong></div>' +
      '<div class="opt-row sub"><span>学習中・定着のうち、今日復習するカード</span><strong class="tnum">' + c.due + '枚</strong></div>' +
      '<div class="opt-row"><label for="nsel">1セットの枚数</label><select id="nsel" data-act="n">' + [10, 20, 30].map(function (n) {
        return '<option value="' + n + '"' + (S.settings.n === n ? ' selected' : '') + '>' + n + '枚</option>';
      }).join('') + '</select></div></div>' +
      '<div class="sheet small muted" style="gap:6px"><div>今日復習するカードから出題し、残りは新しいカードから出題されます。</div><div>間違えたカードは、数問後にもう一度出題されます。新しいカードは2回正解で完了となり、このセットではもう出題されません。</div></div>' +
      '<div class="dock"><button class="btn primary" data-act="start-drill">はじめる' + ICON.arrow + '</button></div>';
  }

  function viewSession() {
    if (!session) { go('#/drill'); return ''; }
    if (!session.cur) return viewSessionDone();
    var c = session.cur, card = D.byId[c.id], q = c.q, s = S.cards[c.id];
    var doneN = Object.keys(session.done).length;
    var pct = doneN / session.total * 100;
    var head = topbar({ close: true, back: session.back, mid: '<div class="progress" role="progressbar" aria-valuenow="' + doneN + '" aria-valuemax="' + session.total + '"><div style="width:' + pct + '%"></div></div>', right: '<span class="count tnum">' + doneN + ' / ' + session.total + '</span>' });
    var chips = '<div class="chips"><span class="chip blue">' + esc(card.area) + '</span>' + (card.imp === 'A' ? '<span class="chip">最重要</span>' : '') + (card.ref ? '<span class="chip">資料外・参考</span>' : '') +
      (session.phase === 'feedback' ? '' : (s && s.ng > 0 ? '<span class="chip warm">前に間違えた</span>' : (!s || (s.ok + s.ng) === 0 ? '<span class="chip">はじめて</span>' : ''))) + '</div>';

    if (session.phase === 'feedback') return head + chips + viewFeedback(c, card);

    var body = '<section class="qcard"><p class="q">' + esc(q.q) + '</p></section>';
    var hidden = (q.t === 'mc' || q.t === 'multi') && !c.revealed;
    if (q.t === 'mc' || q.t === 'multi') {
      if (hidden) body += '<button class="reveal-btn" data-act="reveal">選択肢を表示</button>';
      else body += '<div class="choices">' + q.c.map(function (txt, i) {
        var on = q.t === 'mc' ? c.resp === i : c.resp.indexOf(i) >= 0;
        return '<button class="choice" data-act="pick" data-i="' + i + '" aria-pressed="' + on + '"><span class="k">' + KANA[i] + '</span><span class="v">' + esc(txt) + '</span></button>';
      }).join('') + '</div>';
    } else {
      body += '<div class="answer-input"><input id="ans" ' + (q.t === 'num' ? 'inputmode="decimal"' : 'inputmode="text"') + ' autocomplete="off" aria-label="解答" placeholder="' + (q.t === 'num' ? '数字' : '答え') + '" value="' + esc(c.resp || '') + '">' + (q.unit ? '<span class="unit">' + esc(q.unit) + '</span>' : '') + '</div>';
    }
    var can = hasResp(q, c.resp);
    var dock = '<div class="dock">' + (hidden ? '' : '<div class="two">' +
      '<button class="btn" data-act="submit" data-conf="guess"' + (can ? '' : ' disabled') + '>勘で答えた</button>' +
      '<button class="btn primary" data-act="submit" data-conf="sure"' + (can ? '' : ' disabled') + '>確信あり</button></div>') +
      '<button class="linkbtn" data-act="dunno" style="text-align:center">わからない</button></div>';
    return head + chips + body + '<div class="spacer"></div>' + dock;
  }

  function viewFeedback(c, card) {
    var r = c.result, q = c.q, html = '';
    if (r.ok) {
      html += '<section class="verdict ok"><div class="h"><span class="badge">' + ICON.ok + '</span><span>' + (r.overridden ? '正解にしました' : (r.conf === 'guess' ? '正解。勘で答えた問題は、確認のためもう一度出題されます' : '正解')) + '</span></div></section>';
    } else {
      html += '<section class="verdict ng"><div class="h"><span class="badge">' + ICON.ng + '</span><span>あなたの答え：' + esc(respText(q, c.resp)) + '</span></div>' +
        wrongNote(card, q, c.resp) + '</section>';
    }
    html += '<section class="answer"><span class="lbl">正解</span><div class="val tnum">' + esc(answerText(q)) + '</div>' +
      '<p class="fact">' + esc(card.fact) + '</p>' +
      (card.prev ? '<div class="prev tnum">' + esc(card.prev) + '</div>' : '') +
      (card.ref ? '<span class="src">資料外・参考：' + esc(card.src) + '</span>' : '') + '</section>';
    if (!r.ok && q.t === 'text') html += '<div style="padding:0 20px"><button class="linkbtn" data-act="override">表記ちがいで、実は合っていた → 正解にする</button></div>';
    if (r.laterIn != null) {
      var left = session.need[c.id];
      html += '<div class="again">' + ICON.again + '<span>このカードは' + (r.laterIn + 1) + '問後にもう一度出題されます' + (left > 0 ? '（あと' + left + '回正解で完了です）' : '') + '</span></div>';
    } else if (session.done[c.id]) {
      html += '<div class="again">' + ICON.ok + '<span>このカードは完了です。このセットではもう出題されません</span></div>';
    }
    html += '<div class="spacer"></div><div class="dock"><button class="btn primary" data-act="next" id="nextbtn">次の問題へ</button></div>';
    return html;
  }

  function viewSessionDone() {
    var tot = session.ok + session.ng;
    var acc = tot ? Math.round(session.ok / tot * 100) : 0;
    var again = session.mode === 'drill' ? '<button class="btn primary" data-act="start-drill">もう1セット</button>' : '<button class="btn primary" data-act="final-loop">もう一周</button>';
    return topbar({ back: session.back, mid: ttl(session.title, 'おつかれさま') }) +
      '<section class="done"><div class="big">' + session.total + '枚を一周しました</div>' +
      '<div class="row tnum"><span>解いた回数 ' + tot + '</span><span>正答率 ' + acc + '%</span><span>やり直し ' + Object.keys(session.wrong).length + '枚</span></div>' +
      (session.mode === 'drill' ? '<div class="small muted">今日間違えたカードは6時間後、正解したカードは翌日以降にまた出ます。</div>' : '') + '</section>' +
      '<div class="dock"><div class="two"><a class="btn" href="#/">ホーム</a>' + again + '</div></div>';
  }

  /* reading */
  function viewReadList() {
    var groups = {};
    D.reading.forEach(function (r) { (groups[r.area] = groups[r.area] || []).push(r); });
    var html = topbar({ back: '#/', mid: ttl('読む', '章の一覧') }) + '<div class="chapters">';
    Object.keys(groups).forEach(function (g) {
      html += '<div class="grp">' + esc(g) + '</div><div class="list">' + groups[g].map(function (r) {
        var done = !!S.read[r.id];
        return '<a class="it ch-item" href="#/read/' + esc(r.id) + '"><span class="ch-row"><span class="num' + (done ? ' is-read' : '') + '">' + (done ? ICON.ok : r.no) + '</span><span class="l"><span class="a">' + esc(r.title) + '</span><span class="b">' + esc(r.lead || '') + '</span></span></span><span class="r ok">' + (r.minutes ? r.minutes + '分' : '') + '</span></a>';
      }).join('') + '</div>';
    });
    return html + '</div><div class="spacer"></div>';
  }
  function viewRead(id) {
    var r = D.reading.filter(function (x) { return x.id === id; })[0];
    if (!r) return viewReadList();
    var idx = D.reading.indexOf(r), nxt = D.reading[idx + 1];
    var rc = (r.recall || []).map(function (cid) { return D.byId[cid]; }).filter(Boolean);
    var recall = rc.length ? '<section class="recall" id="recall" data-i="0"><div class="h"><span>確認問題</span><span class="xs muted tnum" id="rc-n">1 / ' + rc.length + '</span></div>' +
      '<div class="qq" id="rc-q">' + esc(recallQ(rc[0]).text) + '</div><div class="aa hidden" id="rc-a"></div>' +
      '<div class="row"><button class="btn" data-act="rc-show">答えを見る</button><button class="btn" data-act="rc-next">次へ</button></div></section>' : '';
    return topbar({ back: '#/read', surface: true, mid: ttl(r.area + ' ・ 第' + r.no + '章', r.title), right: '<span class="count tnum">' + (idx + 1) + ' / ' + D.reading.length + '</span>' }) +
      '<div class="read-progress"><div id="rp"></div></div>' +
      '<article class="reading">' + r.html + '</article>' + recall +
      '<div style="padding:0 16px 8px" class="small muted" id="read-end">この章のカード ' + (r.cards || []).length + '枚</div>' +
      '<div class="dock"><div class="two"><button class="btn" data-act="chapter-drill" data-id="' + esc(r.id) + '">この章の問題を解く</button>' +
      (nxt ? '<a class="btn primary" href="#/read/' + esc(nxt.id) + '" data-act="mark-read" data-id="' + esc(r.id) + '">次の章へ</a>' : '<a class="btn primary" href="#/read" data-act="mark-read" data-id="' + esc(r.id) + '">一覧へ</a>') + '</div></div>';
  }

  /* mock */
  function viewMockList() {
    return topbar({ back: '#/', mid: ttl('予想問題', '本番形式で解く') }) +
      '<div class="sheet small muted" style="gap:6px"><div>本番と同じ形式です。①中学入試25問・②高校入試25問、各2点、20分。完答の問題はすべて合っていて正解です。学校名は略称でかまいません。</div><div>採点後、間違えた問題のカードはドリルの復習に入ります。</div></div>' +
      '<div class="list">' + D.mocks.map(function (m) {
        var rec = S.mocks[m.id];
        return '<a class="it" href="#/mock/' + esc(m.id) + '"><span class="l"><span class="a">' + esc(m.title) + '</span><span class="b">' + esc(m.note || '') + '</span></span><span class="r ok tnum">' + (rec ? '最高 ' + rec.best + '点' : '未受験') + '</span></a>';
      }).join('') + '</div><div class="spacer"></div>';
  }
  function startMock(id) {
    var m = D.mocks.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    mockRun = { id: id, m: m, resp: {}, end: null, submitted: false, started: false };
  }
  function viewMock(id) {
    if (!mockRun || mockRun.id !== id) startMock(id);
    if (!mockRun) return viewMockList();
    var m = mockRun.m, sub = mockRun.submitted;
    if (!mockRun.started && !sub) {
      return topbar({ back: '#/mock', mid: ttl('予想問題', m.title) }) +
        '<section class="done"><div class="big">' + esc(m.title) + '</div><div class="small muted">' + esc(m.note || '') + '</div>' +
        '<div class="row"><span>①中学 25問</span><span>②高校 25問</span><span>各2点</span><span>20分</span></div></section>' +
        '<div class="dock"><button class="btn dark" data-act="mock-begin">はじめる（20分）</button></div>';
    }
    var timer = sub ? '' : '<span class="timer tnum" id="timer">' + ICON.clock + '<span id="tt">20:00</span></span>';
    var html = topbar({ back: '#/mock', surface: true, mid: ttl('予想問題', m.title), right: timer });
    if (sub) html += viewMockScore();
    var no = 0;
    m.sections.forEach(function (sec, si) {
      html += '<div class="sect-h">' + esc(sec.name) + '</div>';
      sec.qs.forEach(function (q, qi) {
        var key = si + '-' + qi, r = mockRun.resp[key];
        var tag = q.t === 'multi' ? '<span class="tag full">完答</span>' : '<span class="tag">' + (q.t === 'num' ? '数値' : q.t === 'text' ? '記述' : '選択') + '</span>';
        var body = '<div class="mock-q" id="mq-' + key + '"><div class="hd"><span class="no">問' + (qi + 1) + '</span>' + tag + '</div><p class="stem">' + esc(q.q) + '</p>';
        if (q.t === 'mc' || q.t === 'multi') {
          var longOpt = q.c.some(function (t) { return t.length > 12; });
          body += '<div class="opts' + (longOpt ? ' one' : '') + '">' + q.c.map(function (t, i) {
            var on = q.t === 'mc' ? r === i : (r || []).indexOf(i) >= 0;
            var cls = '';
            if (sub) {
              var isAns = q.t === 'mc' ? q.a === i : q.a.indexOf(i) >= 0;
              if (isAns) cls = ' right'; else if (on) cls = ' wrong';
            }
            return '<button class="opt' + cls + '" data-act="mpick" data-k="' + key + '" data-i="' + i + '" aria-pressed="' + on + '"' + (sub ? ' disabled' : '') + '><span class="muted">' + KANA[i] + '</span><span>' + esc(t) + '</span></button>';
          }).join('') + '</div>';
        } else {
          body += '<div style="display:flex;align-items:center;gap:8px"><input class="txt" data-act="minput" data-k="' + key + '" ' + (q.t === 'num' ? 'inputmode="decimal"' : '') + ' aria-label="問' + (qi + 1) + 'の解答" value="' + esc(r || '') + '"' + (sub ? ' disabled' : '') + '>' + (q.unit ? '<span>' + esc(q.unit) + '</span>' : '') + '</div>';
        }
        if (sub) {
          var ok = grade(q, r), card = D.byId[q.card];
          body += '<div class="res ' + (ok ? 'ok' : 'ng') + '"><strong>' + (ok ? '○' : '×') + '</strong>　答え：' + esc(answerText(q)) + (card ? '<br><span class="small">' + esc(card.fact) + '</span>' : '') + '</div>';
        }
        html += body + '</div>';
        no++;
      });
    });
    if (!sub) html += '<div class="dock"><button class="btn dark" data-act="mock-submit">提出して採点</button></div>';
    else html += '<div class="dock"><div class="two"><a class="btn" href="#/mock">一覧へ</a><button class="btn primary" data-act="mock-retry">もう一度解く</button></div></div>';
    return html;
  }
  function mockScore() {
    var m = mockRun.m, total = 0, max = 0, per = [];
    m.sections.forEach(function (sec, si) {
      var p = 0;
      sec.qs.forEach(function (q, qi) { var pts = q.pts || 2; max += pts; if (grade(q, mockRun.resp[si + '-' + qi])) { total += pts; p += pts; } });
      per.push({ name: sec.name, p: p, max: sec.qs.reduce(function (a, q) { return a + (q.pts || 2); }, 0) });
    });
    return { total: total, max: max, per: per };
  }
  function viewMockScore() {
    var sc = mockScore();
    return '<section class="score"><span class="small muted">得点</span><div><span class="big tnum">' + sc.total + '</span><span class="tnum"> / ' + sc.max + '点</span></div>' +
      '<div class="row tnum">' + sc.per.map(function (p) { return '<span>' + esc(p.name.replace(/に関する問題.*/, '')) + ' ' + p.p + '/' + p.max + '</span>'; }).join('') + '</div>' +
      '<div class="small muted">間違えた問題のカードをドリルの復習に入れました。</div></section>';
  }
  function submitMock(timeUp) {
    if (!mockRun || mockRun.submitted) return;
    if (!timeUp) {
      var unanswered = 0;
      mockRun.m.sections.forEach(function (sec, si) { sec.qs.forEach(function (q, qi) { if (!hasResp(q, mockRun.resp[si + '-' + qi])) unanswered++; }); });
      if (unanswered && !window.confirm('未回答が' + unanswered + '問あります。採点しますか？')) return;
    }
    stopTimer();
    mockRun.submitted = true;
    mockRun.m.sections.forEach(function (sec, si) {
      sec.qs.forEach(function (q, qi) {
        if (!q.card || !D.byId[q.card]) return;
        var s = cs(q.card);
        if (grade(q, mockRun.resp[si + '-' + qi])) { s.ok++; }
        else { s.ng++; s.lastNg = now(); s.box = 1; s.due = now(); }
      });
    });
    var sc = mockScore();
    var rec = S.mocks[mockRun.id] || { best: 0, n: 0 };
    rec.best = Math.max(rec.best, sc.total); rec.last = sc.total; rec.n++;
    S.mocks[mockRun.id] = rec;
    save();
    render();
    window.scrollTo(0, 0);
    if (timeUp) setTimeout(function () { alert('時間です。採点しました。'); }, 50);
  }
  function startTimer() {
    stopTimer();
    timerId = setInterval(tick, 500);
    tick();
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }
  function tick() {
    if (!mockRun || !mockRun.end) return;
    var left = Math.max(0, mockRun.end - now());
    var el = document.getElementById('tt'), box = document.getElementById('timer');
    if (el) {
      var m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
      el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
      if (box) box.classList.toggle('low', left < 3 * 60000);
    }
    if (left <= 0) submitMock(true);
  }

  /* final */
  var finalTab = 'hayami', finalHide = true, revealed = {};
  function viewFinal() {
    var html = '<div class="night-wrap">' + topbar({ back: '#/', mid: ttl('試験直前', finalTab === 'hayami' ? '合格実績の早見表' : '弱点を一周') }) +
      '<div class="seg"><button data-act="ftab" data-v="hayami" aria-pressed="' + (finalTab === 'hayami') + '">早見表</button><button data-act="ftab" data-v="loop" aria-pressed="' + (finalTab === 'loop') + '">弱点を一周</button></div>';
    if (finalTab === 'hayami') {
      html += '<div class="seg" style="margin-top:10px"><button data-act="fhide" data-v="1" aria-pressed="' + finalHide + '">数字を隠す</button><button data-act="fhide" data-v="0" aria-pressed="' + !finalHide + '">すべて表示</button></div>';
      D.hayami.forEach(function (g, gi) {
        html += '<div class="hy-h">' + esc(g.title) + '</div><div class="hy">' + g.rows.map(function (r, ri) {
          var key = gi + '-' + ri;
          var show = !finalHide || revealed[key];
          var val = show
            ? '<span class="vv">' + (r.sub ? '<span class="sub tnum' + (r.dn ? ' dn' : '') + '">' + esc(r.sub) + '</span>' : '') + '<strong class="tnum">' + esc(r.value) + '</strong></span>'
            : '<button class="cover" data-act="freveal" data-k="' + key + '">タップで表示</button>';
          return '<div class="r"><span class="lb">' + esc(r.label) + '</span>' + val + '</div>';
        }).join('') + '</div>';
      });
      html += '<div class="night-cta"><button class="btn" data-act="final-loop">' + ICON.bolt + '弱点を一周する</button><span class="note">早見表の数字は、それぞれ出典ページのカードと同じです。</span></div>';
    } else {
      var ids = finalIds();
      html += '<div class="hy-h">対象</div><div class="hy"><div class="r"><span class="lb">最重要カード＋一度でも間違えたカード</span><span class="vv"><strong class="tnum">' + ids.length + '</strong><span class="sub">枚</span></span></div></div>' +
        '<div class="hy-h">進め方</div><div class="hy"><div class="r"><span class="lb">間違いの多いカードから出題されます。1回正解で完了です。間違えたカードは、数問後にもう一度出題されます。</span></div></div>' +
        '<div class="night-cta"><button class="btn" data-act="final-loop">' + ICON.bolt + 'はじめる</button></div>';
    }
    return html + '</div>';
  }
  function finalIds() {
    return D.cards.filter(function (c) { var s = S.cards[c.id]; return c.imp === 'A' || (s && s.ng > 0); })
      .sort(function (a, b) {
        var x = S.cards[a.id] || { ng: 0 }, y = S.cards[b.id] || { ng: 0 };
        return (y.ng - x.ng) || (IMP_RANK[a.imp] - IMP_RANK[b.imp]) || (a.ord - b.ord);
      }).map(function (c) { return c.id; });
  }

  /* settings */
  function viewSettings() {
    return topbar({ back: '#/', mid: ttl('設定', '設定と記録') }) +
      '<div class="sheet"><div class="opt-row"><label for="rc">選択肢を最初は隠しておく</label><input type="checkbox" id="rc" data-act="recall"' + (S.settings.recall ? ' checked' : '') + '></div>' +
      '<div class="opt-row"><label for="th">表示</label><select id="th" data-act="theme">' + [['auto', '端末に合わせる'], ['light', 'ライト'], ['dark', 'ダーク']].map(function (o) {
        return '<option value="' + o[0] + '"' + (S.settings.theme === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="sheet small muted" style="gap:6px"><div>カード ' + D.cards.length + '枚 ・ 章 ' + D.reading.length + ' ・ 予想問題 ' + D.mocks.length + 'セット</div><div>データ更新: ' + esc(D.version || '') + '</div></div>' +
      '<div class="sheet"><button class="btn" data-act="reset" style="color:var(--warm)">学習記録をすべて消す</button></div>';
  }

  /* ---------------- router ---------------- */
  function go(h) { if (location.hash !== h) location.hash = h; else render(); }
  function route() {
    var h = location.hash.replace(/^#/, '') || '/';
    var parts = h.split('/').filter(Boolean);
    return parts;
  }
  function render() {
    var p = route(), html = '';
    document.body.classList.toggle('night', p[0] === 'final');
    if (p[0] !== 'mock' || !p[1]) { if (!(mockRun && mockRun.started && !mockRun.submitted)) stopTimer(); }
    switch (p[0]) {
      case undefined: html = viewHome(); break;
      case 'read': html = p[1] ? viewRead(decodeURIComponent(p[1])) : viewReadList(); break;
      case 'drill': html = viewDrillSetup(); break;
      case 'session': html = viewSession(); break;
      case 'mock': html = p[1] ? viewMock(decodeURIComponent(p[1])) : viewMockList(); break;
      case 'final': html = viewFinal(); break;
      case 'settings': html = viewSettings(); break;
      default: html = viewHome();
    }
    app.innerHTML = html;
    var ans = document.getElementById('ans');
    if (ans) { ans.focus({ preventScroll: true }); }
    var nb = document.getElementById('nextbtn');
    if (nb) nb.focus({ preventScroll: true });
    if (p[0] === 'read' && p[1]) bindReadProgress(decodeURIComponent(p[1]));
    if (p[0] === 'mock' && p[1] && mockRun && mockRun.started && !mockRun.submitted && !timerId) startTimer();
    else if (timerId) tick();
  }
  var lastRoute = '';
  window.addEventListener('hashchange', function () {
    var p = route();
    if (p[0] === 'mock' && p[1] && mockRun && mockRun.id !== decodeURIComponent(p[1])) mockRun = null;
    render();
    var key = location.hash;
    if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
  });

  function bindReadProgress(id) {
    var bar = document.getElementById('rp'), end = document.getElementById('read-end');
    function onScroll() {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (bar) bar.style.width = (h > 0 ? Math.min(100, window.scrollY / h * 100) : 100) + '%';
    }
    window.onscroll = onScroll; onScroll();
    if (end && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting && !S.read[id]) { S.read[id] = true; save(); } });
      });
      io.observe(end);
    }
  }

  /* ---------------- events ---------------- */
  app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var c = session && session.cur;
    switch (act) {
      case 'quick': startSession(pickCards(filtered(), S.settings.n), 'drill', 'ドリル', '#/'); break;
      case 'area': S.filter.area = el.getAttribute('data-v'); save(); render(); break;
      case 'onlyA': S.filter.onlyA = !S.filter.onlyA; save(); render(); break;
      case 'start-drill': startSession(pickCards(filtered(), S.settings.n), 'drill', 'ドリル', '#/drill'); break;
      case 'reveal': c.revealed = true; render(); break;
      case 'pick':
        var i = +el.getAttribute('data-i');
        if (c.q.t === 'mc') c.resp = i;
        else { var k = c.resp.indexOf(i); if (k >= 0) c.resp.splice(k, 1); else c.resp.push(i); }
        render(); break;
      case 'submit':
        var inp = document.getElementById('ans');
        if (inp) c.resp = inp.value;
        if (!hasResp(c.q, c.resp)) return;
        submit(el.getAttribute('data-conf')); window.scrollTo(0, 0); break;
      case 'dunno': finishAnswer(false, 'none'); window.scrollTo(0, 0); break;
      case 'override': overrideCorrect(); break;
      case 'next': session.p++; nextItem(); render(); window.scrollTo(0, 0); break;
      case 'weak-one': startSession([el.getAttribute('data-id')], 'drill', 'ドリル', '#/'); break;
      case 'weak-all':
        var ws = D.cards.filter(function (k) { var s = S.cards[k.id]; return s && s.ng > 0; })
          .sort(function (a, b) { return S.cards[b.id].ng - S.cards[a.id].ng; }).slice(0, S.settings.n).map(function (k) { return k.id; });
        startSession(ws, 'drill', 'ドリル', '#/'); break;
      case 'chapter-drill':
        var rid = el.getAttribute('data-id'); S.read[rid] = true; save();
        var r = D.reading.filter(function (x) { return x.id === rid; })[0];
        startSession(shuffle((r.cards || []).slice()), 'drill', '第' + r.no + '章の問題', '#/read/' + rid); break;
      case 'mark-read': S.read[el.getAttribute('data-id')] = true; save(); break;
      case 'rc-show':
        var box = document.getElementById('recall'), ri = +box.getAttribute('data-i');
        var rr = D.reading.filter(function (x) { return x.id === route()[1]; })[0];
        var card = D.byId[rr.recall[ri]];
        var a = document.getElementById('rc-a'); a.textContent = '答え：' + answerText(recallQ(card).q) + '\n' + card.fact; a.classList.remove('hidden'); break;
      case 'rc-next':
        var box2 = document.getElementById('recall'), n = +box2.getAttribute('data-i') + 1;
        var rr2 = D.reading.filter(function (x) { return x.id === route()[1]; })[0];
        if (n >= rr2.recall.length) n = 0;
        box2.setAttribute('data-i', n);
        document.getElementById('rc-q').textContent = recallQ(D.byId[rr2.recall[n]]).text;
        document.getElementById('rc-n').textContent = (n + 1) + ' / ' + rr2.recall.length;
        document.getElementById('rc-a').classList.add('hidden'); break;
      case 'mock-begin': mockRun.started = true; mockRun.end = now() + 20 * 60000; render(); startTimer(); break;
      case 'mpick':
        var key = el.getAttribute('data-k'), mi = +el.getAttribute('data-i');
        var sq = key.split('-'), q = mockRun.m.sections[+sq[0]].qs[+sq[1]];
        if (q.t === 'mc') mockRun.resp[key] = mockRun.resp[key] === mi ? null : mi;
        else { var arr = mockRun.resp[key] || []; var j = arr.indexOf(mi); if (j >= 0) arr.splice(j, 1); else arr.push(mi); mockRun.resp[key] = arr; }
        // 部分更新（スクロール位置を保つ）
        var opts = el.parentNode.querySelectorAll('.opt');
        for (var t = 0; t < opts.length; t++) {
          var on = q.t === 'mc' ? mockRun.resp[key] === t : (mockRun.resp[key] || []).indexOf(t) >= 0;
          opts[t].setAttribute('aria-pressed', on);
        }
        break;
      case 'mock-submit': submitMock(false); break;
      case 'mock-retry': var mid = mockRun.id; mockRun = null; startMock(mid); render(); window.scrollTo(0, 0); break;
      case 'ftab': finalTab = el.getAttribute('data-v'); render(); break;
      case 'fhide': finalHide = el.getAttribute('data-v') === '1'; revealed = {}; render(); break;
      case 'freveal': revealed[el.getAttribute('data-k')] = true; render(); break;
      case 'final-loop': startSession(finalIds().slice(0, 40), 'final', '試験直前', '#/final'); break;
      case 'reset':
        if (window.confirm('学習記録をすべて消します。よろしいですか？')) { S = defaultState(); save(); applyTheme(); go('#/'); }
        break;
    }
  });
  app.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'ans' && session && session.cur) {
      session.cur.resp = el.value;
      var can = hasResp(session.cur.q, el.value);
      var bs = app.querySelectorAll('[data-act="submit"]');
      for (var i = 0; i < bs.length; i++) bs[i].disabled = !can;
    }
    if (el.getAttribute('data-act') === 'minput' && mockRun) mockRun.resp[el.getAttribute('data-k')] = el.value;
  });
  app.addEventListener('change', function (e) {
    var el = e.target, act = el.getAttribute('data-act');
    if (act === 'n') { S.settings.n = +el.value; save(); render(); }
    if (act === 'recall') { S.settings.recall = el.checked; save(); }
    if (act === 'theme') { S.settings.theme = el.value; save(); applyTheme(); }
  });
  app.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'ans' && session && session.cur && hasResp(session.cur.q, e.target.value)) {
      e.preventDefault(); session.cur.resp = e.target.value; submit('sure'); window.scrollTo(0, 0);
    }
  });

  /* ---------------- boot ---------------- */
  function load(name) {
    return fetch('data/' + name + '.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(name + ': ' + r.status);
      return r.json();
    });
  }
  // 更新の検知: 画面に戻ったとき（ホーム画面アプリの再開を含む）にデータの版を確かめ、新しければ知らせる
  function checkUpdate() {
    if (!D.version) return;
    fetch('data/cards.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || j.version === D.version || document.getElementById('updbar')) return;
      var bar = document.createElement('div');
      bar.id = 'updbar';
      bar.className = 'updbar';
      bar.innerHTML = '<span>新しい内容があります</span><button type="button">更新</button>';
      bar.querySelector('button').addEventListener('click', function () { location.reload(); });
      document.body.appendChild(bar);
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkUpdate(); });
  setInterval(checkUpdate, 10 * 60 * 1000);

  if ('serviceWorker' in navigator) {
    // 新しい版の sw.js が有効になったら、一度だけ読み込み直して最新を表示する
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(function () {});
  }

  applyTheme();
  Promise.all([load('cards'), load('mocks'), load('reading'), load('hayami')]).then(function (res) {
    D.version = res[0].version;
    D.cards = res[0].cards;
    D.cards.forEach(function (c, i) { c.ord = i; D.byId[c.id] = c; });
    D.mocks = res[1].mocks;
    D.reading = res[2].chapters;
    D.hayami = res[3].groups;
    render();
  }).catch(function (err) {
    app.innerHTML = '<div class="loading">データを読み込めませんでした。ページを再読み込みしてください。<br><span class="xs">' + esc(err.message) + '</span></div>';
  });
})();
