#!/usr/bin/env node
/*
 * UG ALOK — Kit
 * Developer: UG ALOK
 * Defensive, terminal-based toolkit. Node.js built-ins only (Node 18+).
 * Use only on systems you own or are authorized to test.
 */
'use strict';

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
if (NODE_MAJOR < 18) {
  console.error('UG ALOK requires Node.js 18 or newer (found ' + process.versions.node + ').');
  console.error('Termux: pkg update && pkg install nodejs');
  process.exit(1);
}

const os = require('os');
const fs = require('fs');
const net = require('net');
const dns = require('dns');
const url = require('url');
const crypto = require('crypto');
const readline = require('readline');
const { Writable } = require('stream');
const dnsp = dns.promises;

const VERSION = '1.0.0';
const UA = 'UG-ALOK/' + VERSION + ' (defensive toolkit)';

/* ───────────────────────── UI helpers ───────────────────────── */

const useColor = !!process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (c) => (s) => (useColor ? `\x1b[${c}m${s}\x1b[0m` : String(s));
const red = paint('91'), white = paint('97'), gold = paint('38;5;220');
const green = paint('92'), dim = paint('90'), bold = paint('1');
const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
const W = () => Math.max(32, Math.min(process.stdout.columns || 60, 66));
const rule = () => console.log(dim('─'.repeat(W())));

function wrapPrint(prefix, text, hang) {
  const width = W(), first = strip(prefix).length;
  const lines = [];
  let cur = '';
  for (const w of String(text).split(/\s+/)) {
    const lim = width - (lines.length ? hang : first);
    if (cur && cur.length + 1 + w.length > lim) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  lines.push(cur);
  console.log(prefix + lines[0]);
  for (let i = 1; i < lines.length; i++) console.log(' '.repeat(hang) + lines[i]);
}
const ok = (m) => wrapPrint(green('[+] '), m, 4);
const warn = (m) => wrapPrint(gold('[!] '), m, 4);
const err = (m) => wrapPrint(red('[x] '), m, 4);
const info = (m) => wrapPrint(white('[i] '), m, 4);
const para = (m) => wrapPrint('  ', m, 2);
const hint = (m) => wrapPrint(dim('  '), dim(m), 2);
const kv = (k, v) => console.log('  ' + gold(k + ':') + ' ' + v);
const section = (t) => {
  console.log('');
  console.log(gold('── ' + t + ' ') + dim('─'.repeat(Math.max(2, W() - t.length - 4))));
};

const FONT = {
  U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
  G: [' ████', '█    ', '█  ██', '█   █', ' ████'],
  A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
  L: ['█    ', '█    ', '█    ', '█    ', '█████'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  K: ['█   █', '█  █ ', '███  ', '█  █ ', '█   █'],
  ' ': ['  ', '  ', '  ', '  ', '  '],
};
function logo() {
  const text = 'UG ALOK';
  for (let r = 0; r < 5; r++) {
    console.log('  ' + red(text.split('').map((ch) => FONT[ch][r]).join(' ')));
  }
}
function banner() {
  console.log('');
  logo();
  console.log('  ' + white(bold('Kit')) + dim('  v' + VERSION));
  console.log('  ' + gold('Developer: UG ALOK'));
  console.log('  ' + dim('Node ' + process.versions.node + ' · ' + os.platform() + '/' + os.arch()));
  rule();
  console.log('  ' + dim('Defensive use only. Test only what you own or are'));
  console.log('  ' + dim('authorized to test. Ctrl+C cancels the running tool.'));
  rule();
}

function spinner(text) {
  if (!process.stdout.isTTY) { console.log(dim('... ' + text)); return { stop() {} }; }
  const f = '|/-\\';
  let i = 0;
  const draw = () => process.stdout.write('\r\x1b[K' + gold(f[i++ % 4]) + ' ' + text.slice(0, W() - 3));
  draw();
  const id = setInterval(draw, 120);
  return { stop() { clearInterval(id); process.stdout.write('\r\x1b[K'); } };
}

/* ───────────────────────── errors, cancel, input ───────────────────────── */

class UserError extends Error {}
class Cancelled extends Error {}
let current = null; // AbortController of the running tool

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sleepAbortable(ms) {
  return new Promise((resolve) => {
    const sig = current && current.signal;
    if (sig && sig.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); if (sig) sig.removeEventListener('abort', done); resolve(); }
    if (sig) sig.addEventListener('abort', done, { once: true });
  });
}
function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const sig = current && current.signal;
    const onAbort = () => { cleanup(); reject(new Cancelled()); };
    const t = setTimeout(() => { cleanup(); const e = new Error('timeout'); e.code = 'ETIMEDOUT'; reject(e); }, ms);
    function cleanup() { clearTimeout(t); if (sig) sig.removeEventListener('abort', onAbort); }
    if (sig) { if (sig.aborted) return onAbort(); sig.addEventListener('abort', onAbort, { once: true }); }
    Promise.resolve(p).then((v) => { cleanup(); resolve(v); }, (e) => { cleanup(); reject(e); });
  });
}

let muted = false;
const outStream = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); } });
const rl = readline.createInterface({
  input: process.stdin, output: outStream, terminal: !!process.stdin.isTTY, historySize: 0,
});
const queue = [];
let waiter = null, inputClosed = false;
rl.on('line', (l) => { if (waiter) { const w = waiter; waiter = null; w(l); } else queue.push(l); });
rl.on('close', () => { inputClosed = true; if (waiter) { const w = waiter; waiter = null; w(null); } });

function rawAsk(q) {
  return new Promise((resolve, reject) => {
    const sig = current && current.signal;
    if (sig && sig.aborted) return reject(new Cancelled());
    const onAbort = () => { waiter = null; reject(new Cancelled()); };
    const finish = (v) => { if (sig) sig.removeEventListener('abort', onAbort); resolve(v); };
    if (queue.length || inputClosed) {
      const v = queue.length ? queue.shift() : null;
      if (!process.stdout.isTTY) process.stdout.write(q + (muted || v === null ? '' : v) + '\n');
      return finish(v);
    }
    waiter = finish;
    if (sig) sig.addEventListener('abort', onAbort, { once: true });
    rl.setPrompt(q);
    rl.prompt();
  });
}
async function ask(q) {
  const a = await rawAsk(q);
  if (a === null) { console.log('\n' + dim('Input closed. Goodbye.')); process.exit(0); }
  return a.trim();
}
async function askHidden(q) {
  process.stdout.write(q);
  muted = true;
  try { const a = await rawAsk(''); if (a === null) process.exit(0); return a; }
  finally { muted = false; process.stdout.write('\n'); }
}
async function yn(q, def) {
  const a = (await ask(q)).toLowerCase();
  if (a === '') return def;
  return a === 'y' || a === 'yes';
}
async function askValid(q, validate) {
  for (;;) {
    const v = await ask(q);
    if (v === '') return null;
    try { return validate(v); } catch (e) {
      if (e instanceof UserError) { err(e.message); hint('Try again, or press Enter to go back.'); } else throw e;
    }
  }
}

/* ───────────────────────── networking helpers ───────────────────────── */

function errCode(e) { return (e && ((e.cause && (e.cause.code || e.cause.name)) || e.code || e.name)) || 'ERROR'; }
const isTlsCode = (c) => /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/i.test(String(c));
function errText(e) {
  const c = errCode(e);
  const m = {
    ENOTFOUND: 'DNS lookup failed (host not found)', EAI_AGAIN: 'DNS lookup failed (temporary; check connectivity)',
    ECONNREFUSED: 'Connection refused', ECONNRESET: 'Connection reset by peer', ETIMEDOUT: 'Timed out',
    UND_ERR_CONNECT_TIMEOUT: 'Connection timed out', UND_ERR_HEADERS_TIMEOUT: 'Timed out waiting for response',
    ENETUNREACH: 'Network unreachable', EHOSTUNREACH: 'Host unreachable', UND_ERR_SOCKET: 'Connection closed unexpectedly',
  };
  if (m[c]) return m[c];
  if (isTlsCode(c)) return 'TLS/certificate problem (' + c + ')';
  return 'Request failed (' + c + ')';
}

// fetch with a hard timeout and tool-level cancellation. Caller must drain() the response.
async function fetchT(u, opts, ms) {
  opts = opts || {};
  const ac = new AbortController();
  const state = { timedOut: false };
  const sig = current && current.signal;
  const onAbort = () => ac.abort();
  if (sig) { if (sig.aborted) throw new Cancelled(); sig.addEventListener('abort', onAbort, { once: true }); }
  const timer = setTimeout(() => { state.timedOut = true; ac.abort(); }, ms);
  const end = () => { clearTimeout(timer); if (sig) sig.removeEventListener('abort', onAbort); };
  try {
    const res = await fetch(u, { ...opts, signal: ac.signal, headers: { 'User-Agent': UA, Accept: '*/*', ...(opts.headers || {}) } });
    res._end = end; res._state = state;
    return res;
  } catch (e) {
    end();
    if (sig && sig.aborted) throw new Cancelled();
    if (state.timedOut) { const t = new Error('timeout'); t.code = 'ETIMEDOUT'; throw t; }
    throw e;
  }
}
async function drain(res, limit) {
  try {
    if (res.body && limit > 0) {
      const reader = res.body.getReader();
      let n = 0;
      try { while (n < limit) { const r = await reader.read(); if (r.done) break; n += r.value.length; } }
      finally { await reader.cancel().catch(() => {}); }
    } else if (res.body) { await res.body.cancel().catch(() => {}); }
  } catch (e) {
    if (current && current.signal.aborted) throw new Cancelled();
    if (res._state && res._state.timedOut) { const t = new Error('timeout'); t.code = 'ETIMEDOUT'; throw t; }
    throw e;
  } finally { if (res._end) res._end(); }
}
async function getText(u, ms) {
  const r = await fetchT(u, {}, ms);
  try {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const t = (await r.text()).trim().slice(0, 100);
    return t;
  } finally { if (r._end) r._end(); }
}

/* ───────────────────────── IP classification ───────────────────────── */

const v4n = (s) => { const p = s.split('.').map(Number); return ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3]; };
function v6n(s) {
  s = s.split('%')[0].toLowerCase();
  if (s.includes('.')) {
    const i = s.lastIndexOf(':'), n = v4n(s.slice(i + 1));
    s = s.slice(0, i + 1) + (n >>> 16).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const parts = s.split('::');
  const head = parts[0] ? parts[0].split(':') : [];
  let groups;
  if (parts.length === 1) groups = head;
  else { const tail = parts[1] ? parts[1].split(':') : []; groups = [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail]; }
  let v = 0n;
  for (const g of groups) v = (v << 16n) | BigInt(parseInt(g || '0', 16));
  return v;
}
const V4 = [
  ['0.0.0.0/8', 'reserved', '"This network" (unspecified source)', true],
  ['10.0.0.0/8', 'private', 'RFC 1918 private network', true],
  ['100.64.0.0/10', 'reserved', 'Shared address space (carrier-grade NAT)', true],
  ['127.0.0.0/8', 'loopback', 'Loopback (this device only)', true],
  ['169.254.0.0/16', 'link-local', 'Link-local (self-assigned / APIPA)', true],
  ['172.16.0.0/12', 'private', 'RFC 1918 private network', true],
  ['192.0.0.0/24', 'reserved', 'IETF protocol assignments', true],
  ['192.0.2.0/24', 'reserved', 'Documentation range (TEST-NET-1)', false],
  ['192.88.99.0/24', 'reserved', 'Deprecated 6to4 relay anycast', false],
  ['192.168.0.0/16', 'private', 'RFC 1918 private network', true],
  ['198.18.0.0/15', 'reserved', 'Benchmarking range', false],
  ['198.51.100.0/24', 'reserved', 'Documentation range (TEST-NET-2)', false],
  ['203.0.113.0/24', 'reserved', 'Documentation range (TEST-NET-3)', false],
  ['224.0.0.0/4', 'multicast', 'Multicast', false],
  ['240.0.0.0/4', 'reserved', 'Reserved for future use / limited broadcast', false],
].map(([c, cls, note, local]) => { const [b, l] = c.split('/'); return { b: v4n(b), l: Number(l), cls, note, local }; });
const V6 = [
  ['::', 128, 'reserved', 'Unspecified address', true],
  ['::1', 128, 'loopback', 'Loopback (this device only)', true],
  ['64:ff9b::', 96, 'reserved', 'NAT64 translation prefix', false],
  ['100::', 64, 'reserved', 'Discard-only prefix', false],
  ['2001::', 32, 'reserved', 'Teredo tunneling', false],
  ['2001:db8::', 32, 'reserved', 'Documentation range', false],
  ['2002::', 16, 'reserved', '6to4 transition addresses', false],
  ['fc00::', 7, 'private', 'Unique local address (ULA, private)', true],
  ['fe80::', 10, 'link-local', 'Link-local', true],
  ['ff00::', 8, 'multicast', 'Multicast', false],
  ['2000::', 3, 'public', 'Global unicast (publicly routable range)', false],
].map(([b, l, cls, note, local]) => ({ b: v6n(b), l, cls, note, local }));

function classifyIP(ip) {
  ip = ip.replace(/^\[|\]$/g, '');
  const ver = net.isIP(ip);
  if (ver === 4) {
    const n = v4n(ip);
    for (const r of V4) if ((n >>> (32 - r.l)) === (r.b >>> (32 - r.l))) return { ver, cls: r.cls, note: r.note, local: r.local };
    return { ver, cls: 'public', note: 'Not in any reserved range (publicly routable space)', local: false };
  }
  if (ver === 6) {
    const v = v6n(ip);
    if ((v >> 32n) === 0xffffn) { // IPv4-mapped ::ffff:a.b.c.d
      const c = classifyIP([(v >> 24n) & 255n, (v >> 16n) & 255n, (v >> 8n) & 255n, v & 255n].join('.'));
      return { ver, cls: c.cls, note: 'IPv4-mapped IPv6 address; embedded IPv4 is: ' + c.note, local: c.local };
    }
    for (const r of V6) if ((v >> BigInt(128 - r.l)) === (r.b >> BigInt(128 - r.l))) return { ver, cls: r.cls, note: r.note, local: r.local };
    return { ver, cls: 'reserved', note: 'Outside currently allocated global unicast space', local: false };
  }
  return null;
}
async function isLocalHost(host) {
  const h = host.replace(/^\[|\]$/g, '');
  if (net.isIP(h)) return classifyIP(h).local;
  try {
    const r = await withTimeout(dnsp.lookup(h, { all: true }), 4000);
    return r.some((a) => classifyIP(a.address).local);
  } catch (e) { if (e instanceof Cancelled) throw e; return false; }
}

function printInterfaces() {
  let ifs;
  try { ifs = os.networkInterfaces(); } catch (e) {
    warn('Interface list is not available here (' + (e.code || e.message) + '). Some Android versions restrict this API.');
    return;
  }
  const names = Object.keys(ifs);
  if (!names.length) { warn('No interface information available.'); return; }
  for (const n of names) {
    console.log('  ' + white(n));
    for (const a of ifs[n]) {
      const fam = typeof a.family === 'number' ? 'IPv' + a.family : a.family;
      const c = classifyIP(a.address);
      console.log('    ' + fam + ' ' + (a.cidr || a.address) + ' ' + dim('(' + (c ? c.cls : '?') + (a.internal ? ', internal' : '') + ')'));
    }
    const mac = ifs[n][0] && ifs[n][0].mac;
    if (mac && mac !== '00:00:00:00:00:00') console.log('    ' + dim('MAC ' + mac));
  }
}

/* ───────────────────────── 1. IP Show ───────────────────────── */

async function toolIpShow() {
  section('IP Show');
  kv('Hostname', os.hostname());
  console.log('');
  console.log('  ' + white('Local network interfaces') + dim(' (private/local addresses)'));
  printInterfaces();
  console.log('');
  para('A public IP is the address websites see. It usually belongs to your router, ISP, carrier-grade NAT or VPN, and is NOT the same as your device\'s private local IP above.');
  console.log('');
  if (!(await yn('Look up public IP via ipify.org? Their server will see your IP. [Y/n]: ', true))) {
    info('Public IP lookup skipped.');
    return;
  }
  const sp = spinner('Contacting api4/api6.ipify.org ...');
  let r4, r6;
  try {
    [r4, r6] = await Promise.allSettled([getText('https://api4.ipify.org', 7000), getText('https://api6.ipify.org', 7000)]);
  } finally { sp.stop(); }
  for (const r of [r4, r6]) if (r.status === 'rejected' && r.reason instanceof Cancelled) throw r.reason;
  console.log('  ' + white('Public addresses'));
  const show = (label, r, v) => {
    if (r.status === 'fulfilled' && net.isIP(r.value) === v) ok(label + ': ' + r.value);
    else if (r.status === 'fulfilled') warn(label + ': unexpected response (ignored)');
    else warn(label + ': unavailable — ' + errText(r.reason) + (v === 6 ? ' (normal if you have no IPv6)' : ''));
  };
  show('Public IPv4', r4, 4);
  show('Public IPv6', r6, 6);
}

/* ───────────────────────── 2. IP Info ───────────────────────── */

function parseIp(v) {
  const s = v.trim().replace(/^\[|\]$/g, '');
  if (s.includes('/')) throw new UserError('CIDR ranges are not supported; enter a single IP address.');
  if (!net.isIP(s)) throw new UserError('Not a valid IPv4 or IPv6 address.');
  return s;
}
async function toolIpInfo() {
  section('IP Info');
  hint('Enter alone returns to menu.');
  const ip = await askValid('IP address: ', parseIp);
  if (!ip) return;
  const c = classifyIP(ip);
  kv('Valid', 'yes (IPv' + c.ver + ')');
  if (c.ver === 6) {
    const v = v6n(ip);
    const full = [...Array(8)].map((_, i) => Number((v >> BigInt(112 - 16 * i)) & 0xffffn).toString(16).padStart(4, '0')).join(':');
    kv('Expanded', full);
  }
  kv('Class', c.cls.toUpperCase());
  kv('Detail', c.note);
  if (c.local) info('Local-scope address: it is not reachable from the public Internet and says nothing about location.');
  const sp = spinner('Reverse DNS lookup ...');
  let ptr;
  try { ptr = await withTimeout(dnsp.reverse(ip), 6000).then((v) => ({ v }), (e) => { if (e instanceof Cancelled) throw e; return { e }; }); }
  finally { sp.stop(); }
  if (ptr.v && ptr.v.length) {
    for (const name of ptr.v) {
      let fwd = '';
      try {
        const a = await withTimeout(dnsp.lookup(name, { all: true }), 5000);
        fwd = a.some((x) => x.address.toLowerCase() === ip.toLowerCase()) ? ' (forward lookup confirms this IP)' : ' (forward lookup does NOT match this IP)';
      } catch (e) { if (e instanceof Cancelled) throw e; fwd = ' (forward lookup failed)'; }
      ok('PTR: ' + name + fwd);
    }
  } else warn('Reverse DNS: ' + (ptr.e && (ptr.e.code === 'ENOTFOUND' || ptr.e.code === 'ENODATA') ? 'no PTR record found (or no DNS resolver reachable)' : 'unavailable (' + (ptr.e && (ptr.e.code || ptr.e.message)) + ')'));
  console.log('');
  rule();
  para('What this tool CAN do: validate the address, classify its range using fixed IANA-style tables, and show reverse DNS if one is published.');
  para('What it CANNOT do: determine physical location, owner, ISP or identity. PTR names are set by whoever controls the address and may be missing or misleading.');
}

/* ───────────────────────── URL analysis (shared) ───────────────────────── */

const BRANDS = {
  paypal: ['paypal.com'], google: ['google.com', 'google.co.in', 'goo.gl', 'gstatic.com', 'googleapis.com'], youtube: ['youtube.com', 'youtu.be'],
  gmail: ['gmail.com'], microsoft: ['microsoft.com', 'live.com', 'office.com', 'microsoftonline.com'], outlook: ['outlook.com', 'live.com'],
  apple: ['apple.com', 'icloud.com'], icloud: ['icloud.com'], amazon: ['amazon.com', 'amazon.in', 'amazon.co.uk', 'amazonaws.com'],
  facebook: ['facebook.com', 'fb.com'], instagram: ['instagram.com'], whatsapp: ['whatsapp.com', 'whatsapp.net'], telegram: ['telegram.org', 't.me'],
  netflix: ['netflix.com'], twitter: ['twitter.com', 'x.com'], linkedin: ['linkedin.com'], github: ['github.com'], dropbox: ['dropbox.com'],
  binance: ['binance.com'], coinbase: ['coinbase.com'], paytm: ['paytm.com'], phonepe: ['phonepe.com'], flipkart: ['flipkart.com'],
  hdfcbank: ['hdfcbank.com'], icicibank: ['icicibank.com'], axisbank: ['axisbank.com'], onlinesbi: ['onlinesbi.sbi', 'onlinesbi.com'],
  chase: ['chase.com'], wellsfargo: ['wellsfargo.com'], bankofamerica: ['bankofamerica.com'], steam: ['steampowered.com', 'steamcommunity.com'],
  discord: ['discord.com', 'discord.gg'], spotify: ['spotify.com'], ebay: ['ebay.com'], adobe: ['adobe.com'], yahoo: ['yahoo.com'],
  snapchat: ['snapchat.com'], tiktok: ['tiktok.com'], docusign: ['docusign.com', 'docusign.net'], fedex: ['fedex.com'],
};
const KNOWN_DOMAINS = new Set(Object.values(BRANDS).flat());
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy', 'ow.ly', 'buff.ly', 'shorturl.at', 'tiny.cc']);
const RISKY_TLDS = new Set(['zip', 'mov', 'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'click', 'country', 'kim', 'work', 'support', 'rest', 'monster', 'icu', 'cyou', 'buzz']);
const PHISH_WORDS = ['login', 'signin', 'verify', 'secure', 'account', 'update', 'confirm', 'password', 'wallet', 'billing', 'suspend', 'unlock', 'recover', 'validate', 'banking', 'authenticate'];
const REDIR_PARAMS = new Set(['url', 'redirect', 'redirect_uri', 'redirect_url', 'redirecturl', 'next', 'return', 'returnurl', 'return_url', 'goto', 'continue', 'dest', 'destination', 'target', 'link', 'u', 'r']);
const SENSITIVE_PARAMS = new Set(['password', 'passwd', 'pwd', 'pass', 'otp', 'pin', 'cvv', 'card', 'cardnumber', 'ssn', 'secret']);
const SLD2 = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'nic', 'ne', 'or', 'go']);
const CONFUSABLE = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ѕ': 's', 'ј': 'j', 'ԁ': 'd', 'ɡ': 'g', 'ο': 'o', 'ν': 'v', 'α': 'a', 'ι': 'i', 'ρ': 'p', 'τ': 't', 'ı': 'i', 'ӏ': 'l', 'һ': 'h', 'ԛ': 'q', 'ѡ': 'w' };
const SCRIPTS = { latin: /[a-z]/i, cyrillic: /[\u0400-\u052f]/, greek: /[\u0370-\u03ff]/, armenian: /[\u0530-\u058f]/, hebrew: /[\u0590-\u05ff]/, arabic: /[\u0600-\u06ff]/, cjk: /[\u3040-\u30ff\u3400-\u9fff]/ };

function regDomain(host) {
  const l = host.split('.');
  if (l.length <= 2) return host;
  const tld = l[l.length - 1], sld = l[l.length - 2];
  if (tld.length === 2 && SLD2.has(sld)) return l.slice(-3).join('.');
  return l.slice(-2).join('.');
}
function leet(s) {
  return s.replace(/rn/g, 'm').replace(/vv/g, 'w').replace(/0/g, 'o').replace(/[1|]/g, 'l').replace(/3/g, 'e').replace(/4/g, 'a').replace(/[5$]/g, 's').replace(/7/g, 't');
}
function lev(a, b) {
  const d = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}

function analyzeUrl(input) {
  let s = String(input).trim();
  if (!s) throw new UserError('Empty input.');
  if (s.length > 4096) throw new UserError('URL too long (max 4096 characters).');
  if (/^(javascript|data|vbscript|file|blob):/i.test(s)) throw new UserError('Only http:// and https:// URLs are analyzed. Links using the "' + s.split(':')[0].toLowerCase() + ':" scheme are often abused — do not open them.');
  let assumed = false;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { s = 'https://' + s.replace(/^\/\//, ''); assumed = true; }
  let u;
  try { u = new URL(s); } catch { throw new UserError('Not a valid URL.'); }
  if (!/^https?:$/.test(u.protocol)) throw new UserError('Unsupported scheme "' + u.protocol + '" — only http and https are analyzed.');
  if (!u.hostname) throw new UserError('URL has no hostname.');

  const ind = [];
  const add = (w, t) => ind.push({ w, t });
  const host = u.hostname.toLowerCase();
  const ipStr = host.replace(/^\[|\]$/g, '');
  const uni = url.domainToUnicode(host) || host;
  const m = s.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i);
  const auth = m ? m[1] : '';
  const rawHost = auth.slice(auth.lastIndexOf('@') + 1).replace(/:\d*$/, '').toLowerCase();
  const isIp = net.isIP(ipStr) > 0;
  const reg = isIp ? ipStr : regDomain(host);
  const tld = host.split('.').pop();

  if (/[\s\x00-\x1f]/.test(String(input).trim())) add(2, 'URL contains whitespace or control characters.');
  if (u.protocol === 'http:') add(1, 'Uses unencrypted HTTP (no transport security).');
  if (u.username || u.password) {
    add(4, 'Embedded credentials in the URL (user@host). This trick is often used to disguise the real destination, which is "' + host + '".');
    if (/\./.test(decodeURIComponent(u.username.replace(/%(?![0-9a-f]{2})/gi, '')))) add(2, 'Text before "@" looks like a hostname — the real host is "' + host + '".');
  }
  if (isIp) {
    add(3, 'Hostname is a raw IP address (' + ipStr + ') rather than a domain name.');
    if (net.isIPv4(ipStr) && rawHost !== ipStr && !rawHost.startsWith('[')) add(3, 'IP address written in an obfuscated form (' + rawHost + ' → ' + ipStr + ').');
    const c = classifyIP(ipStr);
    if (c && c.local) add(2, 'Points to a local/private address (' + c.cls + ').');
  } else if (host === 'localhost' || host.endsWith('.localhost')) add(2, 'Points to localhost.');
  if (u.port) {
    const dev = ['8080', '8443', '8000', '3000'].includes(u.port);
    add(dev ? 1 : 2, 'Non-standard port ' + u.port + '.');
  }
  if (/[^\x00-\x7f]/.test(s.split(/[/?#]/)[2] || '') || host.split('.').some((l) => l.startsWith('xn--'))) {
    if (host.split('.').some((l) => l.startsWith('xn--'))) add(3, 'Punycode (xn--) label present; the hostname displays as "' + uni + '".');
    else add(2, 'Non-ASCII characters in hostname.');
  }
  for (const label of uni.split('.')) {
    const found = Object.keys(SCRIPTS).filter((k) => SCRIPTS[k].test(label));
    if (found.length > 1 && found.includes('latin')) { add(4, 'Mixed writing scripts (' + found.join('+') + ') in one hostname label — a classic homograph trick.'); break; }
  }
  if (!isIp) {
    const labels = host.split('.');
    if (labels.length > 4) add(2, 'Many subdomain levels (' + labels.length + ' labels).');
    if (host.length > 60) add(2, 'Very long hostname (' + host.length + ' characters).');
    else if (host.length > 40) add(1, 'Long hostname (' + host.length + ' characters).');
    if ((host.replace(/xn--/g, '').match(/-/g) || []).length >= 3) add(2, 'Hostname contains many hyphens.');
    if (RISKY_TLDS.has(tld)) add(1, 'Top-level domain ".' + tld + '" is frequently abused (weak signal; many legitimate sites use it).');
    if (SHORTENERS.has(reg)) add(2, 'URL shortener (' + reg + ') hides the final destination.');

    if (!KNOWN_DOMAINS.has(reg)) {
      const sld = reg.split('.')[0];
      const uniSld = (url.domainToUnicode(reg) || reg).split('.')[0];
      const skel = [...uniSld].map((ch) => CONFUSABLE[ch] || ch).join('');
      const tokens = host.split(/[.-]/);
      const best = {};
      const flag = (b, w, t) => { if (!best[b] || best[b].w < w) best[b] = { w, t }; };
      for (const b of Object.keys(BRANDS)) {
        const legit = BRANDS[b][0];
        if (b.length >= 4) {
          for (const t of tokens) {
            if (t === b) flag(b, 4, 'Brand name "' + b + '" appears in the hostname, but the registered domain is "' + reg + '" (the real one is e.g. ' + legit + ').');
            else if (leet(t) === b && t !== b) flag(b, 7, 'Lookalike of "' + b + '" using character substitution ("' + t + '"). Registered domain: "' + reg + '".');
          }
        }
        if (b.length >= 5 && sld.includes(b) && sld !== b) flag(b, 3, 'Registered domain "' + reg + '" embeds the brand "' + b + '" (real: ' + legit + ').');
        if (b.length >= 6 && sld !== b && lev(sld, b) === 1) flag(b, 4, '"' + sld + '" is one character away from the brand "' + b + '" (possible typosquat of ' + legit + ').');
        if (skel === b && uniSld !== b) flag(b, 7, 'Hostname uses look-alike Unicode characters to imitate "' + b + '".');
      }
      for (const b of Object.keys(best)) add(best[b].w, best[b].t);
      const hostWords = PHISH_WORDS.filter((k) => host.includes(k));
      if (hostWords.length) add(2, 'Hostname contains phishing-style words: ' + hostWords.join(', ') + '.');
    }
  }
  const pq = u.pathname + u.search;
  const pathWords = PHISH_WORDS.filter((k) => pq.toLowerCase().includes(k));
  if (!KNOWN_DOMAINS.has(reg) && pathWords.length >= 2) add(1, 'Path/query contains several sensitive-action words: ' + pathWords.join(', ') + '.');
  if (/%25[0-9a-f]{2}/i.test(pq)) add(2, 'Double percent-encoding (%25xx) in path/query.');
  if (/%(2f|5c|40|00)/i.test(u.pathname)) add(2, 'Encoded slash, backslash, "@" or NUL character in the path.');
  if (/%/.test(rawHost)) add(3, 'Percent-encoding inside the hostname.');
  if ((pq.match(/%[0-9a-f]{2}/gi) || []).length >= 8) add(1, 'Heavy percent-encoding in path/query.');
  if (s.length > 300) add(1, 'Very long URL (' + s.length + ' characters).');
  if (/\.(exe|apk|scr|bat|msi|jar|vbs|ps1|cmd|dmg|iso)$/i.test(u.pathname)) add(3, 'Path points directly to an executable/installer file (' + u.pathname.split('.').pop() + ').');
  for (const [k, v] of u.searchParams) {
    const kl = k.toLowerCase();
    if (REDIR_PARAMS.has(kl) && /^(https?:)?\/\//i.test(v)) {
      let th = '';
      try { th = new URL(v, 'https://x').hostname; } catch { /* ignore */ }
      if (th && regDomain(th) !== reg) add(2, 'Redirect-style parameter "' + k + '" points to another site (' + th + ').');
    }
    if (SENSITIVE_PARAMS.has(kl)) add(3, 'Query string has a sensitive-looking parameter "' + k + '" (secrets should not travel in URLs).');
    if (/^[A-Za-z0-9+/=_-]{80,}$/.test(v)) add(1, 'Long opaque token in parameter "' + k + '".');
  }
  return { u, ind, host, uni, reg, isIp, assumed };
}

async function inspectRedirects(start, o) {
  o = o || {};
  const max = o.max === undefined ? 5 : o.max;
  const r = { hops: [], final: null, error: null, blocked: null, truncated: false };
  let cur = start;
  for (let i = 0; i <= max; i++) {
    let res;
    try { res = await fetchT(cur, { redirect: 'manual', method: 'GET' }, 8000); }
    catch (e) { if (e instanceof Cancelled) throw e; r.error = { code: errCode(e), text: errText(e) }; r.errUrl = cur; return r; }
    const loc = res.headers.get('location');
    let cookies = [];
    try { cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : []; } catch { /* ignore */ }
    const hop = { url: cur, status: res.status };
    r.final = { url: cur, status: res.status, headers: res.headers, cookies };
    r.hops.push(hop);
    await drain(res, 0);
    if (res.status >= 300 && res.status < 400 && loc) {
      let next;
      try { next = new URL(loc, cur); } catch { return r; }
      hop.location = next.href;
      if (!/^https?:$/.test(next.protocol)) { r.blocked = 'Redirect to non-web scheme "' + next.protocol + '" (not followed).'; return r; }
      if (i === max) { r.truncated = true; return r; }
      if (!o.allowPrivate && (await isLocalHost(next.hostname))) { r.blocked = 'Redirect to "' + next.hostname + '", a local/private address (not followed).'; return r; }
      cur = next.href;
      continue;
    }
    return r;
  }
  return r;
}

async function gsbCheck(target) {
  const key = process.env.UGALOK_GSB_KEY;
  const body = {
    client: { clientId: 'ug-alok', clientVersion: VERSION },
    threatInfo: {
      threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
      platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url: target }],
    },
  };
  const r = await fetchT('https://safebrowsing.googleapis.com/v4/threatMatches:find?key=' + encodeURIComponent(key),
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 10000);
  try {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    return (j.matches || []).map((x) => x.threatType);
  } finally { if (r._end) r._end(); }
}

async function toolUrlAssess(fake) {
  section(fake ? 'Fake Website Checker' : 'LinkShield — URL Security Analyzer');
  para('Heuristic URL analysis. It looks for common phishing indicators and can never prove a site is genuine or fake. Page content is never read or executed.');
  hint('Enter alone returns to menu.');
  const a = await askValid('URL: ', analyzeUrl);
  if (!a) return;
  const { u } = a;
  const fetchHref = (() => { const c = new URL(u.href); c.username = ''; c.password = ''; return c.href; })();
  console.log('');
  if (a.assumed) info('No scheme given; assumed https://');
  kv('Scheme', u.protocol.replace(':', ''));
  kv('Host', a.host + (a.uni !== a.host ? '  → ' + a.uni : ''));
  kv('Registered domain', a.reg + dim(' (approximate)'));
  if (u.port) kv('Port', u.port);

  const ind = a.ind.slice();
  const add = (w, t) => ind.push({ w, t });
  let probe = null, httpsOk = null, reputation = null;

  console.log('');
  para('Optional network step: this device will send a GET request to the site (and follow up to 5 redirects, never to private addresses) to check HTTPS and redirects. Only headers are read; no forms, downloads or scripts. The site operator can see your IP.');
  if (await yn('Contact the site? [Y/n]: ', true)) {
    const allowPrivate = await isLocalHost(u.hostname);
    const sp = spinner('Contacting site (headers only) ...');
    try {
      probe = await inspectRedirects(fetchHref, { allowPrivate });
      if (u.protocol === 'http:') {
        const hp = await inspectRedirects('https://' + u.hostname + '/', { max: 3, allowPrivate });
        httpsOk = !hp.error;
        if (hp.error) add(isTlsCode(hp.error.code) ? 4 : 2, 'HTTPS is not available on this host: ' + hp.error.text + '.');
        else add(0, 'HTTPS is also reachable on this host.');
      }
    } finally { sp.stop(); }
    console.log('');
    console.log('  ' + white('Connection results'));
    if (probe.error) {
      warn('Could not fetch ' + (probe.errUrl === fetchHref ? 'the URL' : probe.errUrl) + ': ' + probe.error.text + '.');
      if (isTlsCode(probe.error.code)) add(4, 'TLS certificate validation failed: ' + probe.error.text + '.');
      else add(0, 'Site could not be reached (' + probe.error.text + '), so redirects and HTTPS were not verified.');
      if (u.protocol === 'https:') httpsOk = false;
    } else {
      if (u.protocol === 'https:') httpsOk = true;
      probe.hops.forEach((h, i) => console.log('  ' + dim(String(i + 1) + '.') + ' ' + h.status + ' ' + h.url.slice(0, W() * 2)));
      if (probe.hops.length > 1 || probe.hops[0].location) {
        const chain = probe.hops.length - 1;
        if (chain >= 3) add(1, chain + ' redirects in a row.');
        let diffAdded = false;
        for (const h of probe.hops) {
          if (!h.location) continue;
          const n = new URL(h.location), f = new URL(h.url);
          if (f.protocol === 'https:' && n.protocol === 'http:') add(3, 'Redirect downgrades from HTTPS to HTTP.');
          const nreg = net.isIP(n.hostname.replace(/^\[|\]$/g, '')) ? n.hostname : regDomain(n.hostname.toLowerCase());
          if (nreg !== a.reg && !diffAdded) { add(2, 'Redirects to a different registered domain: ' + nreg + '.'); diffAdded = true; }
          if (net.isIP(n.hostname.replace(/^\[|\]$/g, ''))) add(3, 'Redirect leads to a raw IP address host.');
        }
        const fin = new URL(probe.final.url);
        const freg = net.isIP(fin.hostname.replace(/^\[|\]$/g, '')) ? fin.hostname : regDomain(fin.hostname.toLowerCase());
        if (freg !== a.reg) {
          try { analyzeUrl(probe.final.url).ind.filter((x) => x.w >= 2).forEach((x) => add(x.w, '[final URL] ' + x.t)); } catch { /* ignore */ }
        }
      }
      if (probe.blocked) add(3, probe.blocked);
      if (probe.truncated) add(1, 'Redirect chain longer than 5 hops (stopped following).');
      kv('Final status', String(probe.final.status));
    }
  } else info('Network step skipped — assessment is based on URL text only.');

  if (fake) {
    console.log('');
    if (!process.env.UGALOK_GSB_KEY) {
      info('Reputation check not configured. Optional: set env var UGALOK_GSB_KEY to a Google Safe Browsing API key to enable it.');
    } else {
      warn('Reputation check is configured. The FULL URL would be sent to Google Safe Browsing (safebrowsing.googleapis.com).');
      if (await yn('Send this URL to Google Safe Browsing? [y/N]: ', false)) {
        const sp = spinner('Querying Safe Browsing ...');
        try { reputation = await gsbCheck(u.href); }
        catch (e) { if (e instanceof Cancelled) throw e; reputation = null; warn('Reputation lookup failed: ' + errText(e)); }
        finally { sp.stop(); }
        if (reputation && reputation.length) add(10, 'Google Safe Browsing lists this URL: ' + [...new Set(reputation)].join(', ') + '.');
        else if (reputation) add(0, 'Google Safe Browsing had no match (this is not proof of safety).');
      } else info('Reputation check skipped.');
    }
  }

  // report
  const score = ind.reduce((s, x) => s + x.w, 0);
  section('Indicators');
  const list = ind.slice().sort((x, y) => y.w - x.w);
  if (!list.some((x) => x.w > 0)) ok('No suspicious indicators found in the checks that were run.');
  for (const x of list) {
    if (x.w >= 4) wrapPrint(red('[HIGH] '), x.t, 7);
    else if (x.w >= 2) wrapPrint(gold('[MED]  '), x.t, 7);
    else if (x.w === 1) wrapPrint(white('[LOW]  '), x.t, 7);
    else wrapPrint(dim('[INFO] '), x.t, 7);
  }
  section('Assessment');
  kv('Indicator score', String(score));
  if (!fake) {
    const lab = score >= 7 ? red('HIGH') : score >= 3 ? gold('MEDIUM') : score >= 1 ? white('LOW') : green('NO INDICATORS FOUND');
    kv('Heuristic risk', bold(lab));
  } else {
    let v, why = '';
    if (score >= 7) v = red(bold('HIGH RISK'));
    else if (score >= 3) v = gold(bold('SUSPICIOUS'));
    else if (probe && !probe.error && httpsOk === true && score <= 1 && !a.isIp) { v = green(bold('LIKELY LEGITIMATE')); why = 'No warning indicators found, and the site answered over HTTPS with a valid certificate. This is the absence of red flags, not proof of ownership or intent.'; }
    else {
      v = white(bold('INSUFFICIENT EVIDENCE'));
      why = !probe ? 'Network checks were skipped, so HTTPS and redirects were not verified.' : probe.error ? 'The site could not be inspected.' : httpsOk !== true ? 'HTTPS could not be confirmed.' : 'Some weak indicators exist but not enough to conclude either way.';
    }
    kv('Verdict', v);
    if (why) para(why);
  }
  console.log('');
  rule();
  para('Limits: this is a heuristic estimate from the URL and a few connection checks. HTTPS only means traffic is encrypted — scammers use it too. Always verify important sites by typing the official address yourself, and never enter passwords on a link you did not expect.');
}

/* ───────────────────────── 4. HeaderGuard ───────────────────────── */

function parseHttpUrl(v) {
  let s = v.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new UserError('Not a valid URL.'); }
  if (!/^https?:$/.test(u.protocol)) throw new UserError('Only http:// and https:// URLs are supported.');
  if (u.username || u.password) throw new UserError('URLs with embedded credentials are not accepted.');
  return u;
}
async function toolHeaderGuard() {
  section('HeaderGuard — Website Security Checker');
  para('Checks HTTP security headers of a site YOU own or are authorized to test. It sends normal GET requests (up to 5 redirects) and reads headers only.');
  hint('Enter alone returns to menu.');
  const u = await askValid('Site URL: ', parseHttpUrl);
  if (!u) return;
  if (!(await yn('Do you own this site or have permission to test it? [y/N]: ', false))) { info('Not confirmed. Returning to menu.'); return; }
  const sp = spinner('Fetching headers ...');
  let r;
  try { r = await inspectRedirects(u.href, { allowPrivate: await isLocalHost(u.hostname) }); } finally { sp.stop(); }
  if (r.error) { err('Request failed: ' + r.error.text + '.'); return; }
  const f = r.final, h = f.headers, isHttps = f.url.startsWith('https:');
  kv('Final URL', f.url.slice(0, W() * 2));
  kv('Status', String(f.status) + (r.hops.length > 1 ? '  (' + (r.hops.length - 1) + ' redirect(s) followed)' : ''));
  if (r.blocked) warn(r.blocked);
  section('Security headers');
  let present = 0;
  const csp = h.get('content-security-policy') || '';
  const rows = [];
  const row = (name, val, state, why, note) => rows.push({ name, val, state, why, note });

  // CSP
  {
    const notes = [];
    if (csp) {
      if (/'unsafe-inline'/.test(csp)) notes.push("allows 'unsafe-inline'");
      if (/'unsafe-eval'/.test(csp)) notes.push("allows 'unsafe-eval'");
      if (/(^|[\s;])\*([\s;]|$)/.test(csp)) notes.push('uses a wildcard source (*)');
      if (!/(default-src|script-src)/.test(csp)) notes.push('no default-src or script-src directive');
    }
    row('Content-Security-Policy', csp, csp ? (notes.length ? 'weak' : 'ok') : 'missing', 'Restricts where scripts, styles and frames may load from; limits the impact of injected content (XSS).', notes.join('; '));
  }
  // HSTS
  {
    const v = h.get('strict-transport-security') || '';
    let st = v ? 'ok' : 'missing', note = '';
    if (!isHttps) { st = 'na'; note = 'only meaningful over HTTPS (final URL is HTTP)'; }
    else if (v) {
      const m = v.match(/max-age=(\d+)/i);
      if (!m) { st = 'weak'; note = 'no max-age directive'; }
      else if (Number(m[1]) < 15552000) { st = 'weak'; note = 'max-age under 180 days'; }
    }
    row('Strict-Transport-Security', v, st, 'Tells browsers to use HTTPS only for this site, preventing downgrade and cookie-stripping attacks.', note);
  }
  // XCTO
  {
    const v = h.get('x-content-type-options') || '';
    row('X-Content-Type-Options', v, v ? (/nosniff/i.test(v) ? 'ok' : 'weak') : 'missing', 'Stops browsers from guessing content types (MIME sniffing); the only valid value is "nosniff".', v && !/nosniff/i.test(v) ? 'value should be "nosniff"' : '');
  }
  // Referrer
  {
    const v = h.get('referrer-policy') || '';
    const weak = /unsafe-url|no-referrer-when-downgrade/i.test(v);
    row('Referrer-Policy', v, v ? (weak ? 'weak' : 'ok') : 'missing', 'Controls how much of the page URL is sent to other sites in the Referer header.', weak ? 'may leak full URLs to other origins' : '');
  }
  // Permissions-Policy
  {
    const v = h.get('permissions-policy') || '';
    row('Permissions-Policy', v, v ? 'ok' : 'missing', 'Allows or denies browser features (camera, microphone, geolocation, etc.) for the page and embedded frames.', '');
  }
  // XFO
  {
    const v = h.get('x-frame-options') || '';
    const viaCsp = /frame-ancestors/i.test(csp);
    let st = v ? 'ok' : (viaCsp ? 'ok' : 'missing'), note = '';
    if (v && !/^(deny|sameorigin)$/i.test(v.trim())) { st = 'weak'; note = 'unexpected or obsolete value'; }
    if (!v && viaCsp) note = 'not set, but CSP frame-ancestors provides the same protection';
    row('X-Frame-Options', v, st, 'Prevents other sites from embedding this page in a frame (clickjacking protection).', note);
  }
  for (const x of rows) {
    if (x.state === 'ok') present++;
    if (x.state === 'weak') present++;
    const sym = x.state === 'ok' ? green('[+] ') : x.state === 'weak' ? gold('[!] ') : x.state === 'na' ? dim('[-] ') : red('[x] ');
    wrapPrint(sym, white(x.name) + (x.state === 'missing' ? dim(' — not present') : x.state === 'na' ? dim(' — n/a') : ''), 4);
    if (x.val) wrapPrint('    ', dim(x.val.length > 120 ? x.val.slice(0, 117) + '...' : x.val), 4);
    wrapPrint('    ', x.why, 4);
    if (x.note) wrapPrint('    ', gold('Note: ') + x.note + '.', 4);
    if (x.state === 'missing') wrapPrint('    ', dim('A missing header is a hardening gap to review, not proof of a vulnerability.'), 4);
  }
  section('Other observations');
  const server = h.get('server'), powered = h.get('x-powered-by');
  if (server) (/\d/.test(server) ? warn : info)('Server header: ' + server + (/\d/.test(server) ? ' (reveals a version number)' : ''));
  if (powered) warn('X-Powered-By: ' + powered + ' (technology disclosure; consider removing)');
  if (!server && !powered) ok('No Server / X-Powered-By disclosure headers.');
  if (f.cookies.length) {
    const noSecure = f.cookies.filter((c) => !/;\s*secure/i.test(c)).length;
    const noHttp = f.cookies.filter((c) => !/;\s*httponly/i.test(c)).length;
    info(f.cookies.length + ' cookie(s) set. Without Secure: ' + noSecure + '. Without HttpOnly: ' + noHttp + '. (Some cookies legitimately omit these.)');
  }
  section('Summary');
  kv('Recommended headers present', present + ' / 6');
  para('This is a configuration review, not a vulnerability scan. Headers are one layer of defense; correct settings depend on your application, so test changes before deploying.');
}

/* ───────────────────────── 5. PassCheck ───────────────────────── */

const COMMON = new Set(('password 123456 12345678 123456789 1234567890 qwerty qwerty123 abc123 111111 000000 password1 password123 iloveyou admin administrator welcome monkey dragon letmein login master sunshine princess football baseball shadow superman michael trustno1 passw0rd p@ssw0rd 1q2w3e4r 1qaz2wsx zaq12wsx qazwsx asdfgh asdfghjkl zxcvbnm hello hello123 freedom whatever ninja mustang access flower starwars batman charlie donald secret computer internet changeme default guest root toor test test123 love lovely cheese cookie summer winter spring autumn india india123 krishna ganesh shiva bollywood cricket nopassword letmein123 welcome1 welcome123 abcd1234 abcdef qwertyuiop iloveu pokemon soccer hockey killer jordan harley ranger thomas tigger robert matrix mobile android termux hacker hack hacking').split(' '));
const KB_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'qazwsxedc', '1qaz2wsx3edc'];

function human(sec) {
  if (sec < 1) return 'less than a second';
  const u = [['second', 60], ['minute', 60], ['hour', 24], ['day', 365], ['year', 100], ['century', 1e9]];
  let v = sec;
  for (const [n, d] of u) {
    if (v < d) { const x = Math.round(v); return x + ' ' + n + (x === 1 ? '' : 's'); }
    v /= d;
  }
  return 'longer than the age of the universe';
}
function assessPassword(pw) {
  const find = [];
  const len = [...pw].length;
  const has = { lower: /[a-z]/.test(pw), upper: /[A-Z]/.test(pw), digit: /\d/.test(pw), sym: /[^\w\s]|_/.test(pw), space: /\s/.test(pw), other: /[^\x00-\x7f]/.test(pw) };
  const pool = (has.lower ? 26 : 0) + (has.upper ? 26 : 0) + (has.digit ? 10 : 0) + (has.sym ? 33 : 0) + (has.space ? 1 : 0) + (has.other ? 100 : 0) || 1;
  const uniq = new Set(pw).size;
  let bits = Math.log2(pool) * (uniq + 0.25 * (len - uniq));
  const low = pw.toLowerCase(), norm = leet(low);
  const base = norm.replace(/[\d\W_]+$/, '');
  if (COMMON.has(low) || COMMON.has(norm) || COMMON.has(base) || COMMON.has(low.replace(/[\d\W_]+$/, ''))) {
    bits = Math.min(bits, 12); find.push('Matches a very common password (or a trivial variation of one).');
  } else {
    const word = [...COMMON].find((w) => w.length >= 5 && norm.includes(w));
    if (word) { bits -= 8; find.push('Contains a common password or word.'); }
  }
  let seq = false;
  const cs = [...low];
  for (let i = 0; i + 2 < cs.length; i++) {
    const a = cs[i].charCodeAt(0), b = cs[i + 1].charCodeAt(0), c = cs[i + 2].charCodeAt(0);
    if (/[a-z0-9]/.test(cs[i]) && b - a === c - b && Math.abs(b - a) === 1) { seq = true; break; }
  }
  if (seq) { bits -= 8; find.push('Contains an alphabetic/numeric sequence (abc, 321 ...).'); }
  const kb = KB_ROWS.some((r) => { for (let i = 0; i + 4 <= r.length; i++) { const s = r.slice(i, i + 4); if (low.includes(s) || low.includes([...s].reverse().join(''))) return true; } return false; });
  if (kb) { bits -= 8; find.push('Contains a keyboard pattern (qwer, asdf, 1234 ...).'); }
  if (/(.)\1{2,}/.test(pw)) { bits -= 6; find.push('Contains repeated characters (aaa, 111 ...).'); }
  const rep = pw.match(/^(.+?)\1+$/);
  if (rep) { bits = (bits * rep[1].length) / len; find.push('The whole password is one short block repeated.'); }
  if (/(19|20)\d{2}/.test(pw)) { bits -= 6; find.push('Contains a year-like number (often guessable).'); }
  if (/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(pw)) { bits -= 6; find.push('Looks like it contains a date.'); }
  if (/^\d+$/.test(pw)) find.push('Digits only.');
  else if (/^[a-z]+$/i.test(pw)) find.push('Letters only.');
  bits = Math.max(0, Math.min(bits, 200));
  const label = bits < 28 ? 'VERY WEAK' : bits < 40 ? 'WEAK' : bits < 60 ? 'FAIR' : bits < 80 ? 'GOOD' : 'STRONG';
  const sug = [];
  if (len < 12) sug.push('Use at least 12–16 characters; length helps more than clever symbols.');
  if (find.length) sug.push('Avoid names, dictionary words, keyboard runs, repeats, years and dates.');
  sug.push('A passphrase of 4–6 random, unrelated words is both strong and memorable.');
  sug.push('Use a different password for every account, ideally from a reputable password manager.');
  sug.push('Turn on two-factor authentication where available.');
  return { len, has, bits, label, find, sug };
}
async function toolPassCheck() {
  section('PassCheck — Password Strength Auditor');
  para('Fully offline. Your password stays in this process: it is not printed, logged, saved, or sent anywhere. Typing is hidden.');
  hint('Enter alone returns to menu.');
  const pw = await askHidden('Password: ');
  if (!pw) return;
  if (pw.length > 256) { err('Please use 256 characters or fewer.'); return; }
  const r = assessPassword(pw);
  console.log('');
  kv('Length', String(r.len) + ' characters');
  kv('Lowercase / Uppercase', (r.has.lower ? 'yes' : 'no') + ' / ' + (r.has.upper ? 'yes' : 'no'));
  kv('Digits / Symbols', (r.has.digit ? 'yes' : 'no') + ' / ' + (r.has.sym ? 'yes' : 'no'));
  kv('Estimated entropy', '~' + r.bits.toFixed(0) + ' bits (rough)');
  const col = r.label === 'VERY WEAK' || r.label === 'WEAK' ? red : r.label === 'FAIR' ? gold : green;
  kv('Rating', bold(col(r.label)));
  const g = Math.pow(2, Math.max(r.bits - 1, 0));
  kv('Fast offline attack', human(g / 1e10) + dim(' (10 billion guesses/s)'));
  kv('Throttled online attack', human(g / 100) + dim(' (100 guesses/s)'));
  if (r.find.length) { console.log(''); console.log('  ' + white('Warnings')); r.find.forEach((x) => warn(x)); }
  console.log('');
  console.log('  ' + white('Suggestions'));
  r.sug.forEach((x) => info(x));
  console.log('');
  rule();
  para('This is an estimate based on length, character variety and a small built-in pattern list. Real attackers use large breach lists and smarter rules, so a "STRONG" label is not a guarantee. For breach checks, use a trusted service yourself — never paste passwords into random sites.');
}

/* ───────────────────────── 6. FileSentinel ───────────────────────── */

function sha256File(p, onProgress) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(p);
    const sig = current && current.signal;
    let n = 0;
    const onAbort = () => { s.destroy(); cleanup(); reject(new Cancelled()); };
    const cleanup = () => { if (sig) sig.removeEventListener('abort', onAbort); };
    if (sig) sig.addEventListener('abort', onAbort, { once: true });
    s.on('data', (c) => { h.update(c); n += c.length; onProgress(n); });
    s.on('error', (e) => { cleanup(); reject(e); });
    s.on('end', () => { cleanup(); resolve({ hex: h.digest('hex'), bytes: n }); });
  });
}
const fmtBytes = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB');
async function toolFileSentinel() {
  section('FileSentinel — File Integrity Checker');
  para('Calculates the SHA-256 hash of a local file (read-only; the file is never modified). Termux tip: run "termux-setup-storage" once, then use paths like ~/storage/downloads/file.zip');
  hint('Enter alone returns to menu.');
  const p = await askValid('File path: ', (v) => {
    let s = v.replace(/^["']|["']$/g, '');
    if (s === '~' || s.startsWith('~/')) s = os.homedir() + s.slice(1);
    return require('path').resolve(s);
  });
  if (!p) return;
  let st;
  try { st = await fs.promises.stat(p); }
  catch (e) { err(e.code === 'ENOENT' ? 'File not found: ' + p : e.code === 'EACCES' ? 'Permission denied: ' + p : 'Cannot access file (' + (e.code || e.message) + ').'); return; }
  if (!st.isFile()) { err('Not a regular file (is it a directory?): ' + p); return; }
  try { await fs.promises.access(p, fs.constants.R_OK); }
  catch { err('File is not readable (permission denied).'); return; }
  kv('File', p);
  kv('Size', fmtBytes(st.size));
  const t0 = Date.now();
  let lastDraw = 0;
  const sp = spinner('Hashing ...');
  let res;
  try { res = await sha256File(p, (n) => { if (Date.now() - lastDraw > 500 && process.stdout.isTTY) { lastDraw = Date.now(); process.stdout.write('\r\x1b[K' + gold('*') + ' Hashing ' + fmtBytes(n) + ' / ' + fmtBytes(st.size)); } }); }
  catch (e) { sp.stop(); if (e instanceof Cancelled) throw e; err('Read failed: ' + (e.code || e.message)); return; }
  sp.stop();
  ok('SHA-256 computed in ' + ((Date.now() - t0) / 1000).toFixed(2) + ' s');
  kv('SHA-256', '');
  console.log('  ' + white(res.hex));
  console.log('');
  const exp = await askValid('Expected SHA-256 to compare (Enter to skip): ', (v) => {
    let s = v.trim().toLowerCase().replace(/^sha-?256[:=]?\s*/, '').split(/\s+/)[0];
    if (!/^[0-9a-f]{64}$/.test(s)) throw new UserError('Expected hash must be 64 hexadecimal characters.');
    return s;
  });
  if (!exp) { info('No comparison requested.'); return; }
  if (exp === res.hex) ok('MATCH — the file hash equals the expected hash.');
  else { err('MISMATCH — the file does NOT match the expected hash.'); kv('Expected', ''); console.log('  ' + exp); }
  para('A match proves the file equals what the hash describes only if you got the expected hash from a trusted source (not from the same place as a possibly tampered download).');
}

/* ───────────────────────── 7. DNSLens / NetWatch ───────────────────────── */

function parseHostname(v) {
  let h = v.trim();
  if (/^[a-z]+:\/\//i.test(h)) { try { h = new URL(h).hostname; } catch { throw new UserError('Invalid URL.'); } }
  h = h.replace(/\.$/, '');
  if (net.isIP(h.replace(/^\[|\]$/g, ''))) throw new UserError('That is an IP address. Use IP Info (2) for IPs, or enter a hostname.');
  const a = url.domainToASCII(h);
  if (!a || a.length > 253 || !a.split('.').every((l) => /^[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/i.test(l))) throw new UserError('Invalid hostname.');
  return a.toLowerCase();
}
async function timed(fn) {
  const t = performance.now();
  try { const v = await withTimeout(fn(), 6000); return { ms: performance.now() - t, v }; }
  catch (e) { if (e instanceof Cancelled) throw e; return { ms: performance.now() - t, e }; }
}
const dnsErr = (e) => (e.code === 'ENODATA' || e.code === 'ENOTFOUND' ? 'no records' : e.code === 'ETIMEDOUT' || e.code === 'ETIMEOUT' ? 'timed out' : String(e.code || e.message));
async function toolDnsLens() {
  section('DNSLens / NetWatch');
  para('DNS diagnostics for one hostname, plus a read-only look at this device\'s own network configuration. No scanning of other devices.');
  hint('Enter alone skips to the local network view.');
  const host = await askValid('Hostname (e.g. example.com): ', parseHostname);
  if (host) {
    const sp = spinner('Resolving ' + host + ' ...');
    let a, aaaa, cname, l1, l2;
    try {
      a = await timed(() => dnsp.resolve4(host, { ttl: true }));
      aaaa = await timed(() => dnsp.resolve6(host, { ttl: true }));
      cname = await timed(() => dnsp.resolveCname(host));
      l1 = await timed(() => dnsp.lookup(host, { all: true }));
      l2 = await timed(() => dnsp.lookup(host, { all: true }));
    } finally { sp.stop(); }
    console.log('  ' + white('Resolver query results for ' + host));
    const show = (label, r) => {
      if (r.v && r.v.length) { ok(label + ' (' + r.ms.toFixed(0) + ' ms):'); r.v.forEach((x) => console.log('      ' + (typeof x === 'string' ? x : x.address + dim('  ttl ' + x.ttl + 's')))); }
      else warn(label + ' (' + r.ms.toFixed(0) + ' ms): ' + (r.e ? dnsErr(r.e) : 'none'));
    };
    show('A (IPv4)', a);
    show('AAAA (IPv6)', aaaa);
    show('CNAME', cname);
    console.log('');
    console.log('  ' + white('System resolver (dns.lookup)'));
    if (l1.v) {
      ok('Resolved in ' + l1.ms.toFixed(0) + ' ms (first), ' + l2.ms.toFixed(0) + ' ms (repeat — may be cached)');
      l1.v.forEach((x) => console.log('      ' + x.address + dim('  IPv' + x.family)));
    } else warn('System lookup failed after ' + l1.ms.toFixed(0) + ' ms: ' + dnsErr(l1.e));
    if (!a.v && l1.v) info('Direct DNS queries failed but the system resolver worked. On Termux the built-in resolver library may not find DNS servers; this is a local configuration limit, not a problem with the domain.');
    if (!a.v && !aaaa.v && !l1.v) info('No answer from any method. Check your connection, the spelling of the name, or whether the domain exists.');
  }
  section('Local network (this device)');
  kv('Hostname', os.hostname());
  try { kv('DNS servers', dns.getServers().join(', ') || 'none reported'); } catch { /* ignore */ }
  printInterfaces();
  try {
    const rt = fs.readFileSync('/proc/net/route', 'utf8').split('\n').slice(1);
    const def = rt.map((l) => l.trim().split(/\s+/)).find((c) => c[1] === '00000000');
    if (def) { const g = def[2].match(/../g).reverse().map((x) => parseInt(x, 16)).join('.'); kv('Default gateway', g + ' via ' + def[0]); }
    else info('No default IPv4 route found.');
  } catch { info('Default gateway unavailable (routing table not readable on this system).'); }
  para('Read-only: only information this device already has about its own configuration is shown.');
}

/* ───────────────────────── 9. Local Request Tester ───────────────────────── */

const RT = { DEF_COUNT: 2000, MAX_COUNT: 100000, MAX_CONC: 1, DEF_RPS: 20, MAX_RPS: 50, DEF_TO: 5, MAX_TO: 30, BODY_CAP: 65536 };
function intIn(v, def, lo, hi, name) {
  if (v === '') return def;
  if (!/^\d+$/.test(v)) throw new UserError(name + ' must be a whole number.');
  const n = Number(v);
  if (n < lo || n > hi) throw new UserError(name + ' must be between ' + lo + ' and ' + hi + '.');
  return n;
}
async function resolveLoopbackTarget(v) {
  let s = v.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'http://' + s;
  let u;
  try { u = new URL(s); } catch { throw new UserError('Not a valid URL.'); }
  if (u.protocol !== 'http:') throw new UserError('Only http:// targets are allowed (local dev servers).');
  if (u.username || u.password) throw new UserError('Credentials in the URL are not allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addrs;
  if (net.isIP(host)) addrs = [host];
  else {
    try { addrs = (await withTimeout(dnsp.lookup(host, { all: true }), 4000)).map((x) => x.address); }
    catch (e) { if (e instanceof Cancelled) throw e; throw new UserError('Cannot resolve host "' + host + '" (' + (e.code || e.message) + ').'); }
  }
  const bad = addrs.filter((x) => { const c = classifyIP(x); return !c || c.cls !== 'loopback'; });
  if (!addrs.length || bad.length) throw new UserError('REJECTED: "' + host + '" is not a loopback address' + (bad.length ? ' (resolves to ' + bad[0] + ')' : '') + '. Only 127.0.0.0/8, ::1 and localhost are allowed.');
  const ip = addrs.find((x) => net.isIPv4(x)) || addrs[0];
  const pinned = new URL(u.href);
  pinned.hostname = net.isIPv6(ip) ? '[' + ip + ']' : ip;
  return { u, pinned, ip };
}
async function toolRequestTester() {
  section('Local Request Tester');
  para('Measures how YOUR OWN local dev server responds to a limited number of GET requests. Loopback targets only (localhost, 127.x.x.x, ::1). Redirects are never followed; concurrency is fixed at 1.');
  hint('Enter alone returns to menu. Ctrl+C stops a running test.');
  const t = await askValid('Target URL [http://127.0.0.1:3000/]: ', (v) => v);
  let target = t;
  if (t === null) { if (!(await yn('Use default http://127.0.0.1:3000/ ? [y/N]: ', false))) return; target = 'http://127.0.0.1:3000/'; }
  let tg;
  for (;;) {
    try { tg = await resolveLoopbackTarget(target); break; }
    catch (e) {
      if (!(e instanceof UserError)) throw e;
      err(e.message);
      target = await ask('Target URL (Enter to go back): ');
      if (!target) return;
    }
  }
  const count = await askValid('Request count [' + RT.DEF_COUNT + ', max ' + RT.MAX_COUNT + ']: ', (v) => intIn(v, RT.DEF_COUNT, 1, RT.MAX_COUNT, 'Count')) ;
  const n = count === null ? RT.DEF_COUNT : count;
  const rpsIn = await askValid('Rate limit, requests/sec [' + RT.DEF_RPS + ', max ' + RT.MAX_RPS + ']: ', (v) => intIn(v, RT.DEF_RPS, 1, RT.MAX_RPS, 'Rate'));
  const rps = rpsIn === null ? RT.DEF_RPS : rpsIn;
  const toIn = await askValid('Timeout seconds [' + RT.DEF_TO + ', max ' + RT.MAX_TO + ']: ', (v) => intIn(v, RT.DEF_TO, 1, RT.MAX_TO, 'Timeout'));
  const to = toIn === null ? RT.DEF_TO : toIn;

  section('Test plan');
  kv('Target', tg.u.href);
  kv('Connects to', tg.ip + ' (loopback, pinned)');
  kv('Requests', String(n));
  kv('Concurrency', RT.MAX_CONC + ' (fixed)');
  kv('Rate limit', rps + ' req/s');
  kv('Timeout', to + ' s per request');
  kv('Est. duration', 'about ' + human(n / rps) + ' (upper bound)');
  const go = (await ask('Type YES to start (anything else cancels): ')).toLowerCase();
  if (go !== 'yes') { info('Cancelled. No requests were sent.'); return; }

  const sig = current.signal;
  const st = { done: 0, ok: 0, httpErr: 0, fail: 0, codes: {}, errs: {}, extRedir: 0, min: Infinity, max: 0, sum: 0, consec: 0 };
  const interval = 1000 / rps;
  const t0 = performance.now();
  let lastDraw = 0, stopReason = '';
  const draw = (force) => {
    const now = Date.now();
    if (!force && now - lastDraw < 300) return;
    lastDraw = now;
    const el = (performance.now() - t0) / 1000;
    const line = '[' + st.done + '/' + n + '] ok ' + st.ok + ' err ' + (st.httpErr + st.fail) + ' | ' + (st.done / Math.max(el, 0.001)).toFixed(1) + '/s';
    if (process.stdout.isTTY) process.stdout.write('\r\x1b[K' + gold('> ') + line);
    else if (force || st.done % Math.max(1, Math.floor(n / 10)) === 0) console.log(line);
  };
  console.log('');
  for (let i = 0; i < n; i++) {
    if (sig.aborted) { stopReason = 'Cancelled by user'; break; }
    const wait = t0 + i * interval - performance.now();
    if (wait > 1) await sleepAbortable(wait);
    if (sig.aborted) { stopReason = 'Cancelled by user'; break; }
    // revalidate: the pinned host must still be a loopback literal
    const ph = new URL(tg.pinned.href).hostname.replace(/^\[|\]$/g, '');
    if (!classifyIP(ph) || classifyIP(ph).cls !== 'loopback') { stopReason = 'Target failed loopback revalidation'; break; }
    const s = performance.now();
    try {
      const res = await fetchT(tg.pinned.href, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': 'UG-ALOK-LocalRequestTester/' + VERSION } }, to * 1000);
      const code = res.status, loc = res.headers.get('location');
      await drain(res, RT.BODY_CAP);
      const ms = performance.now() - s;
      st.min = Math.min(st.min, ms); st.max = Math.max(st.max, ms); st.sum += ms;
      st.codes[code] = (st.codes[code] || 0) + 1;
      if (code < 400) st.ok++; else st.httpErr++;
      if (code >= 300 && code < 400 && loc) {
        try { const lu = new URL(loc, tg.u.href); const c = net.isIP(lu.hostname.replace(/^\[|\]$/g, '')) ? classifyIP(lu.hostname.replace(/^\[|\]$/g, '')) : null; if (lu.hostname !== 'localhost' && (!c || c.cls !== 'loopback')) st.extRedir++; } catch { /* ignore */ }
      }
      st.consec = 0;
    } catch (e) {
      if (e instanceof Cancelled) { stopReason = 'Cancelled by user'; break; }
      st.fail++; st.consec++;
      const k = errCode(e) === 'ETIMEDOUT' ? 'timeout' : errCode(e);
      st.errs[k] = (st.errs[k] || 0) + 1;
    }
    st.done++;
    draw(false);
    if (st.consec >= 25) { stopReason = 'Stopped early: 25 consecutive failures (is the server running?)'; break; }
  }
  const elapsed = (performance.now() - t0) / 1000;
  draw(true);
  if (process.stdout.isTTY) process.stdout.write('\n');
  section('Results');
  if (stopReason) warn(stopReason);
  kv('Planned', String(n));
  kv('Completed', st.done + ' (' + st.ok + ' ok, ' + st.httpErr + ' HTTP errors, ' + st.fail + ' failed)');
  kv('Elapsed', elapsed.toFixed(2) + ' s');
  kv('Throughput', (st.done / Math.max(elapsed, 0.001)).toFixed(1) + ' req/s');
  const resp = st.ok + st.httpErr;
  if (resp) kv('Latency', 'avg ' + (st.sum / resp).toFixed(1) + ' ms, min ' + st.min.toFixed(1) + ', max ' + st.max.toFixed(1));
  const codes = Object.keys(st.codes).sort();
  if (codes.length) { console.log('  ' + white('HTTP status codes')); codes.forEach((c) => console.log('    ' + c + ': ' + st.codes[c])); }
  const errs = Object.keys(st.errs);
  if (errs.length) { console.log('  ' + white('Failures')); errs.forEach((c) => console.log('    ' + c + ': ' + st.errs[c])); }
  if (st.extRedir) warn(st.extRedir + ' response(s) redirected to non-loopback hosts; none were followed.');
  if (st.errs.ECONNREFUSED) info('Connection refused: nothing is listening at that address/port.');
}

/* ───────────────────────── menu ───────────────────────── */

const TOOLS = [
  ['IP Show', 'local + public IP', toolIpShow],
  ['IP Info', 'validate & classify IP', toolIpInfo],
  ['LinkShield', 'URL security analyzer', () => toolUrlAssess(false)],
  ['HeaderGuard', 'HTTP header checker', toolHeaderGuard],
  ['PassCheck', 'password auditor', toolPassCheck],
  ['FileSentinel', 'SHA-256 integrity', toolFileSentinel],
  ['DNSLens/NetWatch', 'DNS + local network', toolDnsLens],
  ['Fake Website Checker', 'lookalike & phishing', () => toolUrlAssess(true)],
  ['Local Request Tester', 'loopback only', toolRequestTester],
];
function showMenu() {
  console.log('');
  console.log('  ' + gold(bold('MAIN MENU')));
  TOOLS.forEach((t, i) => console.log('  ' + red('[' + (i + 1) + ']') + ' ' + white(t[0]) + ' ' + dim('· ' + t[1])));
  console.log('  ' + red('[0]') + ' ' + white('Exit'));
}
function goodbye() { console.log('\n' + gold('Stay safe. — UG ALOK')); }
function onSigint() {
  if (current && !current.signal.aborted) { current.abort(); console.log('\n' + gold('[!] Cancelling ...')); return; }
  goodbye();
  process.exit(0);
}
process.on('SIGINT', onSigint);
rl.on('SIGINT', onSigint);
process.on('unhandledRejection', (e) => { if (!(e instanceof Cancelled)) console.error(red('[x] Unexpected error: ' + (e && e.message))); });

async function main() {
  const arg = process.argv[2];
  if (arg === '--version' || arg === '-v') { console.log('UG ALOK Ultimate Security Toolkit v' + VERSION); process.exit(0); }
  if (arg === '--help' || arg === '-h') { console.log('Usage: node main.js\nInteractive menu. Options: --version, --help'); process.exit(0); }
  banner();
  for (;;) {
    showMenu();
    const c = (await ask('\n' + gold('Select [0-' + TOOLS.length + ']: '))).toLowerCase();
    if (c === '0' || c === 'q' || c === 'exit') break;
    if (!/^[1-9]$/.test(c) || Number(c) > TOOLS.length) { err('Invalid choice. Enter a number from 0 to ' + TOOLS.length + '.'); continue; }
    current = new AbortController();
    try { await TOOLS[Number(c) - 1][2](); }
    catch (e) {
      if (e instanceof Cancelled) { console.log(''); warn('Cancelled. Returning to menu.'); }
      else if (e instanceof UserError) err(e.message);
      else err('Unexpected error: ' + (e && e.message ? e.message : String(e)));
    } finally { current = null; }
    console.log('');
    rule();
    await ask(dim('Press Enter to return to the menu ...'));
  }
  goodbye();
  rl.close();
  process.exit(0);
}
main();
