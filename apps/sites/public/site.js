/*
 * RestroPulse restaurant site: cart, checkout and order tracking.
 * Plain browser JS, no build step. Talks to the public storefront API
 * (/api/storefront/:slug/...). All restaurant text is set with textContent.
 */
(function () {
  'use strict';

  var bootEl = document.getElementById('rp-boot');
  if (!bootEl) return;
  var boot;
  try { boot = JSON.parse(bootEl.textContent || '{}'); } catch (e) { return; }
  var api = boot.apiUrl + '/api/storefront/' + encodeURIComponent(boot.slug);
  var cartKey = 'rp-cart-' + boot.slug;
  var ordersKey = 'rp-orders-' + boot.slug;
  var attemptKey = 'rp-attempt-' + boot.slug;

  var STATUS_TEXT = {
    PENDING_PAYMENT: 'Waiting for your payment',
    PAYMENT_FAILED: "Your payment didn't go through",
    RECEIVED: 'The restaurant has your order',
    PREPARING: 'Being prepared',
    READY: 'Ready',
    OUT_FOR_DELIVERY: 'On its way',
    COMPLETED: 'Done. Enjoy your meal!',
    CANCELLED: 'Cancelled'
  };
  var ACTIVE = ['PENDING_PAYMENT', 'RECEIVED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'];

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function rupees(n) {
    var v = Math.round(n * 100) / 100;
    return '₹' + (v % 1 === 0 ? v.toLocaleString('en-IN') : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  function load(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ } }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function request(method, path, body, headers) {
    var init = { method: method, headers: Object.assign({ Accept: 'application/json' }, headers || {}) };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch(api + path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (json) {
        if (!res.ok || !json.success) {
          var err = new Error(json.error || 'Something went wrong. Please try again.');
          err.status = res.status;
          err.code = json.code;
          throw err;
        }
        return json.data;
      });
    }, function () { throw new Error("We couldn't reach the restaurant. Check your connection and try again."); });
  }

  // ----- Cart -----

  var cart = load(cartKey, []);
  if (!Array.isArray(cart)) cart = [];

  function lineKey(l) { return [l.menuItemId, l.variantId || '', (l.addonIds || []).slice().sort().join('+')].join('|'); }
  function saveCart() { save(cartKey, cart); renderCart(); }
  function cartCount() { return cart.reduce(function (n, l) { return n + l.qty; }, 0); }

  function addFromCard(card) {
    var options = $('.rp-item-options', card);
    var variant = options && $('[data-variant]', options);
    var addons = options ? $all('[data-addon]:checked', options) : [];
    var unit = Number(card.getAttribute('data-price'));
    var label = card.getAttribute('data-name');
    var line = { menuItemId: card.getAttribute('data-item-id'), qty: 1, name: label };
    if (variant) {
      var opt = variant.options[variant.selectedIndex];
      line.variantId = variant.value;
      unit = Number(opt.getAttribute('data-price'));
      line.name = label + ' (' + opt.textContent.replace(/\s*\(.*\)$/, '') + ')';
    }
    if (addons.length) {
      line.addonIds = addons.map(function (a) { return a.value; });
      addons.forEach(function (a) { unit += Number(a.getAttribute('data-price')); });
      line.name += ' + ' + addons.map(function (a) { return a.parentNode.textContent.replace(/\s*\(\+.*\)$/, '').trim(); }).join(', ');
    }
    line.unitPrice = unit;
    var key = lineKey(line);
    var existing = cart.filter(function (l) { return lineKey(l) === key; })[0];
    if (existing) existing.qty = Math.min(50, existing.qty + 1); else cart.push(line);
    saveCart();
  }

  function renderCart() {
    var countEl = $('[data-cart-count]');
    var openBtn = $('[data-cart-open]');
    if (countEl) countEl.textContent = String(cartCount());
    if (openBtn) openBtn.hidden = cartCount() === 0;
    var list = $('[data-cart-lines]');
    if (!list) return;
    list.textContent = '';
    cart.forEach(function (l, i) {
      var li = document.createElement('li');
      var name = document.createElement('span');
      name.textContent = l.name;
      var qty = document.createElement('span');
      qty.className = 'rp-qty';
      var minus = document.createElement('button');
      minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', 'One less ' + l.name);
      minus.onclick = function () { l.qty -= 1; if (l.qty <= 0) cart.splice(i, 1); saveCart(); quote(); };
      var n = document.createElement('span'); n.textContent = String(l.qty);
      var plus = document.createElement('button');
      plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', 'One more ' + l.name);
      plus.onclick = function () { l.qty = Math.min(50, l.qty + 1); saveCart(); quote(); };
      qty.appendChild(minus); qty.appendChild(n); qty.appendChild(plus);
      var price = document.createElement('span');
      price.textContent = rupees(l.unitPrice * l.qty);
      li.appendChild(name); li.appendChild(qty); li.appendChild(price);
      list.appendChild(li);
    });
    var empty = $('[data-cart-empty]');
    if (empty) empty.hidden = cart.length > 0;
    var form = $('[data-checkout]');
    if (form) form.hidden = cart.length === 0;
  }

  // ----- Checkout -----

  var form = $('[data-checkout]');
  var dialog = $('#rp-cart');

  function field(name) { return form.elements.namedItem(name); }
  function value(name) { var el = field(name); return el && 'value' in el ? String(el.value).trim() : ''; }
  function checked(name) { var el = $('input[name="' + name + '"]:checked', form); return el ? el.value : ''; }
  function showError(root, msg) { var el = $('[data-error]', root); if (el) el.textContent = msg || ''; }

  function cartBody() {
    var body = {
      orderType: checked('orderType'),
      items: cart.map(function (l) {
        var item = { menuItemId: l.menuItemId, qty: l.qty };
        if (l.variantId) item.variantId = l.variantId;
        if (l.addonIds && l.addonIds.length) item.addonIds = l.addonIds;
        return item;
      })
    };
    if (value('offerCode')) body.offerCode = value('offerCode').toUpperCase();
    return body;
  }

  function renderTotals(el, totals, offer) {
    if (!el) return;
    el.textContent = '';
    var rows = [['Items', totals.subtotal]];
    if (totals.discount) rows.push([offer && offer.title ? offer.title : 'Discount', -totals.discount]);
    if (totals.deliveryFee) rows.push(['Delivery', totals.deliveryFee]);
    if (totals.deliveryDiscount) rows.push(['Delivery discount', -totals.deliveryDiscount]);
    if (totals.tax) rows.push(['Taxes', totals.tax]);
    rows.push(['Total', totals.total]);
    rows.forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = (r[1] < 0 ? '−' : '') + rupees(Math.abs(r[1]));
      el.appendChild(dt); el.appendChild(dd);
    });
  }

  var quoteTimer;
  function quote() {
    if (!form || !cart.length) return;
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(function () {
      request('POST', '/quote', cartBody()).then(function (data) {
        showError(form, '');
        renderTotals($('[data-totals]', form), data.totals, data.offer);
      }, function (err) {
        $('[data-totals]', form).textContent = '';
        showError(form, err.message);
      });
    }, 250);
  }

  function syncOrderType() {
    var type = checked('orderType');
    $all('[data-when]', form).forEach(function (el) { el.hidden = el.getAttribute('data-when') !== type; });
  }

  function rememberOrder(order, token) {
    var orders = load(ordersKey, {});
    orders[order.id] = token;
    save(ordersKey, orders);
  }

  function trackingUrl(orderId, token) {
    return (boot.basePath || '') + '/order/' + encodeURIComponent(orderId) + '#t=' + encodeURIComponent(token);
  }

  var razorpayLoading;
  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    if (!razorpayLoading) {
      razorpayLoading = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = function () { resolve(); };
        s.onerror = function () { razorpayLoading = null; reject(new Error("The payment window couldn't load. Try again.")); };
        document.head.appendChild(s);
      });
    }
    return razorpayLoading;
  }

  function pay(order, token, payment, prefill) {
    return loadRazorpay().then(function () {
      return new Promise(function (resolve) {
        var rzp = new window.Razorpay({
          key: payment.keyId,
          amount: payment.amount,
          currency: payment.currency,
          order_id: payment.providerOrderId,
          name: boot.name,
          description: 'Order ' + order.orderNumber,
          prefill: prefill || {},
          handler: function (r) {
            request('POST', '/orders/' + encodeURIComponent(order.id) + '/payment/verify', {
              token: token,
              razorpayOrderId: r.razorpay_order_id,
              razorpayPaymentId: r.razorpay_payment_id,
              razorpaySignature: r.razorpay_signature
            }).then(function () { resolve('paid'); }, function () { resolve('check'); });
          },
          modal: { ondismiss: function () { resolve('dismissed'); } }
        });
        rzp.open();
      });
    });
  }

  function placeOrder(e) {
    e.preventDefault();
    var button = $('[data-place-order]', form);
    var body = cartBody();
    body.paymentMethod = checked('paymentMethod');
    body.customerName = value('customerName');
    body.customerPhone = value('customerPhone');
    if (value('notes')) body.notes = value('notes');
    if (body.orderType === 'delivery') {
      body.address = { line1: value('line1') };
      if (value('landmark')) body.address.landmark = value('landmark');
      if (value('pincode')) body.address.pincode = value('pincode');
    }
    if (body.orderType === 'dine_in' && value('table')) body.table = value('table');
    if (!body.customerName) return showError(form, 'Add your name.');
    if (!body.customerPhone) return showError(form, 'Add your mobile number.');
    if (body.orderType === 'delivery' && !body.address.line1) return showError(form, 'Add the delivery address.');

    // Same cart + details = same key, so a double tap or a retry can't order twice.
    var fingerprint = JSON.stringify(body);
    var attempt = load(attemptKey, null);
    if (!attempt || attempt.fingerprint !== fingerprint) attempt = { fingerprint: fingerprint, key: uuid() };
    save(attemptKey, attempt);

    button.disabled = true;
    showError(form, '');
    request('POST', '/orders', body, { 'Idempotency-Key': attempt.key }).then(function (data) {
      rememberOrder(data.order, data.trackingToken);
      var go = function () {
        cart = []; saveCart();
        try { localStorage.removeItem(attemptKey); } catch (err) { /* ignore */ }
        window.location.assign(trackingUrl(data.order.id, data.trackingToken));
      };
      if (!data.payment) return go();
      return pay(data.order, data.trackingToken, data.payment, { name: body.customerName, contact: body.customerPhone }).then(go, go);
    }).catch(function (err) {
      showError(form, err.message);
    }).then(function () { button.disabled = false; });
  }

  function initMenu() {
    $all('.rp-item').forEach(function (card) {
      var add = $('[data-add]', card);
      if (!add) return;
      var options = $('.rp-item-options', card);
      if (options) options.hidden = false;
      add.hidden = false;
      add.addEventListener('click', function () {
        addFromCard(card);
        add.textContent = 'Added';
        setTimeout(function () { add.textContent = 'Add'; }, 1200);
      });
    });
    var openBtn = $('[data-cart-open]');
    if (openBtn && dialog) {
      openBtn.addEventListener('click', function () {
        renderCart();
        if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
        quote();
      });
    }
    if (form) {
      form.addEventListener('submit', placeOrder);
      form.addEventListener('change', function (ev) {
        if (ev.target.name === 'orderType') syncOrderType();
        if (ev.target.name === 'orderType' || ev.target.name === 'offerCode') quote();
      });
      syncOrderType();
    }
    renderCart();
  }

  // ----- Tracking -----

  function initTracking() {
    var root = $('[data-track]');
    if (!root) return;
    var id = root.getAttribute('data-order-id');
    var m = /(?:^|[#&])t=([^&]+)/.exec(window.location.hash);
    var token = m ? decodeURIComponent(m[1]) : load(ordersKey, {})[id];
    var statusEl = $('[data-track-status]', root);
    var payBtn = $('[data-pay-again]', root);
    if (!token) {
      statusEl.textContent = "Open this page from the link on the device you ordered on to see your order.";
      return;
    }
    rememberOrder({ id: id }, token);
    var timer;

    var riderEl = $('[data-track-rider]', root);

    // Rider progress for delivery orders. Text only; a tracking link must be https.
    function renderRider(d) {
      riderEl.textContent = '';
      riderEl.hidden = !d;
      if (!d) return;
      var parts = [d.label];
      if (d.riderName) parts.push(d.riderName);
      else if (d.carrier) parts.push(d.carrier);
      if (d.etaMinutes && d.status !== 'DELIVERED') parts.push('about ' + d.etaMinutes + ' min');
      riderEl.appendChild(document.createTextNode('Rider: ' + parts.join(' · ')));
      if (d.trackingUrl && /^https:\/\//.test(d.trackingUrl)) {
        var a = document.createElement('a');
        a.href = d.trackingUrl;
        a.rel = 'noopener noreferrer';
        a.target = '_blank';
        a.textContent = 'Follow the rider';
        riderEl.appendChild(document.createTextNode(' '));
        riderEl.appendChild(a);
      }
    }

    function render(order, delivery) {
      renderRider(delivery || null);
      statusEl.textContent = 'Order ' + order.orderNumber + ': ' + (STATUS_TEXT[order.status] || order.status);
      var tl = $('[data-track-timeline]', root);
      tl.textContent = '';
      (order.statusHistory || []).forEach(function (h) {
        var li = document.createElement('li');
        li.textContent = (STATUS_TEXT[h.status] || h.status) + ' · ' + new Date(h.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        tl.appendChild(li);
      });
      renderTotals($('[data-track-totals]', root), order.totals, order.offer);
      var needsPay = order.paymentMethod === 'online' && (order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_FAILED');
      payBtn.hidden = !needsPay;
      clearTimeout(timer);
      if (ACTIVE.indexOf(order.status) !== -1) timer = setTimeout(refresh, 15000);
    }

    function refresh() {
      request('GET', '/orders/' + encodeURIComponent(id) + '?token=' + encodeURIComponent(token)).then(function (data) {
        showError(root, '');
        render(data.order, data.delivery);
      }, function (err) {
        showError(root, err.status === 404 ? "We couldn't find this order." : err.message);
        if (err.status !== 404) timer = setTimeout(refresh, 30000);
      });
    }

    payBtn.addEventListener('click', function () {
      payBtn.disabled = true;
      request('POST', '/orders/' + encodeURIComponent(id) + '/payment/retry', { token: token }).then(function (data) {
        return pay(data.order, token, data.payment).then(refresh);
      }).catch(function (err) { showError(root, err.message); }).then(function () { payBtn.disabled = false; });
    });

    refresh();
  }

  if (boot.page === 'track') initTracking(); else initMenu();
})();
