/* =========================================================
   «Отвес» — расчёт сметы для квиза.
   ОДИН файл на сайт и сервер:
   - в браузере подключается обычным <script> и даёт window.OtvesEstimate;
   - Cloudflare Worker импортирует его (worker/index.js) и пересчитывает
     смету сам, не доверяя цифрам из браузера.

   Как поменять цены: правьте только объект RATES ниже.
   Все суммы в рублях, «min/max» — нижняя и верхняя граница вилки.
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OtvesEstimate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Варианты ответов (код -> подпись) ---------- */
  var OPTIONS = {
    property: { new: 'Новостройка без отделки', old: 'Вторичное жильё' },
    level: { cosmetic: 'Косметический', capital: 'Капитальный', design: 'Дизайнерский' },
    baths: { 1: 'Один санузел', 2: 'Два санузла', 3: 'Три санузла' },
    demolition: { none: 'Не нужен', partial: 'Частичный', full: 'Полный, до бетона' },
    project: { none: 'Не нужен / есть свой', tech: 'Технический проект', full: 'Полный дизайн-проект' },
    start: { asap: 'Как можно скорее', month: 'В течение месяца', later: 'Через 2–3 месяца', unknown: 'Пока не знаю' },
    contact: { call: 'Звонок', telegram: 'Telegram', whatsapp: 'WhatsApp' }
  };

  var AREA_MIN = 20;
  var AREA_MAX = 250;

  /* ---------- Цены (вымышленные, для демо) ---------- */
  var RATES = {
    // Отделочные работы + черновые материалы, ₽ за м² площади пола
    works: { cosmetic: [7000, 9500], capital: [16000, 21000], design: [26000, 34000] },
    // Во вторичке стены и полы обычно кривее — выравнивание дороже
    oldK: 1.08,
    // Квартира меньше 35 м² — та же логистика и бригада, поэтому м² дороже
    smallArea: 35, smallK: 1.1,
    // Один санузел под ключ: гидроизоляция, плитка, сантехника, монтаж
    bath: { cosmetic: [90000, 130000], capital: [220000, 290000], design: [320000, 420000] },
    // Демонтаж (только вторичка), ₽ за м²
    demolition: { none: [0, 0], partial: [900, 1200], full: [1800, 2400] },
    // Проект, ₽ за м², и минимальная стоимость
    project: { none: [0, 0], tech: [1200, 1500], full: [3000, 3800] },
    projectMin: { none: 0, tech: 60000, full: 150000 },
    // Вывоз мусора, подъём материалов, финальный клининг
    service: [350, 450], serviceMin: 25000
  };

  // Срок в неделях: база + площадь / темп
  var WEEKS = {
    base: { cosmetic: 3, capital: 6, design: 9 },
    perM2: { cosmetic: 25, capital: 12, design: 10 }, // сколько м² бригада проходит за неделю сверх базы
    extraBath: 1.5,
    demolition: { none: 0, partial: 0.5, full: 1 },
    project: { none: 0, tech: 1.5, full: 3 }
  };

  /* ---------- Проверка ответов ---------- */
  // Возвращает { ok, errors: {поле: текст}, value: очищенные ответы }
  function normalize(a) {
    a = a || {};
    var v = {}, errors = {};
    function pick(key) {
      var x = a[key] == null ? '' : String(a[key]);
      if (Object.prototype.hasOwnProperty.call(OPTIONS[key], x)) v[key] = x;
      else errors[key] = 'Выберите вариант';
    }
    pick('property');
    var area = Math.round(Number(a.area));
    if (!isFinite(area) || area < AREA_MIN || area > AREA_MAX) errors.area = 'Площадь от ' + AREA_MIN + ' до ' + AREA_MAX + ' м²';
    else v.area = area;
    pick('level');
    // В новостройке без отделки нечего «освежать»: нужен полный цикл работ
    if (v.property === 'new' && v.level === 'cosmetic') errors.level = 'Для новостройки без отделки косметический ремонт не подходит';
    pick('baths');
    // В новостройке без отделки демонтировать нечего — шаг пропускается
    if (v.property === 'new') v.demolition = 'none';
    else pick('demolition');
    pick('project');
    pick('start');
    return { ok: Object.keys(errors).length === 0, errors: errors, value: v };
  }

  /* ---------- Расчёт ---------- */
  function round1000(n) { return Math.round(n / 1000) * 1000; }
  function range(pair, k, min) {
    return [round1000(Math.max(pair[0] * k, min || 0)), round1000(Math.max(pair[1] * k, min || 0))];
  }
  function roundHalf(n) { return Math.round(n * 2) / 2; }

  // Принимает ответы квиза, возвращает смету или null, если ответы неполные
  function calc(answers) {
    var n = normalize(answers);
    if (!n.ok) return null;
    var a = n.value;
    var areaK = a.area * (a.property === 'old' ? RATES.oldK : 1) * (a.area < RATES.smallArea ? RATES.smallK : 1);
    var baths = Number(a.baths);

    var lines = [
      { id: 'works', label: 'Отделочные работы и черновые материалы', range: range(RATES.works[a.level], areaK) },
      { id: 'baths', label: baths === 1 ? 'Санузел под ключ' : 'Санузлы под ключ (' + baths + ')', range: range(RATES.bath[a.level], baths) }
    ];
    if (a.demolition !== 'none') {
      lines.push({ id: 'demolition', label: 'Демонтаж: ' + OPTIONS.demolition[a.demolition].toLowerCase(), range: range(RATES.demolition[a.demolition], a.area) });
    }
    if (a.project !== 'none') {
      lines.push({ id: 'project', label: OPTIONS.project[a.project], range: range(RATES.project[a.project], a.area, RATES.projectMin[a.project]) });
    }
    lines.push({ id: 'service', label: 'Вывоз мусора, подъём материалов, уборка', range: range(RATES.service, a.area, RATES.serviceMin) });

    var total = lines.reduce(function (s, l) { return [s[0] + l.range[0], s[1] + l.range[1]]; }, [0, 0]);

    var w = WEEKS.base[a.level] + a.area / WEEKS.perM2[a.level] +
      (baths - 1) * WEEKS.extraBath + WEEKS.demolition[a.demolition] + WEEKS.project[a.project];
    var weeks = [Math.max(2, Math.round(w * 0.9)), Math.max(3, Math.round(w * 1.15))];

    return {
      answers: a,
      lines: lines.map(function (l) { return { id: l.id, label: l.label, min: l.range[0], max: l.range[1] }; }),
      total: { min: total[0], max: total[1] },
      // Цена за м² — для сравнения с конкурентами, округляем до сотен
      perM2: { min: Math.round(total[0] / a.area / 100) * 100, max: Math.round(total[1] / a.area / 100) * 100 },
      weeks: { min: weeks[0], max: weeks[1] },
      // Срок проекта отдельно: дизайнеру нужно время до начала работ
      projectWeeks: roundHalf(WEEKS.project[a.project])
    };
  }

  // 1234567 -> «1 234 567 ₽» (неразрывные пробелы)
  function rub(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

  return { OPTIONS: OPTIONS, RATES: RATES, WEEKS: WEEKS, AREA_MIN: AREA_MIN, AREA_MAX: AREA_MAX, normalize: normalize, calc: calc, rub: rub };
});
