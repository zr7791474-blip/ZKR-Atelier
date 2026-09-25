// Real-time cost delta — the cost impact of the latest action, without opening
// the cost panel. Totals come from the app's own computeCostBreakdown()
// (subtotal + 12% delivery & install + 8% contingency); nothing is estimated
// separately. The delta is the difference between two consecutive real totals,
// with the cause derived by diffing the placed-item set.
import { bus } from './bus.js';
import { ws, esc, money, signedMoney } from './ws.js';

export function initCostDelta(ctx) {
  const pill = document.getElementById('costPill'); if (!pill) return { reset() {} };
  const totalEl = pill.querySelector('[data-f="total"]'), chipEl = pill.querySelector('[data-f="delta"]'), whyEl = pill.querySelector('[data-f="why"]');
  let prev = null;        // { items: Map(id → {name, price}), total }
  let timer;

  const snapshot = () => {
    const items = new Map(ctx.state.placedItems.map(i => [i.id, { name: i.name, price: i.price }]));
    const subtotal = ctx.state.placedItems.reduce((s, i) => s + i.price, 0);
    return { items, subtotal, total: ctx.computeCostBreakdown(subtotal).total };
  };
  const describe = (added, removed) => {
    const one = (arr, verb) => arr.length === 1 ? `${arr[0].name} ${verb}` : `${arr.length} items ${verb}`;
    const sum = (arr) => arr.reduce((s, x) => s + x.price, 0);
    if (added.length && !removed.length) return `${one(added, 'added')} · ${money(sum(added))} + fees`;
    if (removed.length && !added.length) return `${one(removed, 'removed')} · ${money(sum(removed))} + fees`;
    return `${added.length} added, ${removed.length} removed`;
  };

  function render(cur, change) {
    totalEl.textContent = money(cur.total);
    pill.classList.toggle('is-empty', cur.items.size === 0);
    if (!change) return;
    chipEl.textContent = signedMoney(change.delta);
    chipEl.dataset.dir = change.delta < 0 ? 'down' : 'up';
    whyEl.textContent = change.why;
    pill.classList.add('has-delta');
    pill.setAttribute('aria-label', `Estimated total ${money(cur.total)}, ${signedMoney(change.delta)}: ${change.why}. Open cost estimate.`);
    clearTimeout(timer);
    timer = setTimeout(() => pill.classList.remove('has-delta'), 7000);
  }

  function update() {
    const cur = snapshot();
    let change = null;
    if (prev && Math.round(cur.total) !== Math.round(prev.total)) {
      const added = [], removed = [];
      cur.items.forEach((v, id) => { if (!prev.items.has(id)) added.push(v); });
      prev.items.forEach((v, id) => { if (!cur.items.has(id)) removed.push(v); });
      if (added.length || removed.length) change = { delta: cur.total - prev.total, why: describe(added, removed) };
    }
    prev = cur;
    render(cur, change);
  }
  const reset = () => { clearTimeout(timer); pill.classList.remove('has-delta'); prev = snapshot(); render(prev, null); };

  bus.on('layout', update);
  bus.on('baseline', reset);
  pill.addEventListener('click', () => ctx.toggleCostPanel());
  reset();
  return { reset, update };
}
