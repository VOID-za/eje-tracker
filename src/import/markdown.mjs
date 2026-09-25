/**
 * Reading the authoritative scope document.
 *
 * READ-ONLY, ALWAYS. The importer opens `docs/SCOPE.md` from the EJE checkout
 * and never writes anything back: the scope is the product's requirement record
 * and the tracker is the project-control layer on top of it, not a replacement
 * for it and not an editor of it.
 *
 * The parser is deliberately literal. It finds the document's headings and its
 * tables and hands back exactly what they say, including the markers — DONE,
 * SUPERSEDED, ACCEPTANCE BLOCKER, the strike-through on an answered question —
 * because those markers are the document's own judgement and the tracker's job
 * is to carry them, not to second-guess them.
 */

/** Splits a markdown table row into cells, honouring escaped pipes. */
const cells = (line) =>
  line
    .replace(/^\s*\|/, '')
    .replace(/\|\s*$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim());

const isDivider = (line) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');

/**
 * Parses the document into sections, each with its headings and its tables.
 *
 * Returns [{ h2, h3, h4, line, prose, tables: [{ headers, rows, line }] }].
 */
export const parseScope = (markdown) => {
  const lines = markdown.split('\n');
  const sections = [];
  let current = { h2: '', h3: '', h4: '', line: 1, prose: [], tables: [] };
  const push = () => {
    if (current.prose.length > 0 || current.tables.length > 0 || current.h3 !== '') sections.push(current);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = /^(#{2,4})\s+(.*)$/.exec(line);
    if (heading !== null) {
      push();
      const [, hashes, textRaw] = heading;
      const text = textRaw.trim();
      const previous = current;
      current = {
        h2: hashes.length === 2 ? text : previous.h2,
        h3: hashes.length === 3 ? text : hashes.length === 2 ? '' : previous.h3,
        h4: hashes.length === 4 ? text : '',
        line: index + 1,
        prose: [],
        tables: [],
      };
      continue;
    }

    if (line.trim().startsWith('|') && index + 1 < lines.length && isDivider(lines[index + 1])) {
      const headers = cells(line);
      const table = { headers, rows: [], line: index + 1 };
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        table.rows.push({ cells: cells(lines[index]), line: index + 1 });
        index += 1;
      }
      index -= 1;
      current.tables.push(table);
      continue;
    }

    // A CONTINUATION ROW. The scope document sometimes carries on a table after
    // a blank line without repeating its header (PARTS-17…22 continue the CR-12
    // table that way). Those rows are part of the table above them, and reading
    // them as prose would silently drop six requirements.
    if (line.trim().startsWith('|') && current.tables.length > 0) {
      const table = current.tables[current.tables.length - 1];
      const row = cells(line);
      if (row.length === table.headers.length) {
        table.rows.push({ cells: row, line: index + 1 });
        continue;
      }
    }

    current.prose.push(line);
  }
  push();
  return sections;
};

/** Strips markdown emphasis so a status cell can be compared. */
export const plain = (value) =>
  String(value ?? '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .trim();

/** Keeps the wording but removes the strike-through markers around it. */
export const unstrike = (value) => String(value ?? '').replace(/~~/g, '');

/** Every scope identifier mentioned in a piece of text. */
export const idsIn = (text) => {
  const found = new Set();
  const pattern = /\b(CR|BD|AUD|MANDATE|MOD|VER|PROC|DELIV|QA|OFF|PWA|ACC-OFF|ACC-PWA|PARTS|IMMUT|REF|ROLE|SUBMIT|TAKEOVER|DOC|JOB|SEC|ARCH|EMAIL|DEMO|IDEM|AVAIL|BROWSER)-\d+[a-z]?\b/g;
  for (const match of String(text ?? '').matchAll(pattern)) found.add(match[0]);
  return [...found];
};

/** The first commit hash a cell names, if any. */
export const hashesIn = (text) =>
  [...String(text ?? '').matchAll(/`([0-9a-f]{7,40})`/g)].map((match) => match[1]);
