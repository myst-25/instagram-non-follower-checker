// ==UserScript==
// @name         Instagram Non-Followers Checker (Auto Collect)
// @namespace    https://tampermonkey.net/
// @version      2.0
// @description  Auto-collect loaded Followers/Following from Instagram popup and compare who doesn't follow back.
// @match        https://www.instagram.com/*
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;
  if (document.getElementById('tm-ig-panel')) return;

  const state = {
    followers: new Set(),
    following: new Set(),
    result: [],
    collecting: false,
    cancelRequested: false
  };

  const RESERVED = new Set([
    'accounts','about','api','challenge','developer','directory','direct',
    'emails','explore','graphql','legal','login','p','privacy','reels',
    'signup','stories','terms','tv','web'
  ]);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'style') Object.assign(node.style, v);
      else if (k === 'className') node.className = v;
      else if (k in node) node[k] = v;
      else node.setAttribute(k, v);
    }
    children.forEach(c => node.appendChild(c));
    return node;
  }

  function setStatus(msg, error = false) {
    statusBox.textContent = msg;
    statusBox.style.color = error ? '#ff7b7b' : '#d1d5db';
  }

  function refreshStats() {
    statsBox.textContent =
      `Followers: ${state.followers.size} | Following: ${state.following.size} | Non-followers: ${state.result.length}`;
  }

  function renderResults() {
    output.value = state.result.join('\n');
    resultTitle.textContent = state.result.length
      ? `Not following back (${state.result.length})`
      : 'No results yet';
    refreshStats();
  }

  function getOpenDialog() {
    const dialogs = [...document.querySelectorAll('div[role="dialog"]')];
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  function getScrollable(dialog) {
    const candidates = [...dialog.querySelectorAll('div')];
    let best = null;
    let bestScore = 0;

    for (const node of candidates) {
      const score = node.scrollHeight - node.clientHeight;
      if (score > bestScore && node.clientHeight > 100) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  function extractUsernames(dialog) {
    const anchors = [...dialog.querySelectorAll('a[href]')];
    const set = new Set();

    for (const a of anchors) {
      const href = (a.getAttribute('href') || '').trim();
      const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
      if (!match) continue;
      const username = match[1];
      if (!username || RESERVED.has(username.toLowerCase())) continue;
      set.add(username);
    }
    return set;
  }

  async function autoCollect(target) {
    if (state.collecting) {
      setStatus('A collection is already running.', true);
      return;
    }

    const dialog = getOpenDialog();
    if (!dialog) {
      setStatus('Open the Followers or Following popup first.', true);
      return;
    }

    const scroller = getScrollable(dialog);
    if (!scroller) {
      setStatus('Could not find the scrollable popup list.', true);
      return;
    }

    state.collecting = true;
    state.cancelRequested = false;
    state.result = [];
    output.value = '';
    resultTitle.textContent = `Collecting ${target}...`;
    refreshStats();

    const collected = new Set();
    let stagnantRounds = 0;
    let lastCount = 0;
    let rounds = 0;

    try {
      while (!state.cancelRequested) {
        rounds++;

        extractUsernames(dialog).forEach(u => collected.add(u));

        const beforeHeight = scroller.scrollHeight;
        scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));

        await sleep(1400 + Math.floor(Math.random() * 700));

        extractUsernames(dialog).forEach(u => collected.add(u));

        const afterHeight = scroller.scrollHeight;
        const currentCount = collected.size;

        setStatus(`Collecting ${target}... ${currentCount} usernames found (pass ${rounds})`);
        resultTitle.textContent = `Collecting ${target}... ${currentCount}`;

        if (currentCount === lastCount && afterHeight === beforeHeight) {
          stagnantRounds++;
        } else {
          stagnantRounds = 0;
        }

        lastCount = currentCount;

        if (stagnantRounds >= 4) break;
        if (rounds >= 600) break; // hard safety cap
      }

      state[target] = collected;
      setStatus(
        state.cancelRequested
          ? `Stopped. Saved partial ${target}: ${collected.size}`
          : `Finished collecting ${target}: ${collected.size}`
      );
      resultTitle.textContent = `Saved ${target}: ${collected.size}`;
    } catch (e) {
      setStatus(`Error while collecting ${target}: ${e.message}`, true);
    } finally {
      state.collecting = false;
      state.cancelRequested = false;
      refreshStats();
    }
  }

  function compareLists() {
    if (!state.following.size) {
      setStatus('Collect Following first.', true);
      return;
    }
    if (!state.followers.size) {
      setStatus('Collect Followers first.', true);
      return;
    }

    state.result = [...state.following]
      .filter(u => !state.followers.has(u))
      .sort((a, b) => a.localeCompare(b));

    renderResults();
    setStatus(`Comparison complete. Found ${state.result.length} non-followers.`);
  }

  async function copyResults() {
    if (!state.result.length) {
      setStatus('Nothing to copy yet.', true);
      return;
    }

    const txt = state.result.join('\n');
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(txt, 'text');
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(txt);
    } else {
      output.select();
      document.execCommand('copy');
    }
    setStatus('Copied results to clipboard.');
  }

  function downloadResults() {
    if (!state.result.length) {
      setStatus('Nothing to export yet.', true);
      return;
    }
    const blob = new Blob([state.result.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'instagram-non-followers.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
    setStatus('Downloaded TXT file.');
  }

  function stopCollect() {
    if (!state.collecting) {
      setStatus('No active collection.', true);
      return;
    }
    state.cancelRequested = true;
    setStatus('Stopping after current pass...');
  }

  function clearAll() {
    state.followers.clear();
    state.following.clear();
    state.result = [];
    state.collecting = false;
    state.cancelRequested = false;
    output.value = '';
    resultTitle.textContent = 'No results yet';
    setStatus('Cleared all saved data.');
    refreshStats();
  }

  const style = el('style', {
    text: `
      #tm-ig-panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        width: 370px;
        max-width: calc(100vw - 24px);
        z-index: 2147483647;
        background: #111827;
        color: #f9fafb;
        border: 1px solid #374151;
        border-radius: 14px;
        box-shadow: 0 12px 32px rgba(0,0,0,.35);
        overflow: hidden;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      #tm-ig-panel * { box-sizing: border-box; }
      #tm-ig-header {
        padding: 12px 14px;
        background: #0f172a;
        border-bottom: 1px solid #374151;
        font-size: 14px;
        font-weight: 700;
      }
      #tm-ig-body { padding: 12px; }
      #tm-ig-stats, #tm-ig-status, #tm-ig-result-title, #tm-ig-help {
        font-size: 12px;
        line-height: 1.45;
        margin-bottom: 8px;
      }
      #tm-ig-help { color: #9ca3af; }
      #tm-ig-status { min-height: 18px; color: #d1d5db; }
      #tm-ig-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 10px;
      }
      #tm-ig-grid button, #tm-ig-row2 button, #tm-ig-row3 button {
        border: 0;
        border-radius: 10px;
        padding: 10px 12px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
      }
      #tm-ig-row2, #tm-ig-row3 {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 8px;
      }
      .btn-blue { background: #2563eb; color: #fff; }
      .btn-blue:hover { background: #1d4ed8; }
      .btn-green { background: #10b981; color: #fff; }
      .btn-green:hover { background: #059669; }
      .btn-gray { background: #4b5563; color: #fff; }
      .btn-gray:hover { background: #374151; }
      .btn-red { background: #dc2626; color: #fff; }
      .btn-red:hover { background: #b91c1c; }
      #tm-ig-output {
        width: 100%;
        min-height: 200px;
        max-height: 320px;
        resize: vertical;
        border: 1px solid #374151;
        border-radius: 10px;
        background: #0b1220;
        color: #e5e7eb;
        padding: 10px;
        font-size: 12px;
        line-height: 1.45;
      }
    `
  });

  const panel = el('div', { id: 'tm-ig-panel' });
  const header = el('div', { id: 'tm-ig-header', text: 'Instagram Non-Followers Checker' });
  const body = el('div', { id: 'tm-ig-body' });

  const statsBox = el('div', { id: 'tm-ig-stats', text: 'Followers: 0 | Following: 0 | Non-followers: 0' });
  const helpBox = el('div', {
    id: 'tm-ig-help',
    text: 'Open your Followers or Following popup first, then use Collect.'
  });
  const statusBox = el('div', {
    id: 'tm-ig-status',
    text: 'Ready.'
  });
  const resultTitle = el('div', {
    id: 'tm-ig-result-title',
    text: 'No results yet'
  });

  const grid = el('div', { id: 'tm-ig-grid' });
  const btnCollectFollowing = el('button', { className: 'btn-blue', text: 'Collect Following' });
  const btnCollectFollowers = el('button', { className: 'btn-blue', text: 'Collect Followers' });
  const btnCompare = el('button', { className: 'btn-green', text: 'Compare' });
  const btnStop = el('button', { className: 'btn-red', text: 'Stop Collect' });

  const output = el('textarea', {
    id: 'tm-ig-output',
    readOnly: true,
    placeholder: 'Results will appear here...'
  });

  const row2 = el('div', { id: 'tm-ig-row2' });
  const btnCopy = el('button', { className: 'btn-gray', text: 'Copy Results' });
  const btnDownload = el('button', { className: 'btn-gray', text: 'Download TXT' });

  const row3 = el('div', { id: 'tm-ig-row3' });
  const btnClear = el('button', { className: 'btn-gray', text: 'Clear' });
  const btnHide = el('button', { className: 'btn-gray', text: 'Hide Panel' });

  const miniBtn = el('button', {
    text: 'IG Checker',
    style: {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      display: 'none',
      background: '#111827',
      color: '#fff',
      border: '1px solid #374151',
      borderRadius: '999px',
      padding: '10px 14px',
      cursor: 'pointer',
      boxShadow: '0 8px 20px rgba(0,0,0,.25)'
    }
  });

  btnCollectFollowing.onclick = () => autoCollect('following');
  btnCollectFollowers.onclick = () => autoCollect('followers');
  btnCompare.onclick = compareLists;
  btnStop.onclick = stopCollect;
  btnCopy.onclick = copyResults;
  btnDownload.onclick = downloadResults;
  btnClear.onclick = clearAll;
  btnHide.onclick = () => {
    panel.style.display = 'none';
    miniBtn.style.display = 'block';
  };
  miniBtn.onclick = () => {
    panel.style.display = 'block';
    miniBtn.style.display = 'none';
  };

  grid.append(btnCollectFollowing, btnCollectFollowers, btnCompare, btnStop);
  row2.append(btnCopy, btnDownload);
  row3.append(btnClear, btnHide);
  body.append(statsBox, helpBox, statusBox, resultTitle, grid, output, row2, row3);
  panel.append(header, body);

  document.documentElement.appendChild(style);
  document.body.appendChild(panel);
  document.body.appendChild(miniBtn);
})();
