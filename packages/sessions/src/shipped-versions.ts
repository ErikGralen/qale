import { slugFromPath } from '@qale/domain';

/**
 * Every version of every pack file we have ever shipped, by fingerprint.
 *
 * This is what lets a second build reach the people who installed the first
 * one. On open, each shipped file on disk is fingerprinted: if it matches a
 * version we shipped, nobody has touched it and we bring it up to date without
 * saying a word. If it matches none, those are the PM's own words and we leave
 * them exactly where they are and offer a review instead.
 *
 * Deliberately stateless. Nothing is written into the file (it would show up in
 * the text and the skill page's save path could drop it) and nothing is kept in
 * this machine's database (move the workspace to another laptop and every
 * untouched file would suddenly read as edited). The question "is this one of
 * ours" is answered by the bytes alone, so it travels with the folder.
 *
 * ## Changing a shipped file
 *
 * **Append the new fingerprint. Never replace the last one.** The older entries
 * are exactly what lets a workspace still on last month's build update quietly;
 * drop them and those people get asked about a change they never made. Run
 * `pnpm --filter @qale/sessions test` after any edit to the pack: one test asserts
 * the last entry here is the fingerprint of what `defaults.ts` holds right now,
 * and prints the line to add when it is not.
 */

/**
 * The fingerprint of one shipped version.
 *
 * Not a checksum in the security sense. The only question it answers is whether
 * a file is byte-for-byte one of a handful of strings we wrote, so length plus
 * two independent 32-bit mixes is far past enough, and staying pure JS keeps
 * this package free of node (the renderer imports it too).
 *
 * Line endings and the trailing newline are levelled first: a file that
 * round-tripped through an editor on another platform is still our version, and
 * we would rather not ask someone about a change they cannot even see.
 */
export function shippedHash(content: string): string {
  const text = content.replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    fnv = Math.imul(fnv ^ c, 0x01000193);
    djb = (Math.imul(djb, 33) + c) | 0;
  }
  return `${text.length.toString(36)}.${(fnv >>> 0).toString(36)}.${(djb >>> 0).toString(36)}`;
}

/**
 * Keyed by the runnable's slug rather than its path, because one file has had
 * two addresses: `skills/ask.md` and `skills/ask/SKILL.md` are the same skill in
 * the flat layout and the folder one, and {@link slugFromPath} folds both to
 * `skills/ask`. Oldest version first; the last entry is what ships today.
 *
 * The two `agents/` entries the retired list carries are absent on purpose:
 * they were named defensively and this codebase never seeded either, so there is
 * no version of them to recognise.
 */
const SHIPPED_VERSIONS: Record<string, string[]> = {
  'agents/librarian': [
    '1zk.11dvpjd.1jo9kcl',
    '1zm.rpd6cu.16b3bw0',
    '5wv.ammmiy.142go7k',
    '61w.1g17866.q1803y',
  ],
  'agents/meeting-prep': ['1uh.1sio3id.agirl9'],
  'skills/_about-us': ['19h.15yrv59.9eyvbd'],
  'skills/_filing-rules': [
    '103.1rrplbr.u0ann7',
    '21k.1sye54d.1bs4rqr',
    '27v.ijs3um.1y7xpek',
    '2ce.rktoxz.25qpoh',
  ],
  'skills/_language': ['125.16bb1r3.dnnznt'],
  'skills/arrival': [
    '4nl.1awfavz.4dny5d',
    '42d.1a7awl.vtvcnl',
    '4hm.hu02ga.115uqhq',
    '4sw.hhht3z.19lnzx1',
    '70a.1mj7r70.14h70xw',
  ],
  'skills/commitment-check': ['2tx.6u8hrg.vune7q', '2gb.1lzuw03.ac2r2n'],
  'skills/process-note': ['23w.7lq1u2.1b9sk4w', '1qu.1pwoy5p.1yyao8n'],
  'skills/synthesis': [
    '31v.1otwr42.ym2wem',
    '32f.xbf6pa.l0nv9k',
    '4gi.kbif1w.lfldzg',
    '3w3.1o6hodx.1z12qa1',
    '6ki.1jyxglj.1cls3ub',
  ],
  'skills/voice-cs': [
    'bq.1vhel3h.1a9h6nj',
    'd5.rrnkrx.zvmpd',
    'dg.1eu1mco.hxtsg2',
    'cq.ry4xbt.1x65rbr',
  ],
  'skills/voice-exec': ['aj.m5j2g2.15jr1hy', 'bz.1g4g4ko.aeo07s', 'b9.lk1yzt.uy831p'],
  'skills/weekly-update': [
    '122.13patcw.giexae',
    '11u.psc9bq.1ctgz0e',
    '1lz.szogcu.1j7ptb4',
    '1hy.ycj4rt.8ovwpn',
  ],

  // Retired. Their versions stay listed forever: it is the only way to tell an
  // untouched copy (safe to take away) from one somebody rewrote (theirs).
  'skills/after-meeting': [
    '1fx.1mhx2gy.gr26xw',
    '1xl.11n64wd.1ckxmeb',
    '2dh.oezshb.p8wtrb',
    '2d2.15gse1w.1aamslk',
    '3km.1eeq3af.1azcgvb',
  ],
  'skills/ask': ['kv.3f53qd.1t38clr', 'lo.4322pt.of9in', 'qj.uy22ne.71pk80', 'su.1d6r761.1guxtjx'],
  'skills/before-meeting': ['1gq.bl2nya.1a11dz0', '1df.z4bdep.ywqnmn', '1tw.kzh4ak.1u4qvpe'],
  'skills/chat': [
    'd6.empwdo.1h93omm',
    'db.2f9oef.1d1zgkv',
    'd9.2u52ul.djz5ld',
    'm6.blwasr.q6pnfr',
    'rx.1yv7ibm.gdfi02',
    'qx.n5hrwb.h4br53',
  ],
  'skills/external-transcript': ['1tt.17k7y93.1vvjucj', '1vw.m0s7ha.rovl8q', '1vs.ghsrbq.q5cy1a'],
  'skills/intake': ['1t5.be6ykb.bbxf4v', '1x9.n9wdsw.10xvlhg', '1x7.1hpsyu6.1llcrl2'],
  'skills/interview-synthesis': ['qk.1xczlj2.1is8s76', 'v0.1m5behv.17kszad'],
  'skills/librarian': ['z3.9lefsn.zzf3kr', '1p6.veghxy.czw65c'],
  'skills/spec-review': ['ob.scdmjc.1u278wm'],
  'skills/sprint-review': ['n4.rpxayz.420o7x'],
};

/** Every fingerprint we ever shipped for the file at this path, oldest first. */
export function shippedVersionsOf(file: string): string[] {
  return SHIPPED_VERSIONS[slugFromPath(file)] ?? [];
}
