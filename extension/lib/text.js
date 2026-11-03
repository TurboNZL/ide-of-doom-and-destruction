'use strict';
// Small text helpers shared by the project/solution code.

const BOM = '\uFEFF';

/** The line ending a text uses ("\r\n" if it has any, else "\n"). */
function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Converts any line endings in `text` to `eol`. */
function withEol(text, eol) {
  return text.replace(/\r\n|\r|\n/g, eol);
}

/** Splits a leading byte order mark from the text so edits can keep it. */
function splitBom(text) {
  return text.startsWith(BOM) ? { bom: BOM, body: text.slice(1) } : { bom: '', body: text };
}

/** Escapes text for use inside an XML attribute or element. */
function xmlEscape(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function xmlUnescape(text) {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Quotes one argument for a POSIX shell. */
function shellQuote(arg) {
  return "'" + String(arg).replace(/'/g, "'\\''") + "'";
}

/** Project files use backslashes; the rest of the code uses forward slashes. */
function toSlash(p) {
  return p.replace(/\\/g, '/');
}

function toBackslash(p) {
  return p.replace(/\//g, '\\');
}

module.exports = { BOM, detectEol, withEol, splitBom, xmlEscape, xmlUnescape, shellQuote, toSlash, toBackslash };
