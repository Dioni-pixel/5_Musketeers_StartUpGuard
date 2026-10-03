// StartupGuard - AI insights page script
//
// Shows the latest stored AI analysis (api/dashboard.php latest_ai_analysis)
// as insight cards, its recommendations and opportunities. "Ask StartupGuard"
// offers questions that each map to a real analyze.php review type; the
// answer is Claude's analysis of the business's own numbers.

const ins = { businessId: 1, dashboard: null, decisions: [] };

const FINDING_STYLES = {
  FINANCIAL: { label: 'Financial', icon: 'wallet', tone: 'tone-amber', text: 'text-amber' },
  COMPETITIVE: { label: 'Market alert', icon: 'radar', tone: '', text: 'text-blue' },
  MARKET: { label: 'Market', icon: 'globe', tone: '', text: 'text-blue' },
  OPERATIONAL: { label: 'Operations', icon: 'activity', tone: 'tone-purple', text: 'text-purple' },
  DECISION: { label: 'Decision risk', icon: 'shield-alert', tone: 'tone-red', text: 'text-red' },
};

document.addEventListener('DOMContentLoaded', async () => {
  ins.businessId = getBusinessId();
  document.getElementById('analysis-run').addEventListener('click', () => ask({ question: 'Give me a full review of the business.', type: 'FULL_ANALYSIS' }));
  document.getElementById('insights').replaceChildren(...[1, 2, 3, 4].map(() => el('li', { class: 'card pad' }, skeleton(150))));

  const [dash, dec] = await Promise.allSettled([
    StartupGuardAPI.getDashboard(ins.businessId),
    StartupGuardAPI.getDecisions(ins.businessId, { status: 'proposed' }),
  ]);
  if (dec.status === 'fulfilled') ins.decisions = dec.value.decisions;

  if (dash.status === 'rejected') {
    showErrorIn(document.getElementById('insights'), dash.reason, 'Could not load the AI insights');
  } else {
    ins.dashboard = dash.value;
    setBusiness(dash.value.business);
    document.getElementById('chat-sub').textContent = `Answers grounded in ${dash.value.business.name}'s financial and market data`;
    const row = dash.value.latest_ai_analysis;
    if (row) {
      showInsights(analysisFromRow(row), row);
    } else {
      showNoInsights();
    }
  }
  renderChat();
});

function showNoInsights() {
  document.getElementById('insight-meta').replaceChildren(el('span', { class: 'badge ai lg', text: 'No analysis yet' }));
  const run = iconButton('btn-ai', 'sparkles', 'Run AI Analysis', { 'data-ai-run': '' });
  run.addEventListener('click', () => ask({ question: 'Give me a full review of the business.', type: 'FULL_ANALYSIS' }));
  document.getElementById('insights').replaceChildren(el('li', { class: 'card ai-tint', style: 'grid-column:1/-1' },
    el('div', { class: 'ai-hero row' },
      el('span', { class: 'chip-icon xl tone-ai-solid' }, icon('sparkles')),
      el('div', { class: 'text' },
        el('p', { class: 'eyebrow', text: 'No insights yet' }),
        el('p', { class: 'lead', text: 'Run an AI analysis and StartupGuard turns your financials, competitor prices and pending decisions into rated findings and next steps.' })),
      el('div', { class: 'actions' }, run))));
  document.getElementById('lists').hidden = true;
}

/** Insight cards from an analysis object; `meta` is the stored row or the analyze.php result. */
function showInsights(a, meta) {
  const findings = sortedFindings(a);
  const recs = sortedRecommendations(a);
  const type = meta.analysis_type;
  const title = type === 'DECISION' && meta.business_decision_id
    ? (ins.decisions.find((d) => d.id === meta.business_decision_id) || {}).title : null;

  document.getElementById('insight-meta').replaceChildren(
    el('span', { class: 'badge ai lg row', style: 'gap:6px' }, icon('sparkles', 'xs'), `${findings.length} active insight${findings.length === 1 ? '' : 's'}`),
    a.overall_risk ? badge(levelOf(a.overall_risk), `${humanize(a.overall_risk)} overall risk`) : null,
    el('span', { class: 'muted', text: `${ANALYSIS_LABELS[type] || humanize(type)}${title ? ` of "${title}"` : ''} · ${meta.created_at} UTC${meta.model_used ? ` · ${meta.model_used}` : ''}` }));

  const root = document.getElementById('insights');
  if (!findings.length) {
    root.replaceChildren(el('li', { class: 'card pad', style: 'grid-column:1/-1' }, el('p', { class: 'ai-summary', text: a.summary || 'The analysis has no findings.' })));
  } else {
    root.replaceChildren(...findings.map((f, i) => {
      const style = FINDING_STYLES[f.type] || { label: humanize(f.type || 'Finding'), icon: 'lightbulb', tone: 'tone-green', text: 'text-green' };
      const level = levelOf(f.severity);
      const rec = recs[i];
      return el('li', {}, el('section', { class: `card insight-card${level === 'critical' ? ' danger' : ''}` },
        el('div', { class: 'top' },
          el('div', { class: 'cat' },
            el('span', { class: `chip-icon lg ${style.tone}` }, icon(style.icon, 'lg')),
            el('p', { class: `eyebrow ${style.text}`, text: level === 'critical' || level === 'high' ? `High risk · ${style.label}` : style.label })),
          badge(level, f.severity)),
        el('h2', { text: f.title }),
        el('p', { class: 'body', text: f.explanation }),
        rec ? el('div', { class: 'foot' },
          el('span', { class: 'tag', text: `Action ${rec.priority ?? i + 1}` }),
          el('span', { class: 'text-blue', style: 'font-size:14px;font-weight:500;flex:1;min-width:0;text-align:right', text: typeof rec === 'string' ? rec : rec.action })) : null));
    }));
  }

  document.getElementById('lists').hidden = false;
  document.getElementById('recommendations').replaceChildren(recs.length
    ? el('ul', {}, recs.map((r, i) => el('li', { class: 'rec' },
      el('span', { class: 'rec-num', text: String(typeof r === 'string' ? i + 1 : r.priority ?? i + 1) }),
      el('div', {}, el('p', { class: 'title', text: typeof r === 'string' ? r : r.action }), typeof r === 'string' || !r.reason ? null : el('p', { text: r.reason })))))
    : el('p', { class: 'empty', text: 'None.' }));
  const opps = a.opportunities || [];
  document.getElementById('opportunities').replaceChildren(opps.length
    ? el('div', {}, opps.map((o) => el('div', { class: 'opp' }, el('p', { class: 'title', text: o.title }), el('p', { text: o.explanation }))))
    : el('p', { class: 'empty', text: 'None in this analysis.' }));
}

// ---------------------------------------------------------------------
// Ask StartupGuard
// ---------------------------------------------------------------------

function questions() {
  const list = [
    { question: 'How healthy is my business overall?', type: 'FULL_ANALYSIS' },
    { question: 'Why is my runway at risk?', type: 'FINANCIAL' },
    { question: 'What are my competitors doing?', type: 'COMPETITOR' },
  ];
  ins.decisions.forEach((d) => list.push({ question: `Should I go ahead with "${d.title}"?`, type: 'DECISION', decision: d }));
  return list;
}

function renderChat() {
  const name = ins.dashboard ? ins.dashboard.business.name : 'your business';
  document.getElementById('chat').replaceChildren(botBubble(el('p', { text: `Hi, ask me about ${name}'s runway, competitors or a decision you're weighing. I answer from your stored numbers.` }), true));
  document.getElementById('questions').replaceChildren(...questions().map((q) => {
    const b = el('button', { type: 'button', class: 'pill-button', 'data-ai-chip': '', text: q.question });
    b.addEventListener('click', () => ask(q));
    return b;
  }));
}

function botBubble(content, fit = false) {
  return el('div', { class: 'bubble-row' },
    el('span', { class: 'chip-icon round tone-purple' }, icon('bot', 'sm')),
    el('div', { class: `bubble bot${fit ? ' fit' : ''}` }, content));
}

async function ask(q) {
  if (AI_RUNNING) return;
  const log = document.getElementById('chat');
  const chips = document.querySelectorAll('[data-ai-chip]');
  chips.forEach((c) => { c.disabled = true; });
  log.append(el('p', { class: 'bubble me', text: q.question }));
  const holder = el('div', {});
  log.append(botBubble(holder));
  log.scrollTop = log.scrollHeight;
  holder.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const result = await runAiInto(holder, {
    businessId: ins.businessId,
    type: q.type,
    decision: q.decision || null,
    buttons: [document.getElementById('analysis-run')],
    what: 'StartupGuard is thinking…',
  });
  chips.forEach((c) => { c.disabled = false; });
  if (!result) return;

  holder.replaceChildren(
    el('p', { class: 'muted small', style: 'margin-bottom:8px', text: analysisMeta(result.analysis_type, result.model_used, result.created_at) }),
    renderAnalysis(result.analysis, { type: result.analysis_type, title: q.decision ? q.decision.title : null }));
  // The newest analysis is now the stored latest one; refresh the cards with it.
  showInsights(result.analysis, { ...result, business_decision_id: q.decision ? q.decision.id : null });
}
