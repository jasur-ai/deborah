/* Deborah admin shared (09/2026: audit/roster/teachers/users/email-cost
   sahifalarda yo'qolib ketgan umumiy funksiyalar — 404 + ReferenceError fix).
   Global scope: inline onclick handler'lar shu yerdan topadi. */
'use strict';

// S33.02: mobile drawer toggle — sidebar funksionalligi
function toggleAdminDrawer() {
  var open = document.body.classList.toggle('admin-nav-open');
  var btn = document.querySelector('.admin-nav-hamburger');
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}
