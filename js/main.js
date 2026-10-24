/* =========================================================
   «Отвес» — скрипты сайта
   Без фреймворков. Каждый блок — отдельная функция init*().
   Расчёт сметы живёт в js/estimate.js (общий с сервером).
   ========================================================= */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var E = window.OtvesEstimate;

  // Адрес Cloudflare Worker, который сохраняет заявки и пересылает их в Telegram (см. worker/).
  // Пустая строка — демо-режим: всё считается в браузере, заявки никуда не уходят.
  var LEAD_ENDPOINT = '';

  // Номер счётчика Яндекс Метрики (см. <head>). Цели: quiz_start, quiz_result, lead_quiz, lead_callback
  var METRIKA_ID = 0;
  function goal(name) {
    try { if (METRIKA_ID && typeof window.ym === 'function') window.ym(METRIKA_ID, 'reachGoal', name); } catch (e) { /* без метрики сайт работает */ }
  }

  var PHONE_TEXT = '+7 (495) 241-63-08';

  // Отправка заявки. Кнопка блокируется, пока идёт запрос; при ошибке — текст в errorEl.
  function sendLead(form, data, button, errorEl) {
    var trap = form.querySelector('[name="website"]');
    data.website = trap ? trap.value : '';
    data.page = location.href.split('#')[0];
    if (!LEAD_ENDPOINT) return Promise.resolve({ demo: true });
    var label = button.innerHTML;
    button.disabled = true;
    button.textContent = 'Отправляем…';
    errorEl.textContent = '';
    return fetch(LEAD_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (json) {
        if (!r.ok || json.ok === false) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return json;
      });
    }).catch(function (err) {
      errorEl.textContent = err.status === 429
        ? 'Слишком много заявок с вашего адреса. Позвоните нам: ' + PHONE_TEXT + '.'
        : 'Не получилось отправить заявку. Проверьте интернет или позвоните: ' + PHONE_TEXT + '.';
      throw err;
    }).finally(function () {
      button.disabled = false;
      button.innerHTML = label;
    });
  }

  // Безопасная работа с хранилищами: в приватном режиме они могут бросать исключения
  function storageGet(store, key) {
    try { return JSON.parse(window[store].getItem(key)); } catch (e) { return null; }
  }
  function storageSet(store, key, value) {
    try { window[store].setItem(key, JSON.stringify(value)); } catch (e) { /* ничего страшного */ }
  }
  function storageDel(store, key) {
    try { window[store].removeItem(key); } catch (e) { /* ничего страшного */ }
  }

  /* ---------- Утилиты форматирования ---------- */
  var rub = E ? E.rub : function (n) { return n + ' ₽'; };
  // 1 173 000 -> «1,17 млн» — для компактной строки на телефоне
  function mln(n) { return (Math.round(n / 10000) / 100).toString().replace('.', ',') + ' млн'; }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function weeksText(w) { return w.min + '–' + w.max + ' ' + plural(w.max, 'неделя', 'недели', 'недель'); }

  /* ---------- Шапка и меню ---------- */
  function initHeader() {
    var header = $('#header');
    var burger = $('.burger');
    var menu = $('#mobile-menu');

    function onScroll() { header.classList.toggle('is-scrolled', window.scrollY > 10); }
    requestAnimationFrame(onScroll); // не читаем вёрстку синхронно при загрузке
    window.addEventListener('scroll', onScroll, { passive: true });

    function setMenu(open) {
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      menu.hidden = !open;
      document.body.classList.toggle('menu-open', open);
    }
    burger.addEventListener('click', function () {
      setMenu(burger.getAttribute('aria-expanded') !== 'true');
    });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) { setMenu(false); burger.focus(); }
    });
    window.matchMedia('(min-width: 1100px)').addEventListener('change', function () { setMenu(false); });

    // Подсветка пункта меню текущей секции
    if (!('IntersectionObserver' in window)) return;
    var links = $$('.nav a');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + en.target.id); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(function (a) { var s = $(a.getAttribute('href')); if (s) io.observe(s); });
  }

  /* ---------- Появление блоков при прокрутке ---------- */
  function initReveal() {
    var items = $$('.reveal');
    if (!('IntersectionObserver' in window) || reduceMotion) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Телефон: маска и проверка полей ---------- */
  function phoneDigits(v) {
    var d = String(v).replace(/\D/g, '');
    // Код страны (+7 или 8 по привычке) в «номер» не входит
    if (d[0] === '8' || d[0] === '7') d = d.slice(1);
    return d.slice(0, 10);
  }
  function formatPhone(d) {
    var out = '+7';
    if (d.length) out += ' (' + d.slice(0, 3);
    if (d.length >= 3) out += ')';
    if (d.length > 3) out += ' ' + d.slice(3, 6);
    if (d.length > 6) out += '-' + d.slice(6, 8);
    if (d.length > 8) out += '-' + d.slice(8, 10);
    return out;
  }
  function initPhoneMask(input) {
    var prev = '';
    input.addEventListener('focus', function () { if (!input.value) input.value = '+7 ('; });
    input.addEventListener('blur', function () { if (phoneDigits(input.value).length === 0) input.value = ''; });
    input.addEventListener('input', function (e) {
      var all = input.value.replace(/\D/g, '');
      var d;
      if (all.length > 11) {
        // Вставили номер целиком поверх «+7 (»: «89161234567» или «+7 916 123-45-67»
        d = all.slice(1);
        if (d.length === 11 && (d[0] === '7' || d[0] === '8')) d = d.slice(1);
        d = d.slice(0, 10);
      } else {
        d = phoneDigits(input.value);
      }
      // Набрали «8» первой цифрой по привычке — это код страны, он уже стоит
      if (!phoneDigits(prev) && d === '8') d = '';
      // Стёрли скобку или дефис — стираем и цифру перед ними
      if (e.inputType === 'deleteContentBackward' && d === phoneDigits(prev)) d = d.slice(0, -1);
      input.value = d.length ? formatPhone(d) : (document.activeElement === input ? '+7 (' : '');
      prev = input.value;
    });
  }

  var validators = {
    name: function (v) {
      v = v.trim();
      if (!v) return 'Введите имя';
      if (v.length < 2) return 'Имя слишком короткое';
      if (!/^[A-Za-zА-Яа-яЁё\s'-]+$/.test(v)) return 'Используйте только буквы';
      return '';
    },
    phone: function (v) {
      var d = phoneDigits(v);
      if (!d.length) return 'Введите телефон';
      if (d.length < 10) return 'Введите телефон полностью';
      return '';
    },
    consent: function (v, el) { return el.checked ? '' : 'Без согласия мы не сможем принять заявку'; }
  };

  // Проверяет одно поле и показывает ошибку под ним. Возвращает true, если всё хорошо.
  function validateField(el) {
    var err = validators[el.dataset.validate](el.value, el);
    var wrap = el.closest('.field, .consent');
    var box = $('.field__error, .consent__error', wrap);
    wrap.classList.toggle('is-invalid', !!err);
    wrap.classList.toggle('is-valid', !err && el.type !== 'checkbox');
    el.setAttribute('aria-invalid', String(!!err));
    box.textContent = err;
    return !err;
  }

  function initFieldValidation(form) {
    $$('[data-mask="phone"]', form).forEach(initPhoneMask);
    $$('[data-validate]', form).forEach(function (el) {
      // Проверяем «на лету», но только после первого ухода с поля — чтобы не ругаться на полуслове
      el.addEventListener('blur', function () { if (el.type !== 'checkbox') { el.dataset.touched = '1'; validateField(el); } });
      el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', function () {
        if (el.dataset.touched || el.type === 'checkbox') validateField(el);
      });
    });
  }

  // Проверить все поля; фокус на первое ошибочное
  function validateAll(root) {
    var firstBad = null;
    $$('[data-validate]', root).forEach(function (el) {
      el.dataset.touched = '1';
      if (!validateField(el) && !firstBad) firstBad = el;
    });
    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  function demoId() { return 'Д-' + String(Date.now()).slice(-4); }

  /* ---------- Квиз-калькулятор ---------- */
  function initQuiz() {
    var form = $('#quiz');
    if (!form || !E) return;
    var STORE = 'otves-quiz';
    var ALL_STEPS = ['property', 'area', 'level', 'baths', 'demolition', 'project', 'start', 'result'];
    var STEP_NAMES = {
      property: 'тип квартиры', area: 'площадь', level: 'тип ремонта', baths: 'санузлы',
      demolition: 'демонтаж', project: 'дизайн-проект', start: 'сроки начала', result: 'итог и запись на замер'
    };
    var fieldsets = {};
    $$('.step', form).forEach(function (fs) { fieldsets[fs.dataset.step] = fs; });

    var counter = $('#quiz-counter'), bar = $('#quiz-bar'), status = $('#quiz-status');
    var back = $('#quiz-back'), next = $('#quiz-next'), submit = $('#quiz-submit');
    var errorBox = $('#quiz-error'), live = $('#quiz-live');
    var areaInput = $('#area-input'), areaRange = $('#area-range');
    var success = $('#quiz-success');
    var aside = $('.estimate');

    var saved = storageGet('sessionStorage', STORE) || {};
    var answers = saved.answers || {};
    var current = ALL_STEPS.indexOf(saved.step) > -1 ? saved.step : 'property';
    var started = !!saved.started;
    var lastPointer = 0;

    function steps() {
      return ALL_STEPS.filter(function (s) { return !(s === 'demolition' && answers.property === 'new'); });
    }
    function save() { storageSet('sessionStorage', STORE, { answers: answers, step: current, started: started }); }

    // Расчёт «на лету»: недостающие ответы подставляем по умолчанию
    function liveEstimate() {
      if (!answers.property || !answers.area || !answers.level) return null;
      return E.calc({
        property: answers.property, area: answers.area, level: answers.level,
        baths: answers.baths || '1', demolition: answers.demolition || 'none',
        project: answers.project || 'none', start: answers.start || 'unknown'
      });
    }

    /* Восстановление ответов в форме */
    function restore() {
      Object.keys(answers).forEach(function (k) {
        if (k === 'area') return;
        var input = form.querySelector('input[name="' + k + '"][value="' + answers[k] + '"]');
        if (input) input.checked = true;
      });
      setArea(answers.area || 54, !answers.area);
    }

    /* Площадь: поле, ползунок и быстрые кнопки показывают одно и то же */
    function setArea(v, silent) {
      v = Math.round(Number(v));
      var ok = isFinite(v) && v >= E.AREA_MIN && v <= E.AREA_MAX;
      if (ok) {
        areaRange.value = v;
        areaRange.style.setProperty('--fill', ((v - E.AREA_MIN) / (E.AREA_MAX - E.AREA_MIN) * 100) + '%');
        areaRange.setAttribute('aria-valuetext', v + ' ' + plural(v, 'квадратный метр', 'квадратных метра', 'квадратных метров'));
        if (document.activeElement !== areaInput) areaInput.value = v;
        if (!silent) answers.area = v;
      }
      $$('.chip', form).forEach(function (c) { c.setAttribute('aria-pressed', String(+c.dataset.area === v)); });
      return ok;
    }
    areaRange.addEventListener('input', function () { areaInput.value = areaRange.value; setArea(areaRange.value); clearAreaError(); update(); });
    areaInput.addEventListener('input', function () {
      if (setArea(areaInput.value)) clearAreaError(); else delete answers.area;
      update();
    });
    areaInput.addEventListener('blur', function () {
      // Подрезаем к допустимому диапазону, чтобы не было «0 м²» или «5000 м²»
      var v = Math.round(Number(areaInput.value));
      if (areaInput.value !== '' && isFinite(v)) { v = Math.min(E.AREA_MAX, Math.max(E.AREA_MIN, v)); areaInput.value = v; setArea(v); clearAreaError(); update(); }
    });
    $$('.chip', form).forEach(function (chip) {
      chip.addEventListener('click', function () { areaInput.value = chip.dataset.area; setArea(chip.dataset.area); clearAreaError(); update(); });
    });
    function clearAreaError() { $('#area-error').textContent = ''; areaInput.removeAttribute('aria-invalid'); }

    /* Ответы-радиокнопки */
    form.addEventListener('pointerdown', function () { lastPointer = Date.now(); });
    $$('.step input[type="radio"]', form).forEach(function (input) {
      input.addEventListener('change', function () {
        answers[input.name] = input.value;
        if (!started) { started = true; goal('quiz_start'); }
        if (input.name === 'property') applyPropertyRules();
        errorBox.textContent = '';
        update();
        // Кликнули мышью или пальцем — сразу на следующий шаг. С клавиатуры стрелки
        // перебирают варианты, поэтому там переходим только по кнопке «Далее».
        if (Date.now() - lastPointer < 800) setTimeout(function () { if (current === input.name) go(1); }, reduceMotion ? 0 : 260);
      });
    });

    // В новостройке без отделки косметический ремонт невозможен, а демонтаж не нужен
    function applyPropertyRules() {
      var cosmetic = form.querySelector('input[name="level"][value="cosmetic"]');
      var isNew = answers.property === 'new';
      cosmetic.disabled = isNew;
      $('#cosmetic-note').textContent = isNew ? 'В новостройке без отделки нужен полный цикл — от стяжки до покраски.' : '';
      if (isNew && answers.level === 'cosmetic') { cosmetic.checked = false; delete answers.level; }
      if (isNew) delete answers.demolition;
      $('[data-sum-row="demolition"]', aside).hidden = isNew;
    }

    /* Сводка справа и строка «сейчас» на телефоне */
    function update() {
      var opts = E.OPTIONS;
      $$('[data-sum]', aside).forEach(function (dd) {
        var k = dd.dataset.sum, v = answers[k];
        if (k === 'area') dd.textContent = v ? v + ' м²' : '—';
        else dd.textContent = v ? opts[k][v] : '—';
      });
      var est = liveEstimate();
      var total = $('#estimate-total');
      if (est) {
        var txt = rub(est.total.min) + ' – ' + rub(est.total.max);
        if (total.textContent !== txt) {
          total.textContent = txt;
          aside.classList.remove('is-bump'); void aside.offsetWidth; aside.classList.add('is-bump');
        }
        total.classList.remove('is-empty');
        $('#estimate-label').textContent = current === 'result' ? 'Стоимость' : 'Стоимость, предварительно';
        live.innerHTML = 'Сейчас: <b>' + mln(est.total.min) + ' – ' + mln(est.total.max) + ' ₽</b>';
      } else {
        total.textContent = 'Ответьте на 3 вопроса';
        total.classList.add('is-empty');
        live.textContent = '';
      }
      save();
    }

    /* Итоговый экран */
    function renderResult(est) {
      $('#result-total').innerHTML = '<small>Работы и черновые материалы</small>' + rub(est.total.min) + ' – ' + rub(est.total.max);
      $('#result-m2').textContent = rub(est.perM2.min).replace(' ₽', '') + '–' + rub(est.perM2.max);
      $('#result-weeks').textContent = weeksText(est.weeks);
      $('#result-lines').innerHTML = est.lines.map(function (l) {
        return '<tr><td>' + l.label + '</td><td>' + (l.min === l.max ? rub(l.min) : rub(l.min) + ' – ' + rub(l.max)) + '</td></tr>';
      }).join('');
    }

    function validateStep(step) {
      if (step === 'area') {
        if (!answers.area) {
          $('#area-error').textContent = 'Укажите площадь от ' + E.AREA_MIN + ' до ' + E.AREA_MAX + ' м²';
          areaInput.setAttribute('aria-invalid', 'true');
          areaInput.focus();
          return false;
        }
        return true;
      }
      if (step === 'result') return true;
      if (!answers[step]) {
        errorBox.textContent = 'Выберите один из вариантов';
        var first = fieldsets[step].querySelector('input:not(:disabled)');
        if (first) first.focus();
        return false;
      }
      return true;
    }

    function show(step, focus) {
      current = step;
      var list = steps();
      var i = list.indexOf(step);
      if (i < 0) { current = step = 'property'; i = 0; }
      ALL_STEPS.forEach(function (s) { fieldsets[s].hidden = s !== step; });
      var fs = fieldsets[step];
      if (!reduceMotion) { fs.classList.remove('is-entering'); void fs.offsetWidth; fs.classList.add('is-entering'); }

      var questions = list.length - 1;
      var isResult = step === 'result';
      counter.textContent = isResult ? 'Готово' : 'Шаг ' + (i + 1) + ' из ' + questions;
      bar.style.width = (isResult ? 100 : (i / questions) * 100) + '%';
      status.textContent = isResult ? 'Расчёт готов: итог и запись на замер' : 'Шаг ' + (i + 1) + ' из ' + questions + ': ' + STEP_NAMES[step];
      back.hidden = i === 0;
      next.hidden = isResult;
      submit.hidden = !isResult;
      form.classList.toggle('is-result', isResult);
      errorBox.textContent = '';
      if (step === 'area' && !answers.area) setArea(areaInput.value || 54);
      if (isResult) {
        var est = E.calc(answers);
        if (!est) { show(firstMissing() || 'property', true); return; }
        renderResult(est);
        goal('quiz_result');
      }
      update();

      if (focus) {
        var legend = fs.querySelector('legend');
        legend.setAttribute('tabindex', '-1');
        legend.focus({ preventScroll: true });
        // Если верх квиза ушёл за экран (телефон), прокручиваем к нему
        var top = form.getBoundingClientRect().top;
        if (top < 0 || top > window.innerHeight * 0.6) {
          form.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        }
      }
    }

    function firstMissing() {
      var list = steps();
      for (var i = 0; i < list.length - 1; i++) if (!answers[list[i]]) return list[i];
      return null;
    }

    function go(dir) {
      var list = steps();
      var i = list.indexOf(current);
      if (dir > 0 && !validateStep(current)) return;
      var to = list[Math.max(0, Math.min(list.length - 1, i + dir))];
      if (to !== current) show(to, true);
    }
    next.addEventListener('click', function () { go(1); });
    back.addEventListener('click', function () { go(-1); });
    // Enter в поле площади — как «Далее», а не отправка формы
    areaInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(1); } });

    /* Способ связи меняет подсказку */
    var hints = {
      call: 'Позвоним с 9:00 до 21:00 в течение 30 минут.',
      telegram: 'Напишем в Telegram на этот номер. Проверьте, что он привязан к аккаунту.',
      whatsapp: 'Напишем в WhatsApp на этот номер в течение 30 минут.'
    };
    $$('input[name="contact"]', form).forEach(function (r) {
      r.addEventListener('change', function () { $('#contact-hint').textContent = hints[r.value]; });
    });

    initFieldValidation(fieldsets.result);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (current !== 'result') { go(1); return; }
      if (!validateAll(fieldsets.result)) return;
      var est = E.calc(answers);
      var contact = form.querySelector('input[name="contact"]:checked').value;
      var data = {
        type: 'quiz',
        answers: answers,
        name: $('#q-name').value.trim(),
        phone: $('#q-phone').value,
        contact: contact,
        consent: true
      };
      sendLead(form, data, submit, errorBox).then(function (res) {
        // Сервер пересчитывает смету сам — если ответ пришёл, показываем его цифры
        var total = res && res.estimate ? res.estimate.total : est.total;
        $('#success-id').textContent = '№ ' + (res && res.id ? res.id : demoId());
        $('#success-sum').textContent = 'Ваш расчёт: ' + rub(total.min) + ' – ' + rub(total.max) + '. Инженер уточнит его на замере.';
        $('#success-text').textContent = contact === 'call'
          ? 'Инженер позвонит в течение 30 минут (Пн–Сб 9:00–21:00) и предложит время замера.'
          : 'Инженер напишет в ' + E.OPTIONS.contact[contact] + ' в течение 30 минут (Пн–Сб 9:00–21:00) и предложит время замера.';
        if (res && res.demo) $('#success-text').textContent += ' Это демо-сайт: заявка никуда не отправлена.';
        form.classList.add('is-done');
        success.hidden = false;
        success.focus();
        goal('lead_quiz');
        storageDel('sessionStorage', STORE);
      }).catch(function () { /* текст ошибки уже показан */ });
    });

    $('#quiz-again').addEventListener('click', function () {
      answers = {}; started = false;
      $$('.step input[type="radio"]', form).forEach(function (r) { r.checked = false; });
      form.classList.remove('is-done');
      success.hidden = true;
      applyPropertyRules();
      setArea(54, true);
      show('property', true);
    });

    restore();
    applyPropertyRules();
    show(current, false);
  }

  /* ---------- Слайдер «до/после» ---------- */
  function initBeforeAfter() {
    $$('[data-ba]').forEach(function (root, n) {
      var pos = 50;
      var handle = document.createElement('div');
      handle.className = 'ba__handle';
      handle.setAttribute('role', 'slider');
      handle.setAttribute('tabindex', '0');
      handle.setAttribute('aria-label', 'Сравнение «до» и «после», объект ' + (n + 1));
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', '100');
      handle.setAttribute('aria-orientation', 'horizontal');
      handle.innerHTML = '<span class="ba__knob" aria-hidden="true"><svg><use href="#i-arrow-left"/></svg><svg><use href="#i-arrow-right"/></svg></span>';
      root.appendChild(handle);

      function set(p) {
        pos = Math.max(0, Math.min(100, p));
        root.style.setProperty('--pos', pos + '%');
        handle.setAttribute('aria-valuenow', String(Math.round(pos)));
        handle.setAttribute('aria-valuetext', 'Слева «до» ' + Math.round(pos) + '%, справа «после» ' + Math.round(100 - pos) + '%');
      }
      function fromEvent(e) {
        var r = root.getBoundingClientRect();
        set((e.clientX - r.left) / r.width * 100);
      }
      set(50);

      // Клавиатура: стрелки по 5%, PageUp/PageDown по 20%, Home/End — края
      handle.addEventListener('keydown', function (e) {
        var step = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -20, PageUp: 20 }[e.key];
        if (step) set(pos + step);
        else if (e.key === 'Home') set(0);
        else if (e.key === 'End') set(100);
        else return;
        e.preventDefault();
      });

      // Мышь и палец. touch-action: pan-y — вертикальную прокрутку страницы отдаём браузеру,
      // горизонтальное движение двигает шторку.
      var startX = 0, startY = 0, dragging = false, decided = false, pointerId = null;
      root.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        startX = e.clientX; startY = e.clientY; pointerId = e.pointerId;
        dragging = true; decided = e.pointerType === 'mouse';
        if (decided) { e.preventDefault(); root.classList.add('is-dragging'); fromEvent(e); handle.focus({ preventScroll: true }); }
      });
      root.addEventListener('pointermove', function (e) {
        if (!dragging || e.pointerId !== pointerId) return;
        if (!decided) {
          var dx = Math.abs(e.clientX - startX), dy = Math.abs(e.clientY - startY);
          if (dx < 6 && dy < 6) return;
          decided = true;
          if (dy > dx) { dragging = false; return; }
          root.classList.add('is-dragging');
          try { root.setPointerCapture(e.pointerId); } catch (err) { /* старые браузеры */ }
        }
        fromEvent(e);
      });
      function end(e) {
        if (e.pointerId !== pointerId) return;
        // Короткое касание без движения — тоже переставляет шторку
        if (dragging && !decided && e.type === 'pointerup') fromEvent(e);
        dragging = false;
        root.classList.remove('is-dragging');
      }
      root.addEventListener('pointerup', end);
      root.addEventListener('pointercancel', end);
    });
  }

  /* ---------- Форма «Перезвоним» ---------- */
  function initCallback() {
    var form = $('#callback-form');
    if (!form) return;
    initFieldValidation(form);
    var button = $('button[type="submit"]', form);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!validateAll(form)) return;
      sendLead(form, {
        type: 'callback',
        name: $('#c-name').value.trim(),
        phone: $('#c-phone').value,
        comment: $('#c-comment').value.trim(),
        consent: true
      }, button, $('#callback-error')).then(function (res) {
        var s = $('#callback-success');
        if (res && res.demo) $('p', s).textContent += ' Это демо-сайт: заявка никуда не отправлена.';
        form.classList.add('is-done');
        s.hidden = false;
        s.focus();
        goal('lead_callback');
      }).catch(function () { /* текст ошибки уже показан */ });
    });
  }

  /* ---------- Липкая кнопка «Рассчитать стоимость» ---------- */
  function initStickyCta() {
    var cta = $('#sticky-cta');
    if (!cta || !('IntersectionObserver' in window)) return;
    var inCalc = false, inHero = true, inContacts = false;
    function update() { cta.classList.toggle('is-hidden', inCalc || inHero || inContacts); }
    new IntersectionObserver(function (en) { inCalc = en[0].isIntersecting; update(); }, { threshold: 0.05 }).observe($('#calc'));
    // На первом экране уже есть большая кнопка — дубль не показываем
    new IntersectionObserver(function (en) { inHero = en[0].isIntersecting; update(); }, { threshold: 0.35 }).observe($('.hero'));
    // У формы обратного звонка своя кнопка
    new IntersectionObserver(function (en) { inContacts = en[0].isIntersecting; update(); }, { threshold: 0.2 }).observe($('#callback-form'));
    update();
  }

  /* ---------- Cookie-баннер ---------- */
  function initCookie() {
    var box = $('#cookie');
    if (!box) return;
    var KEY = 'otves-cookie-ok';
    if (storageGet('localStorage', KEY) === 1) return;
    box.hidden = false;
    document.body.classList.add('has-cookie');
    $('#cookie-ok').addEventListener('click', function () {
      storageSet('localStorage', KEY, 1);
      box.hidden = true;
      document.body.classList.remove('has-cookie');
    });
  }

  /* ---------- Запуск ---------- */
  [initHeader, initReveal, initQuiz, initBeforeAfter, initCallback, initStickyCta, initCookie]
    .forEach(function (fn) {
      try { fn(); } catch (err) { console.error('[Отвес] ' + fn.name + ':', err); }
    });
})();
