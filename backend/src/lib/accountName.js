'use strict';

// Some RDP clients send the username as UTF-8 and Windows logs those bytes read
// as Windows-1252, so 'Администратор' lands in the Security log as 'Ð\u0090Ð´Ð¼...'.
// Left as is, the name matches nothing on the auto-ban list: an attacker got a
// free pass for over a day as a "single unknown account" (85.235.148.7, TS01).
//
// Reversed only when the result is valid UTF-8. A genuine Latin-1 name such as
// 'Müller' has a lone high byte, which never is, so it stays untouched.

// The Windows-1252 characters that live outside Latin-1, mapped back to their byte.
const CP1252 = new Map([
  [0x20AC, 0x80], [0x201A, 0x82], [0x0192, 0x83], [0x201E, 0x84], [0x2026, 0x85], [0x2020, 0x86],
  [0x2021, 0x87], [0x02C6, 0x88], [0x2030, 0x89], [0x0160, 0x8A], [0x2039, 0x8B], [0x0152, 0x8C],
  [0x017D, 0x8E], [0x2018, 0x91], [0x2019, 0x92], [0x201C, 0x93], [0x201D, 0x94], [0x2022, 0x95],
  [0x2013, 0x96], [0x2014, 0x97], [0x02DC, 0x98], [0x2122, 0x99], [0x0161, 0x9A], [0x203A, 0x9B],
  [0x0153, 0x9C], [0x017E, 0x9E], [0x0178, 0x9F],
]);

function repairAccount(name) {
  const s = String(name ?? '');
  const bytes = [];
  let high = false;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const b = CP1252.has(c) ? CP1252.get(c) : c;
    if (b > 0xFF) return s; // a real non-Latin character: not this kind of damage
    if (b >= 0x80) high = true;
    bytes.push(b);
  }
  if (!high) return s;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return s;
  }
}

module.exports = { repairAccount };
