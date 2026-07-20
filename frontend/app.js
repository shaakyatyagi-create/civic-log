(function () {
  const CFG = window.CIVIC_CONFIG || {};
  const API_BASE = (CFG.API_BASE || '').replace(/\/$/, '');

  const sb = (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase)
    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY)
    : null;

  // ---------------------------------------------------------------------
  // API HELPERS
  // ---------------------------------------------------------------------
  async function apiJson(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function apiForm(path, formData, method = 'POST') {
    const res = await fetch(`${API_BASE}${path}`, { method, body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function fmtDate(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------------------------------------------------------------------
  // NAVIGATION
  // ---------------------------------------------------------------------
  function showPage(target) {
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    document.querySelectorAll('.navlink').forEach((nl) => nl.classList.remove('active'));

    const activePage = document.getElementById(`page-${target}`);
    if (activePage) activePage.classList.add('active');

    const directLink = document.querySelector(`.navlink[data-page="${target}"]:not([data-anchor])`);
    if (directLink) directLink.classList.add('active');
    if (target === 'contact') document.getElementById('ddtoggle').classList.add('active');

    document.getElementById('navlinks').classList.remove('open');

    if (target === 'issues') loadIssueLog();
    if (target === 'insights') loadInsights();
    if (target === 'forum') loadForum();
    if (target === 'contact') loadNgos();
  }

  function goToIssueLog(filters) {
    document.getElementById('filterState').value = filters.state || 'All';
    document.getElementById('filterDistrict').value = filters.district || 'All';
    document.getElementById('filterCategory').value = filters.category || 'All';
    document.getElementById('filterStatus').value = 'All';
    showPage('issues');
  }

  document.querySelectorAll('[data-page]').forEach((el) => {
    el.addEventListener('click', () => {
      const target = el.getAttribute('data-page');
      showPage(target);
      if (target === 'contact' && el.hasAttribute('data-anchor')) {
        setContactSubtab(el.getAttribute('data-anchor'));
      }
    });
  });

  document.getElementById('navtoggle').addEventListener('click', () => {
    document.getElementById('navlinks').classList.toggle('open');
  });

  document.getElementById('ddwrap').addEventListener('click', (e) => {
    if (e.target.id === 'ddtoggle') document.getElementById('ddwrap').classList.toggle('open');
  });

  // Generic subtab wiring (Hotspots/Dashboard, Contact Help/Gov/NGO)
  document.querySelectorAll('.subtabs').forEach((tabsEl) => {
    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.subtab-btn');
      if (!btn) return;
      const key = btn.getAttribute('data-subtab');
      const container = tabsEl.parentElement;
      container.querySelectorAll('.subtab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      container.querySelectorAll('.subtab-panel').forEach((p) => p.classList.toggle('active', p.id === `subtab-${key}`));
    });
  });

  function setContactSubtab(key) {
    const container = document.getElementById('page-contact');
    container.querySelectorAll('.subtab-btn').forEach((b) => b.classList.toggle('active', b.getAttribute('data-subtab') === key));
    container.querySelectorAll('.subtab-panel').forEach((p) => p.classList.toggle('active', p.id === `subtab-${key}`));
  }

  // ---------------------------------------------------------------------
  // HOME — LIVE FEED
  // ---------------------------------------------------------------------
  function addFeedItem(html) {
    const feed = document.getElementById('liveFeed');
    const div = document.createElement('div');
    div.className = 'live-feed-item';
    div.innerHTML = html;
    feed.prepend(div);
    while (feed.children.length > 12) feed.removeChild(feed.lastChild);
  }

  function bumpLiveCount(delta) {
    const el = document.getElementById('liveCount');
    el.textContent = String((parseInt(el.textContent, 10) || 0) + delta);
  }

  async function initLiveFeed() {
    if (!sb) {
      addFeedItem('<span style="opacity:.7">Live feed needs SUPABASE_URL / SUPABASE_ANON_KEY set in config.js.</span>');
      return;
    }

    const [{ count: reportCount }, { count: forumCount }] = await Promise.all([
      sb.from('reports').select('*', { count: 'exact', head: true }),
      sb.from('forum_posts').select('*', { count: 'exact', head: true }),
    ]);
    document.getElementById('liveCount').textContent = String((reportCount || 0) + (forumCount || 0));

    const [{ data: recentReports }, { data: recentForum }] = await Promise.all([
      sb.from('reports').select('id,title,district,category,created_at').order('created_at', { ascending: false }).limit(6),
      sb.from('forum_posts').select('id,name,problem,created_at').order('created_at', { ascending: false }).limit(6),
    ]);

    const merged = [
      ...(recentReports || []).map((r) => ({ ts: r.created_at, html: `<b>New report</b> — ${escapeHtml(r.title)} (${escapeHtml(r.category)}, ${escapeHtml(r.district)})` })),
      ...(recentForum || []).map((f) => ({ ts: f.created_at, html: `<b>Forum thread</b> — ${escapeHtml(f.name)}: ${escapeHtml(f.problem.slice(0, 70))}` })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 8);

    merged.forEach((m) => addFeedItem(m.html));

    sb.channel('civic-live-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'reports' }, (payload) => {
        const r = payload.new;
        addFeedItem(`<b>New report</b> — ${escapeHtml(r.title)} (${escapeHtml(r.category)}, ${escapeHtml(r.district)})`);
        bumpLiveCount(1);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'forum_posts' }, (payload) => {
        const f = payload.new;
        addFeedItem(`<b>Forum thread</b> — ${escapeHtml(f.name)}: ${escapeHtml((f.problem || '').slice(0, 70))}`);
        bumpLiveCount(1);
      })
      .subscribe();
  }

  // ---------------------------------------------------------------------
  // REPORT PAGE
  // ---------------------------------------------------------------------
  const rImageFile = document.getElementById('rImageFile');
  rImageFile.addEventListener('change', (e) => {
    const fileNameDisplay = document.getElementById('rFileNameDisplay');
    const preview = document.getElementById('rImagePreview');
    if (e.target.files.length > 0) {
      fileNameDisplay.textContent = e.target.files[0].name;
      const reader = new FileReader();
      reader.onload = (ev) => { preview.src = ev.target.result; preview.style.display = 'block'; };
      reader.readAsDataURL(e.target.files[0]);
    }
  });

  let currentReport = null;

  document.getElementById('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('reportSubmitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> AI analyzing photo & drafting…';

    try {
      const fd = new FormData();
      fd.append('citizenName', document.getElementById('rCitizenName').value.trim());
      fd.append('phone', document.getElementById('rPhone').value.trim());
      fd.append('state', document.getElementById('rState').value);
      fd.append('district', document.getElementById('rDistrict').value);
      fd.append('ward', document.getElementById('rWard').value.trim());
      fd.append('area', document.getElementById('rArea').value.trim());
      fd.append('category', document.getElementById('rCategory').value);
      fd.append('title', document.getElementById('rName').value.trim());
      fd.append('citizenSeverity', document.getElementById('rSeverity').value);
      fd.append('nearFacility', document.getElementById('rNearFacility').checked);
      fd.append('description', document.getElementById('rDesc').value.trim());
      if (rImageFile.files[0]) fd.append('image', rImageFile.files[0]);

      const result = await apiForm('/api/reports', fd);
      if (result.duplicate) {
        renderDuplicateResult(result);
      } else {
        currentReport = result.report;
        renderReportResult(result.report, result.code);
      }

      document.getElementById('reportFormPanel').style.display = 'none';
      document.getElementById('reportResultPanel').style.display = 'block';
    } catch (err) {
      alert(`Could not submit report: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Submit for AI Analysis';
    }
  });

  function renderReportResult(report, code) {
    const match = report.ai_category_match;
    const panel = document.getElementById('reportResultPanel');
    panel.innerHTML = `
      <h3 style="margin-bottom:6px;">AI Analysis Complete</h3>
      <p style="font-size:13px;color:var(--ink-soft);margin:0 0 18px;">Review and edit the drafts below, then confirm to actually send the email and publish the X post.</p>

      <div class="verdict-banner ${match ? 'match' : 'mismatch'}">
        <div class="icon">${match ? '✅' : '⚠️'}</div>
        <div>
          <div style="font-weight:800;margin-bottom:4px;">
            AI assessed severity: ${escapeHtml(report.ai_severity)} (you selected ${escapeHtml(report.citizen_severity)})
            ${match ? '— category/severity looks accurate' : '— AI flagged a possible mismatch'}
          </div>
          <div style="font-size:13px;">${escapeHtml(report.ai_reasoning && report.ai_reasoning.text || '')}</div>
        </div>
      </div>

      <div class="code-gate" style="background:#dcfce7;border-color:#22c55e;">
        <strong>Your verification code — save this, you'll need it to change this report's status later:</strong>
        <div class="code-display">${escapeHtml(code)}</div>
      </div>

      <div class="draft-box">
        <h4>Email Draft — to ${escapeHtml(report.district)} authority</h4>
        <input type="text" id="editSubject" value="${escapeHtml(report.email_draft_subject)}" style="margin-bottom:10px;">
        <textarea id="editBody">${escapeHtml(report.email_draft_body)}</textarea>
      </div>

      <div class="draft-box">
        <h4>X Post Draft</h4>
        <textarea id="editXPost" style="min-height:80px;">${escapeHtml(report.x_post_draft)}</textarea>
      </div>

      <button class="btn block" id="confirmSendBtn">Confirm &amp; Send Report</button>
      <div id="sendResultBanner"></div>
      <button class="btn outline block" style="margin-top:10px;" id="fileAnotherBtn">File Another Report</button>
    `;

    document.getElementById('confirmSendBtn').addEventListener('click', () => confirmSendReport(report));
    document.getElementById('fileAnotherBtn').addEventListener('click', resetReportForm);
  }

  function renderDuplicateResult(result) {
    const m = result.matchedReport;
    const panel = document.getElementById('reportResultPanel');
    panel.innerHTML = `
      <div class="verdict-banner mismatch">
        <div class="icon">🔁</div>
        <div>
          <div style="font-weight:800;margin-bottom:4px;">Possible duplicate detected</div>
          <div style="font-size:13px;">${escapeHtml(result.message)}</div>
        </div>
      </div>
      <p style="font-size:14px;color:var(--ink-soft);">Existing report: <strong>${escapeHtml(m.title)}</strong> (#${m.id}) — now has ${m.upvotes} confirmation(s).</p>
      <button class="btn block" id="viewMatchedBtn">View in Issue Log</button>
      <button class="btn outline block" style="margin-top:10px;" id="fileAnotherBtnDup">File a Different Report</button>
    `;
    document.getElementById('viewMatchedBtn').addEventListener('click', () => goToIssueLog({ state: m.state, district: m.district, category: m.category }));
    document.getElementById('fileAnotherBtnDup').addEventListener('click', resetReportForm);
  }

  async function confirmSendReport(report) {
    const btn = document.getElementById('confirmSendBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sending email & posting to X…';

    try {
      const emailSubject = document.getElementById('editSubject').value;
      const emailBody = document.getElementById('editBody').value;
      const xPost = document.getElementById('editXPost').value;

      const { notifications } = await apiJson(`/api/reports/${report.id}/send`, {
        method: 'POST',
        body: { emailSubject, emailBody, xPost },
      });

      const banner = document.getElementById('sendResultBanner');
      const emailNote = notifications.email.dryRun ? 'simulated (dry-run — add Gmail keys to send for real)' : (notifications.email.success ? 'sent' : `failed: ${notifications.email.error}`);
      const xNote = notifications.x.dryRun ? 'simulated (dry-run — add X keys to post for real)' : (notifications.x.success ? 'posted' : `failed: ${notifications.x.error}`);
      banner.innerHTML = `<div class="result-banner ${notifications.email.success && notifications.x.success ? 'ok' : 'warn'}">
        Email ${emailNote}. X post ${xNote}. This report is now live in the Issue Log as <b>Unsolved</b>.
      </div>
      <button class="btn outline block" style="margin-top:10px;" id="viewInLogBtn">View in Issue Log</button>`;
      btn.style.display = 'none';
      document.getElementById('viewInLogBtn').addEventListener('click', () => goToIssueLog({ state: report.state, district: report.district, category: report.category }));
    } catch (err) {
      document.getElementById('sendResultBanner').innerHTML = `<div class="result-banner warn">Send failed: ${escapeHtml(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = 'Confirm & Send Report';
    }
  }

  function resetReportForm() {
    document.getElementById('reportForm').reset();
    document.getElementById('rFileNameDisplay').textContent = 'No file chosen';
    document.getElementById('rImagePreview').style.display = 'none';
    document.getElementById('reportResultPanel').style.display = 'none';
    document.getElementById('reportFormPanel').style.display = 'block';
    currentReport = null;
  }

  // ---------------------------------------------------------------------
  // ISSUE LOG
  // ---------------------------------------------------------------------
  function severityClasses(sev) {
    if (sev === 'Critical') return { border: 'critical-border', dot: 'dot-red' };
    if (sev === 'Important') return { border: 'important-border', dot: 'dot-yellow' };
    if (sev === 'Minor') return { border: 'minor-border', dot: 'dot-green' };
    return { border: 'low-border', dot: 'dot-blue' };
  }

  function groupBy(arr, keyFn) {
    const out = {};
    arr.forEach((item) => {
      const k = keyFn(item);
      (out[k] = out[k] || []).push(item);
    });
    return out;
  }

  async function loadIssueLog() {
    const state = document.getElementById('filterState').value;
    const district = document.getElementById('filterDistrict').value;
    const category = document.getElementById('filterCategory').value;
    const status = document.getElementById('filterStatus').value;
    const container = document.getElementById('issueLogContainer');
    container.innerHTML = '<div class="panel"><span class="spinner"></span> Loading…</div>';

    try {
      const params = new URLSearchParams();
      if (state !== 'All') params.set('state', state);
      if (district !== 'All') params.set('district', district);
      if (category !== 'All') params.set('category', category);
      if (status !== 'All') params.set('status', status);
      const { reports } = await apiJson(`/api/reports?${params.toString()}`);

      document.getElementById('issueCountTag').textContent = `${reports.length} ENTRIES`;
      if (!reports.length) {
        container.innerHTML = '<div class="panel"><p>No public logs match your selected area yet.</p></div>';
        return;
      }

      const byState = groupBy(reports, (r) => r.state);
      let html = '';
      Object.entries(byState).forEach(([stateName, stateReports]) => {
        html += `<div class="group-block" data-level="state"><div class="group-header"><span>${escapeHtml(stateName)}</span><span class="count"><span class="chev">▶</span> ${stateReports.length} reports</span></div><div class="group-body">`;

        const byDistrict = groupBy(stateReports, (r) => r.district);
        Object.entries(byDistrict).forEach(([districtName, districtReports]) => {
          html += `<div class="group-block" data-level="district"><div class="group-header"><span>📍 ${escapeHtml(districtName)}</span><span class="count"><span class="chev">▶</span> ${districtReports.length} reports</span></div><div class="group-body">`;

          const byCategory = groupBy(districtReports, (r) => r.category);
          Object.entries(byCategory).forEach(([categoryName, categoryReports]) => {
            html += `<div class="group-block" data-level="category"><div class="group-header"><span>🗂 ${escapeHtml(categoryName)}</span><span class="count"><span class="chev">▶</span> ${categoryReports.length} reports</span></div><div class="group-body">`;

            if (status === 'All') {
              const unsolved = categoryReports.filter((r) => r.status === 'unsolved');
              const solved = categoryReports.filter((r) => r.status === 'solved');
              html += `<div class="status-subgroup-label">Unsolved (${unsolved.length})</div>`;
              html += unsolved.map(renderIssueCard).join('') || '<p style="font-size:13px;color:var(--ink-soft);">None.</p>';
              html += `<div class="status-subgroup-label">Solved (${solved.length})</div>`;
              html += solved.map(renderIssueCard).join('') || '<p style="font-size:13px;color:var(--ink-soft);">None.</p>';
            } else {
              html += categoryReports.map(renderIssueCard).join('');
            }

            html += `</div></div>`;
          });

          html += `</div></div>`;
        });

        html += `</div></div>`;
      });

      container.innerHTML = html;
      wireIssueCardEvents();
      wireGroupToggles(container);
    } catch (err) {
      container.innerHTML = `<div class="panel"><p>Could not load reports: ${escapeHtml(err.message)}</p></div>`;
    }
  }

  function wireGroupToggles(root) {
    root.querySelectorAll('.group-header').forEach((h) => {
      h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
    });
  }

  function renderIssueCard(rep) {
    const { border, dot } = severityClasses(rep.ai_severity || rep.citizen_severity);
    const badge = rep.status === 'solved'
      ? '<span class="status-badge badge-solved">SOLVED</span>'
      : '<span class="status-badge badge-unsolved">UNSOLVED</span>';

    return `
      <div class="issue-card ${border}" id="card-${rep.id}">
        <div style="font-size:12px; font-weight:700; color:var(--ink-soft); margin-bottom:4px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:6px;">
          <span>ENTRY ID #${rep.id} | ${escapeHtml(rep.category.toUpperCase())} | DIST: ${escapeHtml(rep.district)} | ${fmtDate(rep.created_at)}</span>
          <span>${badge}</span>
        </div>
        <h3 style="font-size:17px; margin-bottom:6px; cursor:pointer;" data-toggle-details="${rep.id}">${escapeHtml(rep.title)}</h3>

        <div style="font-size:14px; font-weight: 600; margin-bottom: 4px; display:flex; align-items:center; gap: 15px; flex-wrap:wrap;">
          <span><span class="status-dot ${dot}"></span> AI Severity: ${escapeHtml(rep.ai_severity || rep.citizen_severity)}</span>
          <span style="color:var(--ink-soft);">▲ ${rep.upvotes || 0} Confirmations</span>
          ${rep.unsolved_count > 0 ? `<span style="color:var(--red);font-weight:700;">Reopened ${rep.unsolved_count}×</span>` : ''}
        </div>

        <div id="full-details-${rep.id}" style="display:none; margin-top:12px; border-top:1px dashed var(--line); padding-top:12px;">
          <div class="ai-card">
            <h4><span style="color:var(--accent);">AI Analysis</span> ${rep.ai_category_match ? 'Category/severity matched citizen input' : 'Possible mismatch flagged'} (confidence ${Math.round((rep.ai_confidence || 0) * 100)}%)</h4>
            <p style="margin:5px 0;">${escapeHtml(rep.ai_reasoning && rep.ai_reasoning.text || '')}</p>
          </div>

          <p style="font-size:14px; color:var(--ink); line-height:1.5;"><strong>Description:</strong> ${escapeHtml(rep.description)}</p>
          <p style="font-size:14px; color:var(--accent-dark);"><strong>📍 Address:</strong> ${escapeHtml(rep.area)} (${escapeHtml(rep.ward)})</p>
          <p style="font-size:12px; color:var(--ink-soft);"><strong>Filed:</strong> ${fmtDate(rep.created_at)}${rep.resolved_at ? ` · <strong>Resolved:</strong> ${fmtDate(rep.resolved_at)}` : ''}</p>
          ${rep.image_url ? `<img src="${rep.image_url}" style="max-width:100%; border:2.5px solid var(--ink); border-radius:var(--radius-sm); margin-top:10px;" alt="Evidence">` : ''}

          <div style="margin-top: 15px; display:flex; gap: 10px; flex-wrap: wrap;">
            <button class="btn small outline" data-upvote="${rep.id}">▲ Confirm Issue</button>
            <button class="btn small" style="background:#475569; border-color:#475569;" data-toggle-code-gate="${rep.id}">Change Status (code required)</button>
            ${rep.status === 'unsolved' ? `<button class="btn small" style="background:#7c3aed; border-color:#7c3aed;" data-toggle-ngo-gate="${rep.id}">🤝 Request NGO Help</button>` : ''}
          </div>

          <div class="code-gate" id="code-gate-${rep.id}" style="display:none;">
            <strong>Enter the 6-digit code shown when this report was filed:</strong><br>
            <input type="text" maxlength="6" id="code-input-${rep.id}" placeholder="000000" style="margin:10px 0;">
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn small" style="background:var(--green); border-color:var(--green);" data-status-action="solved" data-id="${rep.id}">✅ Mark Solved</button>
              <button class="btn small" style="background:var(--red); border-color:var(--red);" data-status-action="unsolved" data-id="${rep.id}">❌ Still Unsolved (escalate)</button>
            </div>
            <div id="status-result-${rep.id}"></div>
          </div>

          ${rep.status === 'unsolved' ? `
          <div class="code-gate" id="ngo-gate-${rep.id}" style="display:none; background:#ede9fe; border-color:#7c3aed;">
            <strong>NGO Help Rule:</strong> available after 2 days of no government response for Critical issues, 3 days for Important, 5 days for Minor, 7 days for Low priority. <em>(Demo mode: available immediately.)</em>
            ${rep.ngo_manual_requested
              ? '<p style="margin-top:10px;color:var(--ink-soft);">NGO help has already been requested for this report.</p>'
              : `<div style="margin-top:10px;"><button class="btn small" style="background:#7c3aed; border-color:#7c3aed;" data-ngo-help="${rep.id}">Send NGO Request</button></div>`}
            <div id="ngo-help-result-${rep.id}"></div>
          </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  function wireIssueCardEvents() {
    document.querySelectorAll('[data-toggle-details]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-toggle-details');
        const target = document.getElementById(`full-details-${id}`);
        target.style.display = target.style.display === 'none' ? 'block' : 'none';
      });
    });

    document.querySelectorAll('[data-upvote]').forEach((el) => {
      el.addEventListener('click', async () => {
        try {
          await apiJson(`/api/reports/${el.getAttribute('data-upvote')}/upvote`, { method: 'POST' });
          loadIssueLog();
        } catch (err) {
          alert(err.message);
        }
      });
    });

    document.querySelectorAll('[data-toggle-code-gate]').forEach((el) => {
      el.addEventListener('click', () => {
        const gate = document.getElementById(`code-gate-${el.getAttribute('data-toggle-code-gate')}`);
        gate.style.display = gate.style.display === 'none' ? 'block' : 'none';
      });
    });

    document.querySelectorAll('[data-toggle-ngo-gate]').forEach((el) => {
      el.addEventListener('click', () => {
        const gate = document.getElementById(`ngo-gate-${el.getAttribute('data-toggle-ngo-gate')}`);
        gate.style.display = gate.style.display === 'none' ? 'block' : 'none';
      });
    });

    document.querySelectorAll('[data-ngo-help]').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-ngo-help');
        const resultEl = document.getElementById(`ngo-help-result-${id}`);
        el.disabled = true;
        try {
          const { notifications } = await apiJson(`/api/reports/${id}/ngo-help`, { method: 'POST' });
          resultEl.innerHTML = `<div class="result-banner ok">NGO help requested — ${notifications.ngoCount} NGO(s) tagged.</div>`;
          setTimeout(loadIssueLog, 1200);
        } catch (err) {
          resultEl.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(err.message)}</p>`;
          el.disabled = false;
        }
      });
    });

    document.querySelectorAll('[data-status-action]').forEach((el) => {
      el.addEventListener('click', async () => {
        const id = el.getAttribute('data-id');
        const newStatus = el.getAttribute('data-status-action');
        const code = document.getElementById(`code-input-${id}`).value.trim();
        const resultEl = document.getElementById(`status-result-${id}`);

        if (!code) { resultEl.innerHTML = '<p style="color:var(--red);font-size:13px;">Enter the code first.</p>'; return; }

        let reason;
        if (newStatus === 'unsolved') {
          reason = prompt('Briefly explain why this is still unresolved (optional):') || undefined;
        }

        el.disabled = true;
        try {
          const { escalation } = await apiJson(`/api/reports/${id}/status`, { method: 'POST', body: { code, newStatus, reason } });
          if (newStatus === 'unsolved' && escalation) {
            resultEl.innerHTML = `<div class="result-banner ok">Marked unsolved. Escalation email + X alert sent.${escalation.ngoTagged ? ` NGOs tagged (${escalation.ngoCount}).` : ''}</div>`;
          } else {
            resultEl.innerHTML = '<div class="result-banner ok">Marked solved — moved to the Solved list.</div>';
          }
          setTimeout(loadIssueLog, 1200);
        } catch (err) {
          resultEl.innerHTML = `<p style="color:var(--red);font-size:13px;">${escapeHtml(err.message)}</p>`;
        } finally {
          el.disabled = false;
        }
      });
    });
  }

  document.getElementById('filterState').addEventListener('change', loadIssueLog);
  document.getElementById('filterDistrict').addEventListener('change', loadIssueLog);
  document.getElementById('filterCategory').addEventListener('change', loadIssueLog);
  document.getElementById('filterStatus').addEventListener('change', loadIssueLog);

  // ---------------------------------------------------------------------
  // HOTSPOTS + DASHBOARD
  // ---------------------------------------------------------------------
  function ratingTag(r) {
    const bg = r === 'Good' ? 'var(--accent-soft)' : r === 'Needs Improvement' ? '#fef3c7' : '#fee2e2';
    return `<span class="tag mono" style="margin-left:8px;background:${bg};">${r}</span>`;
  }

  function leaderboardTable(rows, rateKey) {
    if (!rows.length) return '<p style="font-size:13px;color:var(--ink-soft);">No data yet.</p>';
    return `<table class="data-table"><thead><tr><th>Rank</th><th>District</th><th>Total</th><th>Solved</th><th>Rate</th><th>Rating</th></tr></thead><tbody>
      ${rows.map((r) => `<tr>
        <td>#${r.rank}</td>
        <td>${escapeHtml(r.district)}</td>
        <td>${r.total}</td>
        <td>${r.solved}</td>
        <td>${r[rateKey]}%</td>
        <td>${ratingTag(r.rating)}</td>
      </tr>`).join('')}
    </tbody></table>`;
  }

  async function loadInsights() {
    const hotspotContainer = document.getElementById('hotspotContainer');
    const matrixContainer = document.getElementById('dashboardMatrixContainer');
    const catHotspotContainer = document.getElementById('dashboardCategoryHotspotContainer');
    const overallHotspotContainer = document.getElementById('dashboardOverallHotspotContainer');
    const catLeaderboardContainer = document.getElementById('dashboardCategoryLeaderboardContainer');
    const overallLeaderboardContainer = document.getElementById('dashboardOverallLeaderboardContainer');

    hotspotContainer.innerHTML = '<span class="spinner"></span> Loading…';
    matrixContainer.innerHTML = '<span class="spinner"></span> Loading…';
    catHotspotContainer.innerHTML = '';
    overallHotspotContainer.innerHTML = '';
    catLeaderboardContainer.innerHTML = '';
    overallLeaderboardContainer.innerHTML = '';

    try {
      const [{ hotspots }, dashboard] = await Promise.all([
        apiJson('/api/analytics/hotspots'),
        apiJson('/api/analytics/dashboard'),
      ]);

      hotspotContainer.innerHTML = hotspots.length ? hotspots.map((h, i) => {
        const icon = i === 0 ? '🔴' : i === 1 ? '🟠' : i === 2 ? '🟡' : '⚪';
        return `<div class="hotspot-item"><span style="font-weight: 700; font-size: 1.1rem;">${icon} ${escapeHtml(h.district)}</span><span class="tag mono">${h.count} Complaints</span></div>`;
      }).join('') : '<p>No data available.</p>';

      matrixContainer.innerHTML = dashboard.matrix.length ? `<table class="data-table"><thead><tr><th>State</th><th>District</th><th>Category</th><th>Total</th><th>Solved</th><th>Pending</th><th>Success Rate</th></tr></thead><tbody>
        ${dashboard.matrix.map((m) => `<tr>
          <td>${escapeHtml(m.state)}</td>
          <td>${escapeHtml(m.district)}</td>
          <td>${escapeHtml(m.category)}</td>
          <td>${m.total}</td>
          <td>${m.solved}</td>
          <td>${m.pending}</td>
          <td>${m.successRate}%</td>
        </tr>`).join('')}
      </tbody></table>` : '<p>No analytics data available yet.</p>';

      const catKeys = Object.keys(dashboard.hotspotsByCategory);
      catHotspotContainer.innerHTML = catKeys.length ? catKeys.map((cat) => `
        <div class="subsection-label">${escapeHtml(cat)}</div>
        ${dashboard.hotspotsByCategory[cat].length
          ? dashboard.hotspotsByCategory[cat].map((h) => `<div class="hotspot-item"><span style="font-weight:700;">${escapeHtml(h.district)}</span><span class="tag mono">${h.count} Complaints</span></div>`).join('')
          : '<p style="font-size:13px;color:var(--ink-soft);">No data yet.</p>'}
      `).join('') : '<p>No analytics data available yet.</p>';

      overallHotspotContainer.innerHTML = dashboard.hotspotOverall.length ? dashboard.hotspotOverall.map((d) => `
        <div class="hotspot-item">
          <span style="font-weight:700;">#${d.rank} ${escapeHtml(d.district)}</span>
          <span style="text-align:right;font-size:13px;">
            <div>${d.totalCount} total complaints</div>
            <div style="color:var(--ink-soft);">${d.distinctCategories} different problem categories</div>
          </span>
        </div>
      `).join('') : '<p>No analytics data available yet.</p>';

      const leaderboardCats = Object.keys(dashboard.leaderboardByCategory);
      catLeaderboardContainer.innerHTML = leaderboardCats.length ? leaderboardCats.map((cat) => `
        <div class="subsection-label">${escapeHtml(cat)}</div>
        ${leaderboardTable(dashboard.leaderboardByCategory[cat], 'successRate')}
      `).join('') : '<p>No analytics data available yet.</p>';

      overallLeaderboardContainer.innerHTML = leaderboardTable(
        dashboard.leaderboardOverall.map((d) => ({ ...d, successRate: d.avgSuccessRate })),
        'successRate'
      );
    } catch (err) {
      hotspotContainer.innerHTML = `<p>Could not load: ${escapeHtml(err.message)}</p>`;
      matrixContainer.innerHTML = '';
    }
  }

  // ---------------------------------------------------------------------
  // FORUM
  // ---------------------------------------------------------------------
  async function loadForum() {
    const container = document.getElementById('forumContainer');
    container.innerHTML = '<div style="padding:20px;"><span class="spinner"></span> Loading…</div>';
    try {
      const { posts } = await apiJson('/api/forum');
      document.getElementById('forumCountTag').textContent = `${posts.length} THREADS`;
      container.innerHTML = posts.map((post) => `
        <div style="padding: 24px; border-bottom: 3px solid var(--line);">
          <div style="font-size: 12px; font-weight: 700; color: var(--ink-soft); text-transform: uppercase; margin-bottom: 8px;">THREAD ID #${post.id} | BY: ${escapeHtml(post.name)} · ${escapeHtml(post.address)}</div>
          <div style="font-size: 15px; line-height: 1.6; margin-bottom: 16px;">${escapeHtml(post.problem)}</div>
          <div style="display: flex; gap: 10px; align-items: center; flex-wrap:wrap;">
            <button class="btn small outline" data-forum-vote="${post.id}" data-direction="up">▲</button>
            <span class="mono" style="font-weight:700;">${post.votes}</span>
            <button class="btn small outline" data-forum-vote="${post.id}" data-direction="down">▼</button>
            <button class="btn small outline" data-toggle-replies="${post.id}">💬 Replies</button>
          </div>
          <div id="replies-${post.id}" style="display:none; margin-top:16px; padding-left:16px; border-left:3px solid var(--bg-alt);">
            <div id="replies-list-${post.id}"></div>
            <div class="form-row" style="margin-top:12px;">
              <div class="field"><input type="text" id="reply-name-${post.id}" placeholder="Your name"></div>
              <div class="field"><input type="text" id="reply-message-${post.id}" placeholder="Write a reply..."></div>
            </div>
            <button class="btn small" data-submit-reply="${post.id}">Post Reply</button>
          </div>
        </div>
      `).join('') || '<div style="padding:24px;">No threads yet — be the first to post.</div>';

      container.querySelectorAll('[data-forum-vote]').forEach((el) => {
        el.addEventListener('click', async () => {
          await apiJson(`/api/forum/${el.getAttribute('data-forum-vote')}/vote`, { method: 'POST', body: { direction: el.getAttribute('data-direction') } });
          loadForum();
        });
      });

      container.querySelectorAll('[data-toggle-replies]').forEach((el) => {
        el.addEventListener('click', async () => {
          const id = el.getAttribute('data-toggle-replies');
          const panel = document.getElementById(`replies-${id}`);
          const opening = panel.style.display === 'none';
          panel.style.display = opening ? 'block' : 'none';
          if (opening) await loadReplies(id);
        });
      });

      container.querySelectorAll('[data-submit-reply]').forEach((el) => {
        el.addEventListener('click', async () => {
          const id = el.getAttribute('data-submit-reply');
          const name = document.getElementById(`reply-name-${id}`).value.trim();
          const message = document.getElementById(`reply-message-${id}`).value.trim();
          if (!name || !message) { alert('Name and reply text required.'); return; }
          try {
            await apiJson(`/api/forum/${id}/replies`, { method: 'POST', body: { name, message } });
            document.getElementById(`reply-name-${id}`).value = '';
            document.getElementById(`reply-message-${id}`).value = '';
            await loadReplies(id);
          } catch (err) {
            alert(`Could not post reply: ${err.message}`);
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<div style="padding:24px;">Could not load forum: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadReplies(postId) {
    const listEl = document.getElementById(`replies-list-${postId}`);
    listEl.innerHTML = '<span class="spinner"></span> Loading…';
    try {
      const { replies } = await apiJson(`/api/forum/${postId}/replies`);
      listEl.innerHTML = replies.length ? replies.map((r) => `
        <div style="padding:8px 0; border-bottom:1px dashed var(--bg-alt); font-size:13.5px;">
          <b>${escapeHtml(r.name)}</b> <span style="color:var(--ink-soft);">· ${fmtDate(r.created_at)}</span><br>${escapeHtml(r.message)}
        </div>
      `).join('') : '<p style="font-size:13px;color:var(--ink-soft);">No replies yet.</p>';
    } catch (err) {
      listEl.innerHTML = `<p style="font-size:13px;color:var(--red);">Could not load replies: ${escapeHtml(err.message)}</p>`;
    }
  }

  document.getElementById('forumSubmitBtn').addEventListener('click', async () => {
    const name = document.getElementById('fName').value.trim();
    const address = document.getElementById('fAddress').value.trim();
    const problem = document.getElementById('fProblem').value.trim();
    if (!name || !address || !problem) { alert('All fields required.'); return; }

    try {
      await apiJson('/api/forum', { method: 'POST', body: { name, address, problem } });
      document.getElementById('fName').value = '';
      document.getElementById('fAddress').value = '';
      document.getElementById('fProblem').value = '';
      loadForum();
    } catch (err) {
      alert(`Could not publish: ${err.message}`);
    }
  });

  // ---------------------------------------------------------------------
  // CONTACT — NGO
  // ---------------------------------------------------------------------
  async function loadNgos() {
    const district = document.getElementById('ngoDistrictFilter').value;
    const category = document.getElementById('ngoCategoryFilter').value;
    const container = document.getElementById('ngoContainer');
    container.innerHTML = '<span class="spinner"></span> Loading…';
    try {
      const params = new URLSearchParams();
      if (district !== 'All') params.set('district', district);
      if (category !== 'All') params.set('category', category);
      const { ngos } = await apiJson(`/api/ngos?${params.toString()}`);
      container.innerHTML = ngos.length ? ngos.map((n) => `
        <div class="ngo-card">
          <div class="name">${escapeHtml(n.name)}</div>
          <div class="meta">${escapeHtml(n.district)}${n.category ? ` · ${escapeHtml(n.category)}` : ''}</div>
          <div class="meta">${n.twitter_handle ? `@${escapeHtml(n.twitter_handle)}` : ''}</div>
          <div class="meta">${n.email ? escapeHtml(n.email) : ''}</div>
          <button class="btn small outline" style="margin-top:10px;" data-assign-ngo="${n.id}">Assign to My Issue</button>
        </div>
      `).join('') : '<p>No NGOs configured for this selection yet.</p>';

      container.querySelectorAll('[data-assign-ngo]').forEach((el) => {
        el.addEventListener('click', () => {
          const reportId = document.getElementById('ngoAssignReportId').value.trim();
          if (!reportId) { alert('Enter the report ID first.'); return; }
          prepareNgoApplication(reportId, el.getAttribute('data-assign-ngo'));
        });
      });
    } catch (err) {
      container.innerHTML = `<p>Could not load NGOs: ${escapeHtml(err.message)}</p>`;
    }
  }

  document.getElementById('ngoDistrictFilter').addEventListener('change', loadNgos);
  document.getElementById('ngoCategoryFilter').addEventListener('change', loadNgos);

  async function prepareNgoApplication(reportId, ngoId) {
    const panel = document.getElementById('ngoApplicationPanel');
    panel.innerHTML = '<div class="panel"><span class="spinner"></span> Preparing application…</div>';
    try {
      const { report, ngo, draft } = await apiJson(`/api/reports/${reportId}/ngo-application`, { method: 'POST', body: { ngoId } });

      panel.innerHTML = `
        <div class="draft-box">
          <h4>Application to ${escapeHtml(ngo.name)} — for Report #${report.id}: ${escapeHtml(report.title)}</h4>
          <input type="text" id="ngoAppSubject" value="${escapeHtml(draft.subject)}" style="margin-bottom:10px;">
          <textarea id="ngoAppBody">${escapeHtml(draft.body)}</textarea>
        </div>
        <div class="draft-box">
          <h4>X Post Draft (will tag @shakyatyagi${ngo.twitter_handle ? ` and @${escapeHtml(ngo.twitter_handle)}` : ''})</h4>
          <textarea id="ngoAppXPost" style="min-height:80px;">${escapeHtml(draft.xPost)}</textarea>
        </div>
        <button class="btn block" id="ngoAppSendBtn">Confirm &amp; Send Application</button>
        <div id="ngoAppResultBanner"></div>
      `;

      document.getElementById('ngoAppSendBtn').addEventListener('click', async () => {
        const btn = document.getElementById('ngoAppSendBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Sending…';
        try {
          const subject = document.getElementById('ngoAppSubject').value;
          const body = document.getElementById('ngoAppBody').value;
          const xPost = document.getElementById('ngoAppXPost').value;
          const { notifications } = await apiJson(`/api/reports/${reportId}/ngo-application/send`, {
            method: 'POST',
            body: { ngoId, subject, body, xPost },
          });
          const emailNote = notifications.email.dryRun ? 'simulated (dry-run)' : (notifications.email.success ? 'sent' : `failed: ${notifications.email.error}`);
          const xNote = notifications.x.dryRun ? 'simulated (dry-run)' : (notifications.x.success ? 'posted' : `failed: ${notifications.x.error}`);
          document.getElementById('ngoAppResultBanner').innerHTML = `<div class="result-banner ok">Email ${emailNote}. X post ${xNote}.</div>`;
          btn.style.display = 'none';
        } catch (err) {
          document.getElementById('ngoAppResultBanner').innerHTML = `<div class="result-banner warn">${escapeHtml(err.message)}</div>`;
          btn.disabled = false;
          btn.textContent = 'Confirm & Send Application';
        }
      });
    } catch (err) {
      panel.innerHTML = `<div class="panel"><p style="color:var(--red);">Could not prepare application: ${escapeHtml(err.message)}</p></div>`;
    }
  }

  // ---------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------
  initLiveFeed();
})();
