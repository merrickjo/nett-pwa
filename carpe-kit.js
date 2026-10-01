/* carpe-kit v2.0.0 — companion to carpe-kit.css (the bar behaviour). Classic script, no build step.
   Include it with a deferred script tag (src="carpe-kit.js", defer). This
   comment avoids a literal closing script tag so the file can be inlined.
   It does exactly two jobs and nothing else:
     1. measures the rendered .gn height and writes it to --gn-h, so
        clearance never depends on hand-maths (the tasks 4.0.3 lesson);
     2. toggles html.gn-kbd while a text field is focused on a touch
        device, so the bar never sits on top of what you are typing.
   Routing stays in each app. NavKit.setActive(id) is an optional helper. */
(function () {
  'use strict';
  var root = document.documentElement;

  function measure(nav) {
    var h = nav.getBoundingClientRect().height;
    if (h > 0) root.style.setProperty('--gn-h', Math.round(h) + 'px');
  }

  function watchHeight() {
    var nav = document.querySelector('.gn');
    if (!nav) return;
    measure(nav);
    if ('ResizeObserver' in window) {
      new ResizeObserver(function () { measure(nav); }).observe(nav);
    }
  }

  /* Keyboard detection. Two signals, either one is enough:
     - a text-entry element has focus on a coarse pointer (works on
       Android with interactive-widget=resizes-content, where the
       visual viewport does NOT shrink), or
     - the visual viewport is much shorter than the layout viewport (iOS). */
  var TEXTY = /^(text|search|email|url|tel|password|number|date|time|datetime-local)$/;
  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  function isTextEntry(el) {
    if (!el) return false;
    if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && TEXTY.test(el.type || 'text');
  }

  function updateKbd() {
    var vv = window.visualViewport;
    var shrunk = vv ? (window.innerHeight - vv.height) > 150 : false;
    var typing = coarse && isTextEntry(document.activeElement);
    root.classList.toggle('gn-kbd', shrunk || typing);
  }

  function watchKeyboard() {
    document.addEventListener('focusin', updateKbd);
    document.addEventListener('focusout', function () { setTimeout(updateKbd, 50); });
    if (window.visualViewport) visualViewport.addEventListener('resize', updateKbd);
  }

  /* Optional: mark the item whose data-gn matches id as current. */
  function setActive(id) {
    var items = document.querySelectorAll('.gn .gn-item[data-gn]');
    for (var i = 0; i < items.length; i++) {
      var on = items[i].getAttribute('data-gn') === id;
      if (on) items[i].setAttribute('aria-current', 'page');
      else items[i].removeAttribute('aria-current');
    }
  }

  function init() { watchHeight(); watchKeyboard(); updateKbd(); }

  window.NavKit = { version: '2.0.0', setActive: setActive, remeasure: watchHeight };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
