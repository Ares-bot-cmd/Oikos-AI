  // ---------- helpers ----------
  function fmtINR(v, compact){
    v = Number(v) || 0;
    if (compact){
      if (Math.abs(v) >= 1e7) return '₹' + (v/1e7).toFixed(2) + ' Cr';   // 1,00,00,000+
      if (Math.abs(v) >= 1e5) return '₹' + (v/1e5).toFixed(1) + ' L';    // 1,00,000+
    }
    return '₹' + Math.round(v).toLocaleString('en-IN');
  }
  function fmtDelta(pct, direction){
    const arrow = direction === 'up' ? '▲' : '▼';
    return arrow + ' ' + Math.abs(pct) + '% vs last month';
  }
  function relTime(iso){
    const then = new Date(iso + 'Z'); // stored as naive UTC
    const mins = Math.max(0, Math.round((Date.now() - then.getTime()) / 60000));
    if (mins < 60) return mins + ' min ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + ' hr ago';
    const days = Math.round(hrs / 24);
    return days + ' day' + (days === 1 ? '' : 's') + ' ago';
  }
  function scoreTag(status){
    if (status === 'hot') return { emoji: '🔥 Hot', color: 'var(--brick)' };
    if (status === 'warm') return { emoji: '🟡 Warm', color: 'var(--brass)' };
    return { emoji: '🔵 Cold', color: 'var(--blue)' };
  }
  function esc(s){
    const d = document.createElement('div');
    d.textContent = s == null ? '' : s;
    return d.innerHTML;
  }
  async function getJSON(url){
    const res = await fetch(url);
    if (!res.ok) throw new Error(url + ' → ' + res.status);
    return res.json();
  }
  function loadError(el, label){
    if (!el) return;
    if (el.tagName === 'TBODY') {
      const cols = el.closest('table').querySelectorAll('thead th').length || 3;
      el.innerHTML = `<tr><td colspan="${cols}" style="color:var(--brick); font-size:0.85rem;">Couldn't load ${label} — is the backend running?</td></tr>`;
    } else {
      el.innerHTML = `<div style="color:var(--brick); font-size:0.85rem;">Couldn't load ${label} — is the backend running?</div>`;
    }
  }

  // ---------- dashboard ----------
  async function loadDashboard(){
    const kpiRow = document.getElementById('kpiRow');
    try {
      const data = await getJSON('/api/dashboard');

      // KPI cards, in the order the API returns them
      const cards = kpiRow.querySelectorAll('.kpi');
      data.kpis.forEach((kpi, i) => {
        const card = cards[i];
        if (!card) return;
        const isRevenue = kpi.label === 'REVENUE';
        card.querySelector('.num').textContent = isRevenue ? fmtINR(kpi.value, true) : Math.round(kpi.value).toLocaleString();
        const delta = card.querySelector('.delta');
        delta.textContent = fmtDelta(kpi.delta_pct, kpi.direction);
        delta.className = 'delta ' + kpi.direction;
      });

      // trend chart
      const trend = data.trend || [];
      if (trend.length){
        const x0 = 35, x1 = 385;
        // Two separate vertical bands so the lines never overlap, even
        // when both metrics happen to trend upward at a similar rate:
        // revenue occupies the top half, bookings the bottom half, each
        // independently normalized within its own band.
        const revTop = 15, revBottom = 78;
        const bookTop = 92, bookBottom = 155;
        const revVals = trend.map(r => r.revenue);
        const bookVals = trend.map(r => r.bookings);
        const revMax = Math.max(...revVals) || 1, revMin = Math.min(...revVals, 0);
        const bookMax = Math.max(...bookVals) || 1, bookMin = Math.min(...bookVals, 0);
        const n = trend.length;
        const xAt = i => n === 1 ? x0 : x0 + (x1 - x0) * (i / (n - 1));
        const revPoints = trend.map((r, i) => `${xAt(i).toFixed(1)},${(revBottom - (r.revenue - revMin) / (revMax - revMin || 1) * (revBottom - revTop)).toFixed(1)}`).join(' ');
        const bookPoints = trend.map((r, i) => `${xAt(i).toFixed(1)},${(bookBottom - (r.bookings - bookMin) / (bookMax - bookMin || 1) * (bookBottom - bookTop)).toFixed(1)}`).join(' ');
        document.getElementById('revenueLine').setAttribute('points', revPoints);
        document.getElementById('bookingsLine').setAttribute('points', bookPoints);
        const monthLabel = m => { const [y, mo] = m.split('-'); return new Date(Number(y), Number(mo) - 1, 1).toLocaleString(undefined, { month: 'short' }); };
        document.getElementById('trendFirstMonth').textContent = monthLabel(trend[0].month);
        document.getElementById('trendLastMonth').textContent = monthLabel(trend[trend.length - 1].month);
      }

      // pipeline
      const colors = ['var(--blue)', 'var(--brass)', 'var(--sage)', 'var(--brick)', 'var(--paper)'];
      const pipelineBody = document.getElementById('pipelineBody');
      pipelineBody.innerHTML = (data.pipeline || []).map((p, i) => `
        <tr><td>${esc(p.stage)}</td><td class="mono">${p.count}</td>
        <td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${p.share_pct}%; background:${colors[i % colors.length]};"></div></div></td></tr>
      `).join('');
    } catch (err) {
      console.error(err);
      loadError(kpiRow, 'the dashboard');
      loadError(document.getElementById('pipelineBody'), 'pipeline');
    }
  }

  // ---------- lead scoring (also returns leads for other views to reuse) ----------
  let cachedLeads = null;
  async function loadLeads(){
    const body = document.getElementById('leadsBody');
    try {
      const leads = await getJSON('/api/leads');
      cachedLeads = leads;
      body.innerHTML = leads.map(l => {
        const tag = scoreTag(l.status);
        return `<tr><td>${esc(l.name)}</td><td class="mono">${esc(l.source)}</td><td>${esc(l.interested_in)}</td>
          <td class="score-tag">${tag.emoji}</td>
          <td class="bar-cell"><div class="bar-track"><div class="bar-fill" style="width:${l.score}%; background:${tag.color};"></div></div></td>
          <td class="mono">${relTime(l.last_touch)}</td></tr>`;
      }).join('');
      return leads;
    } catch (err) {
      console.error(err);
      loadError(body, 'leads');
      return [];
    }
  }

  // ---------- whatsapp agent ----------
  let chatScript = [];
  async function loadWhatsapp(leads){
    const avatar = document.getElementById('phoneAvatar');
    const nameEl = document.getElementById('phoneName');
    try {
      const list = leads && leads.length ? leads : (cachedLeads || await getJSON('/api/leads'));
      if (!list.length) { nameEl.textContent = 'No leads yet'; return; }
      const hottest = list.reduce((a, b) => (b.score > a.score ? b : a));
      nameEl.textContent = hottest.name;
      avatar.textContent = hottest.name.split(/[.\s]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

      const messages = await getJSON(`/api/leads/${hottest.id}/messages`);
      chatScript = messages.length
        ? messages.map(m => ({ who: m.sender === 'buyer' ? 'buyer' : 'ai', text: m.text }))
        : [{ who: 'ai', text: 'No conversation on file for this lead yet.' }];
    } catch (err) {
      console.error(err);
      nameEl.textContent = 'Couldn\'t load lead';
      chatScript = [{ who: 'ai', text: 'Couldn\'t load the conversation — is the backend running?' }];
    }
  }

  // ---------- AI insights ----------
  async function loadInsights(){
    const list = document.getElementById('insightList');
    try {
      const insights = await getJSON('/api/insights');
      if (!insights.length) { list.innerHTML = '<div style="color:var(--paper-dim); font-size:0.88rem;">No insights yet.</div>'; return; }
      const kindLabel = { up: '▲ UP', down: '▼ DOWN', action: 'ACTION' };
      list.innerHTML = insights.map(ins => `
        <div class="insight">
          <div class="kind ${ins.kind}">${kindLabel[ins.kind] || ins.kind}</div>
          <div class="body">
            <h3>${esc(ins.title)}</h3>
            <p>${esc(ins.body)}</p>
            ${ins.action_line ? `<div class="action-line">→ ${esc(ins.action_line)}</div>` : ''}
          </div>
        </div>
      `).join('');
    } catch (err) {
      console.error(err);
      loadError(list, 'insights');
    }
  }

  // ---------- marketing → revenue funnel ----------
  async function loadFunnel(){
    const body = document.getElementById('funnelBody');
    const stats = document.getElementById('funnelStats');
    try {
      const data = await getJSON('/api/funnel');
      const steps = data.steps || [];
      const colors = { 'Ad spend': 'var(--blue)', 'Leads': 'var(--brass)', 'Site visits': 'var(--sage)', 'Bookings': 'var(--brick)', 'Revenue': 'var(--paper)' };
      const rows = [];
      steps.forEach((s, i) => {
        const width = s.label === 'Ad spend' || s.label === 'Revenue' ? 100 : Math.max(15, Math.min(100, s.pct_of_leads ?? 50));
        const meta = s.label === 'Ad spend' ? 'baseline' : (s.pct_of_leads != null ? s.pct_of_leads + '%' : '');
        rows.push(`<div class="funnel-row">
          <div class="funnel-label">${esc(s.label)}</div>
          <div class="funnel-bar-track"><div class="funnel-bar" style="width:${width}%; background:${colors[s.label] || 'var(--paper)'};">${esc(s.display)}</div></div>
          <div class="funnel-meta">${esc(meta)}</div>
        </div>`);
        if (i < steps.length - 1) {
          const next = steps[i + 1];
          rows.push(`<div class="funnel-conv">↓ ${esc(next.label)}: ${esc(next.display)}</div>`);
        }
      });
      body.innerHTML = rows.join('');
      stats.innerHTML = `
        <div class="stat"><div class="num" style="color:var(--brass)">${fmtINR(data.cost_per_lead)}</div><div class="label">cost per lead</div></div>
        <div class="stat"><div class="num" style="color:var(--sage)">${fmtINR(data.cost_per_booking)}</div><div class="label">cost per booking</div></div>
        <div class="stat"><div class="num" style="color:var(--paper)">${data.roas}x</div><div class="label">return on ad spend</div></div>
      `;
    } catch (err) {
      console.error(err);
      loadError(body, 'the funnel');
    }
  }

  // Tab switching
  const tabs = document.querySelectorAll('.tab-btn');
  const views = document.querySelectorAll('.view');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'whatsapp') playChat();
    });
  });

  // WhatsApp chat playback — uses chatScript populated by loadWhatsapp()
  let chatRunning = false;
  async function playChat(){
    if (chatRunning) return;
    chatRunning = true;
    const body = document.getElementById('phoneBody');
    body.innerHTML = '';
    for (const msg of chatScript) {
      const typing = document.createElement('div');
      typing.className = 'typing';
      typing.textContent = msg.who === 'ai' ? 'Agent is typing…' : 'typing…';
      body.appendChild(typing);
      body.scrollTop = body.scrollHeight;
      await new Promise(r => setTimeout(r, 650));
      typing.remove();

      const b = document.createElement('div');
      b.className = 'bubble ' + msg.who;
      b.innerHTML = esc(msg.text) + '<span class="time">' + (msg.who === 'buyer' ? 'Buyer' : 'AI Agent') + '</span>';
      body.appendChild(b);
      body.scrollTop = body.scrollHeight;
      await new Promise(r => setTimeout(r, 500));
    }
    chatRunning = false;
  }
  document.getElementById('replayBtn').addEventListener('click', () => { chatRunning = false; playChat(); });

  // Kick off all data loads on page load
  (async function init(){
    const leadsPromise = loadLeads();
    await Promise.all([
      loadDashboard(),
      leadsPromise,
      loadInsights(),
      loadFunnel(),
    ]);
    await loadWhatsapp(await leadsPromise);
  })();

  // ---------- AI chatbot widget ----------
  (function initChatWidget(){
    const toggleBtn = document.getElementById('chatToggle');
    const closeBtn = document.getElementById('chatClose');
    const panel = document.getElementById('chatPanel');
    const messagesEl = document.getElementById('chatMessages');
    const form = document.getElementById('chatForm');
    const input = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSend');

    let history = []; // [{role:'user'|'assistant', content:string}, ...]
    let busy = false;

    function addBubble(text, cls){
      const div = document.createElement('div');
      div.className = 'chat-msg ' + cls;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return div;
    }

    toggleBtn.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open') && !messagesEl.children.length) {
        addBubble("Hi — I'm the Oikos AI assistant. Ask me about leads, the funnel, or sales strategy.", 'assistant');
        input.focus();
      }
    });
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || busy) return;

      addBubble(text, 'user');
      history.push({ role: 'user', content: text });
      input.value = '';

      busy = true;
      sendBtn.disabled = true;
      const pending = addBubble('Thinking…', 'pending');

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, history: history.slice(0, -1) })
        });
        const data = await res.json().catch(() => ({}));
        pending.remove();

        if (!res.ok) {
          addBubble(data.detail || "Something went wrong talking to the assistant.", 'error');
          return;
        }
        addBubble(data.reply, 'assistant');
        history.push({ role: 'assistant', content: data.reply });
      } catch (err) {
        console.error(err);
        pending.remove();
        addBubble("Couldn't reach the server — is the backend running?", 'error');
      } finally {
        busy = false;
        sendBtn.disabled = false;
        input.focus();
      }
    });
  })();
