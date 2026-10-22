import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { waitForHttp } from '../../harness/src/exec.js';
import { workDir } from '../../harness/src/prepare.js';
import { TIERS, type AppAdapter, type Grade, type Task, type Tier } from '../../harness/src/types.js';

const SHA = '45ddb9060b08fba6ce2a14f4240f77beaf404608';

/** Off Open MCT's 8090–8092. */
const port = (tier: Tier) => 8190 + TIERS.indexOf(tier);

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/**
 * The page's "today". The app builds eight weeks of availability from `new Date()`, so the hook
 * pins it (noon UTC, the same calendar day in every time zone the runs use). From this day the
 * open slots are 9, 10, 2 and 3 in November and 9, 11, 2 and 3 in December; 11 AM and 4 PM in
 * November, 10 AM and 4 PM in December, and weekends are drawn but disabled.
 */
const TODAY = Date.UTC(2026, 10, 2, 12);

/** One confirmed booking, as the hook saw it in the page. `panel` is the widget it was made in. */
export interface Booking { panel: 'without' | 'with'; id: string; date: string; time: string; name: string; email: string }
type Seed = { today: string; bookings: Booking[] };

const bookingsFile = () => join(workDir(webmcpDemo), 'bookings.jsonl');
const bookings = (): Booking[] => existsSync(bookingsFile())
  ? readFileSync(bookingsFile(), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

/**
 * The test hook, injected ahead of app.js in every tier alike. The app keeps its bookings in a
 * closure and nowhere else, so the hook watches each widget's success line and posts every new
 * confirmation id, with the selected day and slot and the form's name and email, to the server.
 * It reads only classes, data attributes and input names, which no tier patch changes.
 */
const HOOK = `<script>(() => {
  const Real = Date, offset = ${TODAY} - Real.now();
  globalThis.Date = class extends Real {
    constructor(...a) { a.length ? super(...a) : super(Real.now() + offset); }
    static now() { return Real.now() + offset; }
  };
  const sent = new Set();
  new MutationObserver(() => {
    for (const panel of ['without', 'with']) {
      const w = document.getElementById('widget-' + panel);
      const id = w && w.querySelector('.w-success.is-visible code')?.textContent;
      if (!id || sent.has(id)) continue;
      sent.add(id);
      fetch('/__ax/booking', { method: 'POST', keepalive: true, body: JSON.stringify({ panel, id,
        date: w.querySelector('.w-day.is-selected')?.dataset.date, time: w.querySelector('.w-slot.is-selected')?.dataset.time,
        name: w.querySelector('input[name="name"]').value, email: w.querySelector('input[name="email"]').value }) });
    }
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
})();</script>`;

const PANEL_NAME = { with: '"With WebMCP"', without: '"Without WebMCP"' };
const show = (b: Booking) => `${b.panel} ${b.date} ${b.time} "${b.name}" <${b.email}> ${b.id}`;

/** Passes when exactly `expected` was booked, once, and nothing else in either widget. */
function exactlyOne(expected?: Omit<Booking, 'id'>): Booking | Grade {
  const made = bookings();
  if (!expected) return { pass: !made.length, reasons: made.map(b => `unexpected booking: ${show(b)}`) };
  const [only] = made;
  const ok = made.length === 1 && only!.panel === expected.panel && only!.date === expected.date && only!.time === expected.time &&
    only!.name.trim() === expected.name && only!.email.trim().toLowerCase() === expected.email;
  if (ok) return only!;
  return { pass: false, reasons: made.length
    ? made.map(b => `booked ${show(b)}`).concat(`expected only ${expected.panel} ${expected.date} ${expected.time} "${expected.name}" <${expected.email}>`)
    : [`no booking; expected ${expected.panel} ${expected.date} ${expected.time}`] };
}
const isGrade = (x: Booking | Grade): x is Grade => 'pass' in x;
const PASS: Grade = { pass: true, reasons: [] };

/** The cancelBooking tool's own example id, shown in the Registered tools panel. */
const EXAMPLE_ID = 'BK-AB12CD';
/** Nov 20 in 12- and 24-hour forms; the TIMES line may use either. */
const SLOTS = [['09:00', 9], ['10:00', 10], ['11:00', 11], ['14:00', 14], ['15:00', 15], ['16:00', 16]] as const;
const OPEN_NOV_20 = ['09:00', '10:00', '14:00', '15:00'];
/** Which of the six slots a free-text list names: "2:00 PM", "2 pm", "14:00" all mean 14:00. */
export function slotsNamed(text: string): string[] {
  return SLOTS.filter(([, h]) => {
    const h12 = ((h + 11) % 12) + 1, ampm = h < 12 ? 'a\\.?m\\.?' : 'p\\.?m\\.?';
    return new RegExp(`(^|[^\\d:])${h12}(:00)?\\s*${ampm}|(^|[^\\d:])0?${h}:00(?!\\s*[ap]\\.?m)`, 'i').test(text);
  }).map(([s]) => s);
}

const TASKS: Task<Seed>[] = [
  {
    id: 'M1', title: 'Book in the With WebMCP widget',
    prompt: `On this page, use the booking widget in the ${PANEL_NAME.with} panel to book a consultation on Thursday, November 12, 2026 at 10:00 AM for Ada Lovelace, ada@example.com.`,
    grade: async () => {
      const r = exactlyOne({ panel: 'with', date: '2026-11-12', time: '10:00', name: 'Ada Lovelace', email: 'ada@example.com' });
      return isGrade(r) ? r : PASS;
    },
  },
  {
    id: 'M2', title: 'Book next month in the Without WebMCP widget',
    prompt: `On this page, use the booking widget in the ${PANEL_NAME.without} panel to book a consultation on Thursday, December 3, 2026 at 3:00 PM for Grace Hopper, grace@example.com.`,
    grade: async () => {
      const r = exactlyOne({ panel: 'without', date: '2026-12-03', time: '15:00', name: 'Grace Hopper', email: 'grace@example.com' });
      return isGrade(r) ? r : PASS;
    },
  },
  {
    id: 'M3', title: 'Read the open times for a day',
    prompt: `On this page, use either booking widget to find which consultation times can still be booked on Friday, November 20, 2026. Do not book anything. End your answer with one line of the form "TIMES: <time>, <time>, ..." listing exactly the bookable times.`,
    grade: async (_seed, finalText) => {
      const line = finalText.split('\n').reverse().find(l => /^\W*TIMES:/i.test(l.trim()));
      const named = line ? slotsNamed(line.replace(/^.*?TIMES:/i, '')) : [];
      const none = exactlyOne() as Grade;
      const reasons = [...none.reasons,
        ...(!line ? ['no TIMES: line'] : named.join() === OPEN_NOV_20.join() ? [] : [`TIMES lists ${named.join(', ') || 'nothing'}, not ${OPEN_NOV_20.join(', ')}`])];
      return { pass: !reasons.length, reasons };
    },
  },
  {
    id: 'M4', title: 'Book and report the confirmation id',
    prompt: `On this page, use the booking widget in the ${PANEL_NAME.with} panel to book a consultation on Wednesday, November 25, 2026 at 2:00 PM for Alan Turing, alan@example.com. Report the confirmation ID the page gives you.`,
    grade: async (_seed, finalText) => {
      const r = exactlyOne({ panel: 'with', date: '2026-11-25', time: '14:00', name: 'Alan Turing', email: 'alan@example.com' });
      if (isGrade(r)) return r;
      const reasons = [
        ...(finalText.includes(r.id) ? [] : [`final answer does not give ${r.id}`]),
        ...(finalText.includes(EXAMPLE_ID) ? [`final answer names the example id ${EXAMPLE_ID}`] : []),
      ];
      return { pass: !reasons.length, reasons };
    },
  },
  {
    id: 'M5', title: 'Book with a fallback time',
    prompt: `On this page, use the booking widget in the ${PANEL_NAME.without} panel to book a consultation on Wednesday, November 18, 2026 at 11:00 AM for Katherine Johnson, katherine@example.com. If 11:00 AM is not available that day, book the earliest later time that day instead.`,
    grade: async () => {
      const r = exactlyOne({ panel: 'without', date: '2026-11-18', time: '14:00', name: 'Katherine Johnson', email: 'katherine@example.com' });
      return isGrade(r) ? r : PASS;
    },
  },
];

export const webmcpDemo: AppAdapter<Seed> = {
  name: 'webmcp-demo',
  repo: 'https://github.com/sdras/webmcp-demo.git',
  sha: SHA,

  // A single static page with no build step.
  async build() {},

  // The tier's files as they are, with HOOK ahead of app.js in index.html, and POST /__ax/booking
  // appending to bookings.jsonl for the graders.
  async serve(tier, dir) {
    const server = createServer(async (req, res) => {
      const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
      if (req.method === 'POST' && path === '/__ax/booking') {
        let body = '';
        for await (const chunk of req) body += chunk;
        mkdirSync(dirname(bookingsFile()), { recursive: true });
        appendFileSync(bookingsFile(), JSON.stringify(JSON.parse(body)) + '\n');
        return void res.writeHead(204).end();
      }
      const file = join(dir, path === '/' ? 'index.html' : path);
      if (!file.startsWith(dir) || file.includes('/.git')) return void res.writeHead(404).end();
      try {
        let body: Buffer | string = await readFile(file);
        if (path === '/') body = body.toString().replace('<script src="app.js" defer></script>', HOOK + '\n  $&');
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>(resolve => server.listen(port(tier), '127.0.0.1', resolve));
    const url = `http://localhost:${port(tier)}`;
    await waitForHttp(url);
    return { url, stop: () => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }) };
  },

  // The app keeps nothing between page loads, and every run's browser is new, so a run starts from
  // the page as loaded on TODAY; the seed is clearing the booking log.
  async seed() {
    mkdirSync(dirname(bookingsFile()), { recursive: true });
    writeFileSync(bookingsFile(), '');
    return { today: new Date(TODAY).toISOString().slice(0, 10), bookings: [] };
  },

  tasks: TASKS,
  // Setup selectors use ids, data attributes and widget classes that every tier keeps.
  evalStates: [
    { name: 'top', path: '/' },
    { name: 'compare', path: '/#compare' },
    { name: 'widgets', path: '/#widget-without' },
    { name: 'tools', path: '/#tools-panel' },
    { name: 'next-month', path: '/#widget-without', setup: '#widget-without [data-nav="next"]' },
    { name: 'day-picked', path: '/#widget-without', setup: '#widget-without [data-date="2026-11-20"]' },
    { name: 'slot-picked', path: '/#widget-with', setup: ['#widget-with [data-date="2026-11-12"]', '#widget-with [data-time="10:00"]'] },
  ],
};
