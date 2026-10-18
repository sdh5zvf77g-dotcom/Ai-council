(function () {
  "use strict";

  function showError(msg) {
    var b = document.getElementById("errBanner");
    if (!b) return;
    b.style.display = "block";
    b.textContent = "AI Council error: " + msg + " (tap to dismiss)";
    b.onclick = function () { b.style.display = "none"; };
  }

  window.onerror = function (msg, src, line, col) {
    showError(String(msg) + " @" + (line || 0) + ":" + (col || 0));
    return false;
  };
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    showError("Promise: " + (r && r.message ? r.message : r));
  });

  var KEY = "aicouncil.v2";
  var TEMPLATES = {
    build: "Build a clean, mobile-first single-file web app that ",
    research: "Research deeply and report findings on ",
    improve: "Improve the AI Council app itself. Redesign for clarity, deeper reasoning, and better UX while keeping all core features.",
    debug: "Debug and fix the following code / behaviour: "
  };
  var ROLE_COLORS = {
    Strategist: "#7c8cff",
    Skeptic: "#f87171",
    Builder: "#4ade80",
    Researcher: "#3dd9c5",
    Creative: "#fbbf24"
  };
  var ROLE_PROMPTS = {
    Strategist: "You are the Tech Lead / Architect. Clarify goals and success criteria. Design architecture for a single-file mobile web app. Sequence highest-risk work first. Produce a concrete shared plan. Be specific.",
    Researcher: "You are the deep research engineer. You MUST use any TEAM TOOLS / WEB RESEARCH block in the prompt. First section MUST be Findings from tools: with 3-8 concrete bullets drawn from the research. Never invent citations. Cover APIs, mobile/Safari constraints, storage, edge cases. Prefer vanilla JS + CSS offline on iPhone Safari.",
    Skeptic: "You are the senior QA / Risk Lead. Surface real failure modes, missing edge cases, mobile/Safari bugs. Challenge vague plans. Demand acceptance criteria. Be constructive but ruthless.",
    Builder: "You are a senior full-stack engineer for single-file mobile web apps. Translate the plan into complete working code - never placeholders. Prefer vanilla JS and CSS variables. Dark theme by default. When delivering, return the FULL HTML document.",
    Creative: "You are the product / UX lead. Improve clarity, flow, visual hierarchy while staying practical for a single-file mobile web app."
  };

  function uid() {
    return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function defaultState() {
    return {
      id: uid(),
      title: "Untitled",
      created: Date.now(),
      updated: Date.now(),
      problem: "",
      messages: [],
      members: [
        { name: "Ava", role: "Strategist", on: true },
        { name: "Ben", role: "Skeptic", on: true },
        { name: "Cleo", role: "Builder", on: true },
        { name: "Dev", role: "Researcher", on: true },
        { name: "Eli", role: "Creative", on: false }
      ],
      board: { points: [], concerns: [], steps: [] },
      research: "",
      buildHistory: [],
      refs: "",
      docs: [],
      files: [],
      phase: "idle"
    };
  }

  function defaultSettings() {
    return {
      engine: "local",
      url: "",
      model: "",
      key: "",
      provider: "openai",
      buildMode: true,
      webResearch: true,
      autopilot: false,
      planRounds: 6,
      buildIters: 6,
      autosave: true,
      showContinue: true
    };
  }

  var state = defaultState();
  var settings = defaultSettings();
  var busy = false;
  var building = false;
  var stopBuild = false;
  var liveStream = null;
  var pendingImage = null;

  function $(id) { return document.getElementById(id); }

  function sGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function sSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  function loadAll() {
    try {
      var s = JSON.parse(sGet(KEY + ".settings") || "null");
      if (s) settings = Object.assign(defaultSettings(), s);
    } catch (e) {}
    try {
      var p = JSON.parse(sGet(KEY + ".current") || "null");
      if (p && p.messages) state = Object.assign(defaultState(), p);
    } catch (e) {}
  }

  function saveCurrent() {
    state.updated = Date.now();
    sSet(KEY + ".current", JSON.stringify(state));
  }
  function saveSettings() {
    sSet(KEY + ".settings", JSON.stringify(settings));
  }
  function projects() {
    try { return JSON.parse(sGet(KEY + ".projects") || "[]"); } catch (e) { return []; }
  }
  function writeProjects(list) {
    return sSet(KEY + ".projects", JSON.stringify(list.slice(0, 40)));
  }
  function saveProject(manual) {
    if (!state.messages.length && !state.problem) {
      if (manual) toast("Nothing to save yet");
      return;
    }
    saveCurrent();
    var list = projects();
    var i = list.findIndex(function (p) { return p.id === state.id; });
    var copy = JSON.parse(JSON.stringify(state));
    if (i >= 0) list[i] = copy;
    else list.unshift(copy);
    var ok = writeProjects(list);
    if (manual) toast(ok ? "Project saved" : "Storage full - use Export");
  }
  function autosave() {
    saveCurrent();
    if (settings.autosave) saveProject(false);
  }

  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  function setStatus(text) {
    var bar = $("statusBar");
    if (!text) { bar.classList.remove("show"); return; }
    $("statusText").textContent = text;
    bar.classList.add("show");
  }

  function openDialog(id) {
    var d = $(id);
    if (d && !d.open) d.showModal();
  }
  function closeDialog(el) {
    var d = typeof el === "string" ? $(el) : el;
    if (d && d.open) d.close();
  }

  function uiConfirm(message, title) {
    return new Promise(function (res) {
      $("tConfirm").textContent = title || "Confirm";
      $("confirmMsg").textContent = message || "";
      function done(v) {
        $("confirmYes").onclick = null;
        $("confirmNo").onclick = null;
        closeDialog("dConfirm");
        res(v);
      }
      $("confirmYes").onclick = function () { done(true); };
      $("confirmNo").onclick = function () { done(false); };
      openDialog("dConfirm");
    });
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scrollBottom() {
    var chat = $("chat");
    requestAnimationFrame(function () { chat.scrollTop = chat.scrollHeight; });
  }

  function updatePhaseChip() {
    var map = {
      idle: "Idle", research: "Research", architecture: "Architecture",
      plan: "Plan", converge: "Converge", build: "Build", testing: "Testing", done: "Done"
    };
    $("phaseChip").textContent = map[state.phase] || state.phase || "Idle";
  }

  function syncControls() {
    var hasProblem = !!state.problem;
    $("bBuild").disabled = (busy && !building) || !hasProblem;
    $("bBuild").textContent = building ? "Stop" : "Build";
    $("bContinue").style.display = settings.showContinue && hasProblem ? "" : "none";
    $("bDownload").classList.toggle("hidden", !state.buildHistory.length);
    $("sendBtn").disabled = busy;
  }

  function board() {
    if (!state.board) state.board = { points: [], concerns: [], steps: [] };
    return state.board;
  }

  function updateBoard(m) {
    if (!m.claim || m.who === "You" || m.who === "System") return;
    var b = board();
    var entry = { by: m.who, text: m.claim, support: [] };
    if (m.kind === "challenge") b.concerns.push({ by: m.who, to: m.to, text: m.claim });
    else if (m.role === "Builder") b.steps.push(entry);
    else b.points.push(entry);
    ["points", "concerns", "steps"].forEach(function (k) {
      if (b[k].length > 14) b[k] = b[k].slice(-14);
    });
  }

  function boardSummary() {
    var b = board();
    var parts = [];
    var agreed = b.points.filter(function (p) { return p.support.length; }).map(function (p) {
      return p.text + " (" + p.by + ")";
    });
    if (agreed.length) parts.push("Backed points: " + agreed.slice(-4).join("; "));
    if (b.concerns.length) {
      parts.push("Open concerns: " + b.concerns.slice(-3).map(function (c) {
        return c.by + ": " + c.text;
      }).join("; "));
    }
    if (b.steps.length) {
      parts.push("Build steps: " + b.steps.slice(-3).map(function (s) { return s.text; }).join("; "));
    }
    return parts.join("\n");
  }

  function renderBoard() {
    var b = state.board;
    var d = document.createElement("details");
    d.className = "card";
    d.open = true;
    var html = "<summary>Shared board</summary>";
    if (b.points.length) {
      html += "<h4 style='margin:8px 0 3px;font-size:0.72rem;color:#8b92b8'>Agreed points</h4><ul style='margin:0;padding-left:16px'>" +
        b.points.slice(-6).map(function (p) {
          return "<li>" + esc(p.text) + " <small>(" + esc(p.by) + ")</small></li>";
        }).join("") + "</ul>";
    }
    if (b.concerns.length) {
      html += "<h4 style='margin:8px 0 3px;font-size:0.72rem;color:#8b92b8'>Open concerns</h4><ul style='margin:0;padding-left:16px'>" +
        b.concerns.slice(-5).map(function (c) {
          return "<li>" + esc(c.by) + ": " + esc(c.text) + "</li>";
        }).join("") + "</ul>";
    }
    d.innerHTML = html;
    return d;
  }

  function renderMsg(m) {
    var div = document.createElement("div");
    div.className = "msg " + (m.who === "You" ? "you" : m.who === "System" ? "system" : "");
    var color = ROLE_COLORS[m.role] || "#8b92b8";
    var whoHtml = "";
    if (m.who !== "You" && m.who !== "System") {
      whoHtml = '<div class="who"><span class="dot" style="background:' + color + '"></span>' +
        esc(m.who) + " " + esc(m.role || "") + "</div>";
    }
    var body = esc(m.text);
    if (m.image && m.image.dataUrl) {
      body += '<img src="' + m.image.dataUrl + '" alt="attached" style="max-width:100%;border-radius:8px;margin-top:6px">';
    }
    if (m.kind === "deliverable" && m.code) {
      div.innerHTML = whoHtml +
        '<div class="deliv"><div class="dh">Deliverable v' + (m.version || "?") + "</div><div>" + body +
        '</div><div class="actions">' +
        '<button type="button" class="btn primary" data-act="preview" data-v="' + m.version + '">Preview</button>' +
        '<button type="button" class="btn" data-act="dl" data-v="' + m.version + '">Download</button></div></div>';
      var pBtn = div.querySelector('[data-act="preview"]');
      var dBtn = div.querySelector('[data-act="dl"]');
      if (pBtn) pBtn.onclick = function () { previewBuild(m.version); };
      if (dBtn) dBtn.onclick = function () { downloadBuild(m.version); };
    } else {
      div.innerHTML = whoHtml + '<div class="bubble">' + body + "</div>";
    }
    return div;
  }

  function render() {
    try {
      var chat = $("chat");
      if (!chat) return;
      var hasMsgs = state.messages && state.messages.length > 0;
      var frag = document.createDocumentFragment();

      if (!hasMsgs) {
        var empty = document.createElement("div");
        empty.className = "empty";
        empty.id = "emptyState";
        empty.innerHTML =
          "<h3>AI Council</h3>" +
          "<p>A multi-agent team that researches, plans deeply, builds, and tests web apps for you.</p>" +
          '<div class="tpl-grid">' +
          '<button type="button" class="tpl-btn" data-tpl="build">Build an app</button>' +
          '<button type="button" class="tpl-btn" data-tpl="research">Research a topic</button>' +
          '<button type="button" class="tpl-btn" data-tpl="improve">Improve this app</button>' +
          '<button type="button" class="tpl-btn" data-tpl="debug">Debug / fix code</button></div>';
        frag.appendChild(empty);
        var btns = empty.querySelectorAll("[data-tpl]");
        for (var i = 0; i < btns.length; i++) {
          (function (btn) {
            btn.onclick = function () {
              var t = TEMPLATES[btn.getAttribute("data-tpl")] || "";
              var inp = $("userInput");
              if (inp) { inp.value = t; inp.focus(); }
            };
          })(btns[i]);
        }
      } else {
        if (state.board && (state.board.points.length || state.board.concerns.length)) {
          frag.appendChild(renderBoard());
        }
        if (state.research) {
          var c = document.createElement("details");
          c.className = "card";
          c.innerHTML = "<summary>Research findings</summary><div style='margin-top:6px;white-space:pre-wrap;font-size:0.85rem'>" +
            esc(state.research).slice(0, 3000) + "</div>";
          frag.appendChild(c);
        }
        for (var j = 0; j < state.messages.length; j++) {
          frag.appendChild(renderMsg(state.messages[j]));
        }
      }

      chat.innerHTML = "";
      chat.appendChild(frag);
      updatePhaseChip();
      syncControls();
      scrollBottom();
    } catch (err) {
      showError("render: " + (err && err.message ? err.message : err));
    }
  }

  function isRemote() {
    return settings.engine === "custom" && !!settings.url;
  }

  function callModel(system, user, opts) {
    opts = opts || {};
    if (!settings.url) return Promise.reject(new Error("No API endpoint configured. Open Settings and choose Custom API endpoint."));
    if (!settings.model) return Promise.reject(new Error("No model configured. Choose a provider preset or enter a model name."));
    if (!settings.key && settings.provider !== "local") return Promise.reject(new Error("No API key configured. Enter your provider key in Settings."));
    var timeout = opts.ms || 90000;
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, timeout);
    var headers = { "Content-Type": "application/json" };
    if (settings.key) headers["Authorization"] = "Bearer " + settings.key;
    var provider = settings.provider || "openai";
    var body;
    if (provider === "anthropic") {
      headers["x-api-key"] = settings.key;
      headers["anthropic-version"] = "2023-06-01";
      delete headers["Authorization"];
      body = { model: settings.model, max_tokens: 4096, system: system, messages: [{ role: "user", content: user }] };
    } else {
      var uContent = user;
      if (opts.image && opts.image.dataUrl) {
        uContent = [
          { type: "text", text: String(user) },
          { type: "image_url", image_url: { url: opts.image.dataUrl } }
        ];
      }
      body = {
        model: settings.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: uContent }
        ],
        temperature: 0.55,
        max_tokens: 4096
      };
    }
    return fetch(settings.url, {
      method: "POST",
      headers: headers,
      signal: ctl.signal,
      body: JSON.stringify(body)
    }).then(function (r) {
      clearTimeout(to);
      if (!r.ok) {
        return r.text().then(function (t) {
          throw new Error("HTTP " + r.status + " " + String(t).replace(/\s+/g, " ").slice(0, 180));
        });
      }
      return r.json();
    }).then(function (j) {
      var text;
      if (provider === "anthropic") {
        text = (j.content || []).map(function (c) { return c.text || ""; }).join("");
      } else {
        text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      }
      if (!text) throw new Error("Empty reply from model");
      return String(text).trim();
    }).catch(function (e) {
      clearTimeout(to);
      if (e && e.name === "AbortError") throw new Error("Timed out waiting for the model");
      if (e && (e instanceof TypeError || /fetch/i.test(e.message || ""))) throw new Error("Network/CORS error. Check endpoint, internet connection, and provider browser-access policy.");
      throw e;
    });
  }

  var LOCAL_CLAIMS = {
    Strategist: ["define clear success criteria and minimal scope first", "sequence the highest-risk piece before UI polish", "keep the data model tiny and UI states explicit"],
    Skeptic: ["validate the core assumption with a concrete test", "account for offline / Safari private-mode storage limits", "define what done looks like before more code"],
    Builder: ["implement a minimal vertical slice that already runs", "structure HTML with clear sections and CSS variables", "keep logic modular in one file"],
    Researcher: ["prefer well-supported browser APIs", "look for proven single-file patterns", "note mobile keyboard and viewport behaviour"],
    Creative: ["simplify first-run to one clear action", "use progressive disclosure", "make status obvious without clutter"]
  };

  function localReply(member) {
    var active = state.members.filter(function (m) { return m.on; }).length || 1;
    var cm = state.messages.filter(function (m) { return m.who !== "You" && m.who !== "System"; });
    var phaseIdx = Math.min(Math.floor(cm.length / active), 3);
    var claims = LOCAL_CLAIMS[member.role] || LOCAL_CLAIMS.Strategist;
    var mine = cm.filter(function (m) { return m.who === member.name; }).length;
    var claim = claims[mine % claims.length];
    var hints = [
      "DEMO MODE (not a real AI model): in research phase, understand constraints before design.",
      "DEMO MODE (not a real AI model): for architecture, lock data shape and main screens now.",
      "DEMO MODE (not a real AI model): plan needs explicit acceptance criteria.",
      "DEMO MODE (not a real AI model): converge on one concrete plan for the Builder."
    ];
    return { text: hints[phaseIdx] + " Specifically: " + claim + ".", claim: claim, kind: "build", role: member.role };
  }

  function searchWiki(q) {
    return fetch("https://en.wikipedia.org/w/api.php?action=opensearch&search=" + encodeURIComponent(q) + "&limit=4&namespace=0&format=json&origin=*")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j[1] || !j[1].length) return [];
        return Promise.all(j[1].slice(0, 3).map(function (t) {
          return fetch("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t))
            .then(function (r) { return r.ok ? r.json() : null; })
            .catch(function () { return null; });
        })).then(function (pages) {
          return pages.filter(Boolean).map(function (p) {
            return p.extract ? ("Wikipedia - " + (p.title || "") + ": " + String(p.extract).slice(0, 420)) : null;
          }).filter(Boolean);
        });
      })
      .catch(function () { return []; });
  }

  function searchDdg(q) {
    return fetch("https://api.duckduckgo.com/?q=" + encodeURIComponent(q) + "&format=json&no_redirect=1&no_html=1&skip_disambig=1")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j) return [];
        var bits = [];
        if (j.AbstractText) bits.push("DuckDuckGo - " + (j.Heading || "summary") + ": " + String(j.AbstractText).slice(0, 420));
        if (j.Answer) bits.push("Answer: " + String(j.Answer).slice(0, 240));
        (j.RelatedTopics || []).slice(0, 4).forEach(function (t) {
          if (t.Text) bits.push("Related: " + String(t.Text).slice(0, 200));
        });
        return bits;
      })
      .catch(function () { return []; });
  }

  function doResearch(topic) {
    setStatus("Researching: " + topic.slice(0, 40) + "...");
    var queries = [topic, topic + " best practices", topic + " mobile web app"];
    var chain = Promise.resolve([]);
    queries.forEach(function (q) {
      chain = chain.then(function (acc) {
        return Promise.all([searchWiki(q), searchDdg(q)]).then(function (pair) {
          return acc.concat(pair[0]).concat(pair[1]);
        });
      });
    });
    return chain.then(function (results) {
      var seen = {};
      var unique = [];
      results.forEach(function (r) {
        var key = r.slice(0, 80);
        if (!seen[key]) { seen[key] = true; unique.push(r); }
      });
      state.research = unique.slice(0, 12).join("\n\n") || "No useful public research results returned.";
      setStatus("");
      return state.research;
    });
  }

  function currentPhase() {
    var active = state.members.filter(function (m) { return m.on; }).length || 1;
    var rounds = Math.floor(state.messages.filter(function (m) {
      return m.who !== "You" && m.who !== "System";
    }).length / active);
    var min = settings.planRounds || 6;
    if (state.phase === "build" || state.phase === "testing" || state.phase === "done") return state.phase;
    if (rounds < 2) return "research";
    if (rounds < Math.max(3, Math.floor(min * 0.5))) return "architecture";
    if (rounds < min) return "plan";
    return "converge";
  }

  function phaseHint(phase) {
    var map = {
      research: "PHASE - DEEP RESEARCH (no code). Researcher leads with tool findings. Challenge weak assumptions.",
      architecture: "PHASE - ARCHITECTURE. Data shapes, screens, storage. No implementation code yet.",
      plan: "PHASE - DETAILED PLAN. Feature list, UI states, data model, build order, acceptance criteria.",
      converge: "PHASE - CONVERGE. Lock the plan. Builder writes next; Skeptic reviews.",
      build: "PHASE - BUILD & TEST. Complete HTML, sandbox test, fix until approved."
    };
    return map[phase] || map.research;
  }

  function remoteReply(member) {
    var phase = currentPhase();
    state.phase = phase;
    updatePhaseChip();
    var system = (ROLE_PROMPTS[member.role] || ROLE_PROMPTS.Strategist) +
      "\n\nYou are part of a multi-agent council building single-file mobile web apps.\nAlways be concrete. Prefer evidence. Never invent facts.\n\n" +
      phaseHint(phase);
    var tools = [];
    if (state.research) tools.push("=== WEB RESEARCH ===\n" + state.research.slice(0, 3500));
    if (state.refs) tools.push("=== REFERENCE NOTES ===\n" + state.refs.slice(0, 1500));
    if (state.docs && state.docs.length) {
      tools.push("=== KNOWLEDGE DOCS ===\n" + state.docs.map(function (d) {
        return d.name + ":\n" + String(d.text).slice(0, 800);
      }).join("\n---\n").slice(0, 2000));
    }
    var transcript = state.messages.slice(-16).map(function (m) {
      var who = m.who === "You" ? "USER" : m.who + (m.role ? " (" + m.role + ")" : "");
      return who + ": " + String(m.text).slice(0, 600);
    }).join("\n");
    var user = "PROBLEM / GOAL:\n" + state.problem +
      (tools.length ? "\n\nTEAM TOOLS:\n" + tools.join("\n\n") : "") +
      "\n\nSHARED BOARD:\n" + (boardSummary() || "(empty)") +
      "\n\nRECENT TRANSCRIPT:\n" + transcript +
      "\n\nYour turn as " + member.name + " (" + member.role + "). Respond with substance.";
    return callModel(system, user, { ms: 100000, image: pendingImage || null }).then(function (text) {
      pendingImage = null;
      var claim = text.split(/[.!?]/)[0].slice(0, 120).trim();
      if (claim.length < 12) claim = text.slice(0, 100);
      return { text: text, claim: claim, kind: "build", role: member.role };
    });
  }

  function add(who, text, extra) {
    var m = Object.assign({ who: who, text: text, ts: Date.now() }, extra || {});
    state.messages.push(m);
    if (m.claim) updateBoard(m);
    autosave();
    return m;
  }

  function runTurn() {
    if (busy) return;
    busy = true;
    syncControls();
    var finish = function () { busy = false; setStatus(""); syncControls(); };

    try {
      var active = state.members.filter(function (m) { return m.on; });
      if (!active.length) {
        add("System", "No active members. Enable at least one in Team.");
        render();
        finish();
        return;
      }

      var afterResearch = function () {
        var counts = {};
        active.forEach(function (m) { counts[m.name] = 0; });
        state.messages.filter(function (m) {
          return m.who !== "You" && m.who !== "System";
        }).forEach(function (m) {
          if (counts[m.who] !== undefined) counts[m.who]++;
        });
        active.sort(function (a, b) { return counts[a.name] - counts[b.name]; });
        var member = active[0];
        setStatus(member.name + " (" + member.role + ") is thinking...");
        state.phase = currentPhase();
        updatePhaseChip();

        var handleReply = function (reply) {
          add(member.name, reply.text, { role: member.role, claim: reply.claim, kind: reply.kind });
          render();
          if (settings.buildMode) {
            maybeAdvanceToBuild().then(finish).catch(finish);
          } else finish();
        };

        if (isRemote()) {
          remoteReply(member).then(handleReply).catch(function (e) {
            add("System", "Model error: " + (e.message || e) + ". Using local reasoning.");
            handleReply(localReply(member));
          });
        } else {
          handleReply(localReply(member));
        }
      };

      if (settings.webResearch && !state.research && state.problem) {
        state.phase = "research";
        updatePhaseChip();
        doResearch(state.problem).then(function () {
          add("System", "Research complete. Findings injected.");
          render();
          afterResearch();
        }).catch(function () { afterResearch(); });
      } else {
        afterResearch();
      }
    } catch (e) {
      showError("runTurn: " + (e.message || e));
      finish();
    }
  }

  function maybeAdvanceToBuild() {
    var phase = currentPhase();
    if (phase !== "converge" && phase !== "plan") return Promise.resolve();
    var active = state.members.filter(function (m) { return m.on; }).length || 1;
    var rounds = Math.floor(state.messages.filter(function (m) {
      return m.who !== "You" && m.who !== "System";
    }).length / active);
    if (rounds < (settings.planRounds || 6)) return Promise.resolve();

    if (isRemote()) {
      setStatus("Judging plan readiness...");
      return callModel(
        "You are a strict readiness judge. Reply READY if there is a concrete feature list, clear architecture, risks addressed, and acceptance criteria. Otherwise NOT READY with what is missing.",
        "PROBLEM:\n" + state.problem + "\n\nBOARD:\n" + boardSummary() + "\n\nRECENT:\n" +
          state.messages.slice(-10).map(function (m) { return m.who + ": " + String(m.text).slice(0, 300); }).join("\n"),
        { ms: 45000 }
      ).then(function (verdict) {
        if (/^\s*READY\b/i.test(verdict)) {
          add("System", "Plan judged READY. Starting build...");
          render();
          return runBuild();
        }
        add("System", "Judge: " + verdict.slice(0, 300));
        render();
      }).catch(function () {
        if (rounds >= (settings.planRounds || 6) + 2) {
          add("System", "Judge unavailable - proceeding to build.");
          render();
          return runBuild();
        }
      });
    }
    if (rounds >= (settings.planRounds || 6)) {
      add("System", "Local mode: enough rounds. Starting build...");
      render();
      return runBuild();
    }
    return Promise.resolve();
  }

  function extractHtml(text) {
    var fence = text.match(/```(?:html)?\s*([\s\S]*?)```/i);
    if (fence) return fence[1].trim();
    var doc = text.match(/(<!DOCTYPE html>[\s\S]*<\/html>)/i);
    if (doc) return doc[1].trim();
    if (text.indexOf("<html") >= 0 || text.indexOf("<!DOCTYPE") >= 0) return text.trim();
    return null;
  }

  function runSandbox(code) {
    return new Promise(function (resolve) {
      var f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-scripts");
      f.style.cssText = "position:fixed;left:-9999px;width:320px;height:480px;border:0;opacity:0;pointer-events:none";
      document.body.appendChild(f);
      var results = { ok: false, errors: [], blank: true, hasControls: false };
      var finish = function () {
        clearTimeout(timer);
        try { document.body.removeChild(f); } catch (e) {}
        resolve(results);
      };
      var timer = setTimeout(function () {
        results.errors.push("Sandbox timeout");
        finish();
      }, 8000);
      f.onload = function () {
        try {
          var doc = f.contentDocument;
          if (!doc) { results.errors.push("No document"); finish(); return; }
          f.contentWindow.onerror = function (msg) { results.errors.push(String(msg)); };
          try {
            var store = {};
            f.contentWindow.localStorage = {
              getItem: function (k) { return store[k] || null; },
              setItem: function (k, v) { store[k] = String(v); },
              removeItem: function (k) { delete store[k]; },
              clear: function () { store = {}; }
            };
          } catch (e) {}
          doc.open();
          var monitor = "<script>window.__aicErrors=[];window.addEventListener('error',function(e){window.__aicErrors.push(String(e.message||'Script error'))});window.addEventListener('unhandledrejection',function(e){window.__aicErrors.push('Unhandled promise: '+String(e.reason&&e.reason.message||e.reason))});<\\/script>";
          doc.write(monitor + code);
          doc.close();
          setTimeout(function () {
            try {
              var body = doc.body;
              try {
                var captured = f.contentWindow.__aicErrors || [];
                results.errors = results.errors.concat(captured.slice(0, 8));
              } catch (ignored) {}
              var text = (body && body.innerText || "").trim();
              results.blank = text.length < 8 && (!body || body.children.length < 1);
              results.hasControls = !!(doc.querySelector("button, input, select, textarea, a[href], [onclick], [role=button]"));
              results.ok = !results.blank && results.errors.length === 0;
            } catch (e) {
              results.errors.push("Eval: " + e.message);
            }
            finish();
          }, 1200);
        } catch (e) {
          results.errors.push(e.message || String(e));
          finish();
        }
      };
      f.src = "about:blank";
    });
  }

  function runBuild(changeReq) {
    if (building) { stopBuild = true; return Promise.resolve(); }
    building = true;
    stopBuild = false;
    state.phase = "build";
    updatePhaseChip();
    syncControls();

    var builder = state.members.find(function (m) { return m.on && m.role === "Builder"; }) ||
      state.members.find(function (m) { return m.on; });
    var skeptic = state.members.find(function (m) { return m.on && m.role === "Skeptic"; }) || builder;
    var maxIters = settings.buildIters || 6;
    var attempt = 0;
    var lastCode = state.buildHistory.length ? state.buildHistory[state.buildHistory.length - 1].code : null;
    var lastFeedback = changeReq || "";

    function nextAttempt() {
      if (attempt >= maxIters || stopBuild) {
        if (state.phase !== "done") {
          add("System", "Reached max build attempts. Latest version available for preview.");
          state.phase = "converge";
          render();
        }
        building = false;
        stopBuild = false;
        setStatus("");
        syncControls();
        autosave();
        return Promise.resolve();
      }
      attempt++;
      setStatus("Build attempt " + attempt + "/" + maxIters + "...");
      var system = ROLE_PROMPTS.Builder +
        "\n\nWrite a COMPLETE self-contained HTML file. Mobile-first, iPhone Safari, dark theme, no placeholders. Return ONLY the HTML.";
      var userParts = "GOAL:\n" + state.problem +
        "\n\nAGREED PLAN:\n" + (boardSummary() || "Use best judgement.") +
        (state.research ? "\n\nRESEARCH:\n" + state.research.slice(0, 2000) : "") +
        (lastCode ? "\n\nCURRENT CODE:\n```html\n" + lastCode.slice(0, 12000) + "\n```" : "") +
        (lastFeedback ? "\n\nFIX REQUEST:\n" + lastFeedback : "\n\nWrite the complete app.") +
        "\n\nOutput full working HTML now.";

      var getCode = isRemote()
        ? callModel(system, userParts, { ms: 120000 })
        : Promise.resolve(
          "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Demo</title>" +
          "<style>body{font-family:system-ui;background:#0b0d17;color:#eef0ff;padding:24px}h1{color:#3dd9c5}</style></head>" +
          "<body><h1>Local demo</h1><p>Connect a model in Settings.</p><p>" + esc(state.problem).slice(0, 200) +
          "</p><button onclick=\"alert('ok')\">Test</button></body></html>"
        );

      return getCode.then(function (raw) {
        var code = extractHtml(raw);
        if (!code) {
          add(builder.name, "Could not extract HTML. Retrying...\n\n" + raw.slice(0, 400));
          lastFeedback = "Return a complete HTML document.";
          render();
          return nextAttempt();
        }
        var version = (state.buildHistory.length || 0) + 1;
        state.buildHistory.push({ version: version, code: code, ts: Date.now(), attempt: attempt });
        if (state.buildHistory.length > 12) state.buildHistory = state.buildHistory.slice(-12);
        add(builder.name, "Built version " + version + " (" + (code.length / 1024).toFixed(1) + " KB). Testing...", {
          role: "Builder", kind: "deliverable", code: code, version: version
        });
        render();
        setStatus("Testing v" + version + "...");
        state.phase = "testing";
        updatePhaseChip();
        return runSandbox(code).then(function (test) {
          var problems = [];
          if (test.blank) problems.push("App appears blank");
          if (!test.hasControls) problems.push("No interactive controls");
          if (test.errors.length) problems.push("Errors: " + test.errors.slice(0, 3).join("; "));

          if (!problems.length) {
            setStatus("Skeptic reviewing...");
            var reviewP = isRemote()
              ? callModel(
                "You are the Skeptic. Reply APPROVED if good enough, else REJECTED with concrete fixes.",
                "GOAL: " + state.problem + "\nSandbox ok. Code length: " + code.length + "\nFirst 1500:\n" + code.slice(0, 1500),
                { ms: 45000 }
              ).catch(function () { return "APPROVED - sandbox passed."; })
              : Promise.resolve("APPROVED - sandbox passed.");
            return reviewP.then(function (review) {
              if (/^\s*APPROVED/i.test(review)) {
                add(skeptic.name, "Approved version " + version + ". " + review.replace(/^\s*APPROVED[:.\s-]*/i, "").slice(0, 250), { role: "Skeptic" });
                state.phase = "done";
                updatePhaseChip();
                add("System", "Build complete - version " + version + " approved.");
                render();
                building = false;
                setStatus("");
                syncControls();
                autosave();
                return;
              }
              lastFeedback = review;
              add(skeptic.name, "Rejected v" + version + ":\n" + review.slice(0, 500), { role: "Skeptic" });
              render();
              lastCode = code;
              return nextAttempt();
            });
          }
          lastFeedback = "Sandbox failed:\n- " + problems.join("\n- ");
          add(skeptic.name, "Sandbox problems v" + version + ":\n- " + problems.join("\n- "), { role: "Skeptic" });
          render();
          lastCode = code;
          return nextAttempt();
        });
      }).catch(function (e) {
        add("System", "Build error: " + (e.message || e));
        building = false;
        setStatus("");
        syncControls();
      });
    }
    return nextAttempt();
  }

  function previewBuild(version) {
    var entry = state.buildHistory.find(function (b) { return b.version === version; }) ||
      state.buildHistory[state.buildHistory.length - 1];
    if (!entry) return toast("No build found");
    $("pvTitle").textContent = "Preview v" + entry.version;
    $("pvFrame").srcdoc = entry.code;
    openDialog("dPreview");
  }

  function downloadBuild(version) {
    var entry = state.buildHistory.find(function (b) { return b.version === version; }) ||
      state.buildHistory[state.buildHistory.length - 1];
    if (!entry) return toast("No build found");
    var blob = new Blob([entry.code], { type: "text/html" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "app-v" + entry.version + ".html";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast("Download requested for v" + entry.version);
  }

  function sendUser() {
    var input = $("userInput");
    var text = (input.value || "").trim();
    if (!text || busy) return;
    input.value = "";
    input.style.height = "auto";
    if (!state.problem) state.problem = text;
    if (state.title === "Untitled") state.title = text.slice(0, 48);
    var extra = {};
    if (pendingImage) extra.image = pendingImage;
    add("You", text, extra);
    render();
    if (settings.buildMode) {
      state.phase = "research";
      updatePhaseChip();
    }
    runTurn();
  }

  function renderMembers() {
    var list = $("membersList");
    list.innerHTML = "";
    state.members.forEach(function (m, i) {
      var row = document.createElement("div");
      row.className = "member-row";
      var color = ROLE_COLORS[m.role] || "#888";
      var roleOpts = Object.keys(ROLE_PROMPTS).map(function (r) {
        return '<option value="' + r + '"' + (m.role === r ? " selected" : "") + ">" + r + "</option>";
      }).join("");
      row.innerHTML =
        '<span class="dot" style="background:' + color + '"></span>' +
        '<input type="checkbox"' + (m.on ? " checked" : "") + ' data-i="' + i + '" class="m-on">' +
        '<input type="text" value="' + esc(m.name) + '" data-i="' + i + '" class="m-name">' +
        '<select data-i="' + i + '" class="m-role">' + roleOpts + "</select>" +
        '<button type="button" class="btn" data-del="' + i + '">X</button>';
      list.appendChild(row);
    });
    list.querySelectorAll(".m-on").forEach(function (el) {
      el.onchange = function () { state.members[+el.getAttribute("data-i")].on = el.checked; autosave(); };
    });
    list.querySelectorAll(".m-name").forEach(function (el) {
      el.onchange = function () {
        state.members[+el.getAttribute("data-i")].name = el.value.trim() || "Member";
        autosave();
      };
    });
    list.querySelectorAll(".m-role").forEach(function (el) {
      el.onchange = function () {
        state.members[+el.getAttribute("data-i")].role = el.value;
        autosave();
        renderMembers();
      };
    });
    list.querySelectorAll("[data-del]").forEach(function (el) {
      el.onclick = function () {
        if (state.members.length <= 1) return toast("Need at least one member");
        state.members.splice(+el.getAttribute("data-del"), 1);
        renderMembers();
        autosave();
      };
    });
  }

  function renderProjects() {
    var list = $("projectsList");
    var projs = projects();
    if (!projs.length) {
      list.innerHTML = '<p class="hint">No saved projects yet.</p>';
      return;
    }
    list.innerHTML = "";
    projs.forEach(function (p) {
      var row = document.createElement("div");
      row.className = "proj-row";
      var date = new Date(p.updated || p.created).toLocaleDateString();
      row.innerHTML =
        '<div class="info"><b>' + esc(p.title || "Untitled") + "</b><small>" + date +
        " · " + ((p.messages && p.messages.length) || 0) + " msgs</small></div>" +
        '<button type="button" class="btn" data-open="' + p.id + '">Open</button>' +
        '<button type="button" class="btn danger" data-delp="' + p.id + '">X</button>';
      list.appendChild(row);
    });
    list.querySelectorAll("[data-open]").forEach(function (el) {
      el.onclick = function () {
        var p = projs.find(function (x) { return x.id === el.getAttribute("data-open"); });
        if (!p) return;
        if (state.messages.length && state.id !== p.id) saveProject(false);
        state = Object.assign(defaultState(), JSON.parse(JSON.stringify(p)));
        saveCurrent();
        render();
        closeDialog("dProjects");
        toast("Opened");
      };
    });
    list.querySelectorAll("[data-delp]").forEach(function (el) {
      el.onclick = function () {
        uiConfirm("Delete this project?").then(function (ok) {
          if (!ok) return;
          writeProjects(projs.filter(function (x) { return x.id !== el.getAttribute("data-delp"); }));
          renderProjects();
        });
      };
    });
  }

  var PROVIDERS = {
    groq: { url: "https://api.groq.com/openai/v1/chat/completions", model: "llama-3.3-70b-versatile", provider: "openai" },
    openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", model: "meta-llama/llama-3.3-70b-instruct:free", provider: "openai" },
    gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-2.0-flash", provider: "gemini" },
    nvidia: { url: "https://integrate.api.nvidia.com/v1/chat/completions", model: "meta/llama-3.1-70b-instruct", provider: "openai" }
  };

  function fillSettingsForm() {
    $("sEngine").value = settings.engine;
    $("sUrl").value = settings.url || "";
    $("sModel").value = settings.model || "";
    $("sKey").value = settings.key || "";
    $("sBuildMode").checked = !!settings.buildMode;
    $("sWeb").checked = !!settings.webResearch;
    $("sAutopilot").checked = !!settings.autopilot;
    $("sPlanRounds").value = settings.planRounds || 6;
    $("sBuildIters").value = settings.buildIters || 6;
    $("sAutosave").checked = !!settings.autosave;
    $("customBlock").classList.toggle("hidden", settings.engine !== "custom");
  }

  function applySettingsFromForm() {
    settings.engine = $("sEngine").value;
    settings.url = $("sUrl").value.trim();
    settings.model = $("sModel").value.trim();
    settings.key = $("sKey").value.trim();
    settings.buildMode = $("sBuildMode").checked;
    settings.webResearch = $("sWeb").checked;
    settings.autopilot = $("sAutopilot").checked;
    settings.planRounds = Math.max(3, Math.min(12, +$("sPlanRounds").value || 6));
    settings.buildIters = Math.max(1, Math.min(8, +$("sBuildIters").value || 6));
    settings.autosave = $("sAutosave").checked;
    saveSettings();
    toast("Settings saved");
  }

  function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return toast("Camera requires HTTPS and a supported browser");
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function (stream) {
        liveStream = stream;
        $("camVideo").srcObject = liveStream;
        openDialog("dCamera");
      })
      .catch(function (e) { toast("Camera unavailable: " + (e.message || e)); });
  }

  function stopCamera() {
    if (liveStream) {
      liveStream.getTracks().forEach(function (t) { t.stop(); });
      liveStream = null;
    }
    $("camVideo").srcObject = null;
    closeDialog("dCamera");
  }

  function snapCamera() {
    var video = $("camVideo");
    var canvas = $("camCanvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext("2d").drawImage(video, 0, 0);
    pendingImage = { dataUrl: canvas.toDataURL("image/jpeg", 0.85), mime: "image/jpeg", w: canvas.width, h: canvas.height };
    stopCamera();
    toast("Frame captured - send a message");
  }

  function handleUpload(files) {
    Array.prototype.forEach.call(files, function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        var text = reader.result;
        if (/\.(html|htm)$/i.test(file.name)) {
          state.files.push({ name: file.name, text: String(text), ts: Date.now() });
          var version = (state.buildHistory.length || 0) + 1;
          state.buildHistory.push({ version: version, code: String(text), ts: Date.now(), attempt: 0 });
          add("System", "Loaded " + file.name + " (v" + version + ").");
        } else {
          state.docs.push({ name: file.name, text: String(text).slice(0, 20000), ts: Date.now() });
          add("System", "Added knowledge doc: " + file.name);
        }
        render();
        autosave();
      };
      reader.readAsText(file);
    });
  }

  function initEvents() {
    $("sendBtn").onclick = sendUser;
    $("userInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendUser(); }
    });
    $("userInput").addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 120) + "px";
    });

    $("bBuild").onclick = function () {
      if (building) { stopBuild = true; return; }
      if (!state.problem) return toast("Describe a problem first");
      runBuild();
    };
    $("bResearch").onclick = function () {
      if (!state.problem) return toast("Describe a topic first");
      setStatus("Researching...");
      doResearch(state.problem).then(function () {
        add("System", "Research refreshed.");
        render();
      }).catch(function (e) {
        add("System", "Research failed: " + (e.message || e));
        render();
      }).then(function () { setStatus(""); });
    };
    $("bContinue").onclick = function () {
      if (busy || !state.problem) return;
      runTurn();
    };
    $("bUpload").onclick = function () {
      var inp = document.createElement("input");
      inp.type = "file";
      inp.accept = ".txt,.md,.json,.csv,.html,.htm";
      inp.multiple = true;
      inp.onchange = function () { handleUpload(inp.files); };
      inp.click();
    };
    $("bCamera").onclick = startCamera;
    $("bFiles").onclick = function () {
      var list = $("filesList");
      if (!state.buildHistory.length) {
        list.innerHTML = '<p class="hint">No files yet.</p>';
      } else {
        list.innerHTML = state.buildHistory.map(function (b) {
          return '<div class="proj-row"><div class="info"><b>Build v' + b.version + "</b><small>" +
            (b.code.length / 1024).toFixed(1) + " KB</small></div>" +
            '<button type="button" class="btn" data-pv="' + b.version + '">Preview</button>' +
            '<button type="button" class="btn" data-dlv="' + b.version + '">DL</button></div>';
        }).join("");
        list.querySelectorAll("[data-pv]").forEach(function (el) {
          el.onclick = function () { previewBuild(+el.getAttribute("data-pv")); };
        });
        list.querySelectorAll("[data-dlv]").forEach(function (el) {
          el.onclick = function () { downloadBuild(+el.getAttribute("data-dlv")); };
        });
      }
      openDialog("dFiles");
    };
    $("bRefs").onclick = function () {
      $("refsInput").value = state.refs || "";
      openDialog("dRefs");
    };
    $("bDownload").onclick = function () {
      if (state.buildHistory.length) downloadBuild(state.buildHistory[state.buildHistory.length - 1].version);
    };

    $("bSettings").onclick = function () { fillSettingsForm(); openDialog("dSettings"); };
    $("bMembers").onclick = function () { renderMembers(); openDialog("dMembers"); };
    $("bProjects").onclick = function () { renderProjects(); openDialog("dProjects"); };

    $("sEngine").onchange = function () {
      $("customBlock").classList.toggle("hidden", $("sEngine").value !== "custom");
    };
    document.querySelectorAll(".pchip").forEach(function (btn) {
      btn.onclick = function () {
        var p = PROVIDERS[btn.getAttribute("data-p")];
        if (!p) return;
        $("sUrl").value = p.url;
        $("sModel").value = p.model;
        settings.provider = p.provider;
        document.querySelectorAll(".pchip").forEach(function (c) { c.classList.remove("active"); });
        btn.classList.add("active");
      };
    });
    $("bSaveSettings").onclick = function () {
      applySettingsFromForm();
      closeDialog("dSettings");
    };
    $("bTestKey").onclick = function () {
      applySettingsFromForm();
      if (!settings.url) return toast("Enter an endpoint URL");
      setStatus("Testing...");
      callModel("Reply with exactly: OK", "ping", { ms: 20000 })
        .then(function (t) { toast("Connected - " + t.slice(0, 40)); })
        .catch(function (e) { toast("Failed: " + (e.message || e).slice(0, 80)); })
        .then(function () { setStatus(""); });
    };

    $("bAddMember").onclick = function () {
      state.members.push({ name: "Member" + (state.members.length + 1), role: "Creative", on: true });
      renderMembers();
      autosave();
    };

    $("bNewProject").onclick = function () {
      var go = function () {
        state = defaultState();
        saveCurrent();
        render();
        closeDialog("dProjects");
      };
      if (state.messages.length) {
        uiConfirm("Save current and start new?").then(function (ok) {
          if (!ok) return;
          saveProject(false);
          go();
        });
      } else go();
    };
    $("bExport").onclick = function () {
      var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (state.title || "project").replace(/\W+/g, "-") + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    };

    $("bSaveRefs").onclick = function () {
      state.refs = $("refsInput").value.trim();
      autosave();
      closeDialog("dRefs");
      toast("Notes saved");
    };

    $("bCamStop").onclick = stopCamera;
    $("bCamSnap").onclick = snapCamera;

    document.querySelectorAll("[data-tpl]").forEach(function (btn) {
      btn.onclick = function () {
        $("userInput").value = TEMPLATES[btn.getAttribute("data-tpl")] || "";
        $("userInput").focus();
      };
    });

    document.querySelectorAll("[data-close]").forEach(function (btn) {
      btn.onclick = function () {
        var dlg = btn.closest("dialog");
        if (dlg) closeDialog(dlg);
      };
    });

    document.querySelectorAll("dialog").forEach(function (d) {
      d.addEventListener("click", function (e) {
        if (e.target === d) closeDialog(d);
      });
    });
  }

  function boot() {
    try { loadAll(); } catch (e) { showError("loadAll: " + e.message); }
    try { initEvents(); } catch (e) { showError("initEvents: " + e.message); }
    try { render(); } catch (e) { showError("render: " + e.message); }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
