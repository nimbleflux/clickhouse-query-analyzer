import type { CompletionContext, CompletionResult, Completion } from "@codemirror/autocomplete";

export type SqlNs = Record<string, Record<string, string[]>>;

/**
 * Completion context keywords. When the last keyword before the cursor is a
 * "column position" keyword, we offer the FROM table's columns; when it's a
 * FROM/JOIN, we offer databases/tables.
 */
const COLUMN_KW = new Set(["SELECT", "WHERE", "ORDER", "GROUP", "HAVING", "BY", "ON", "AND", "OR", "DISTINCT"]);
const TABLE_KW = new Set(["FROM", "JOIN"]);

function tokenizeUpper(text: string): string[] {
  return text.toUpperCase().split(/[^A-Z_]+/).filter(Boolean);
}

/** The last SQL keyword appearing in `text` (uppercased), or "" if none. */
export function lastKeyword(text: string): string {
  const toks = tokenizeUpper(text);
  for (let i = toks.length - 1; i >= 0; i--) {
    if (COLUMN_KW.has(toks[i]) || TABLE_KW.has(toks[i])) return toks[i];
  }
  return "";
}

/** All column names of a resolved {db, table} reference (empty if unknown). */
export function columnsOfResolved(ns: SqlNs, ref: { db: string; table: string }): string[] {
  if (ref.db) return ns[ref.db]?.[ref.table] ?? [];
  // Unqualified table: find the database that owns it.
  for (const db of Object.keys(ns)) {
    if (ns[db] && Object.prototype.hasOwnProperty.call(ns[db], ref.table)) return ns[db][ref.table];
  }
  return [];
}

/**
 * Resolve table references from FROM/JOIN clauses anywhere in `text` (the whole
 * statement, so columns are offered even when the cursor sits before the FROM).
 * `db.table` is taken literally; a bare `table` is resolved to its database when
 * unambiguous across the namespace.
 */
export function resolveFromTables(text: string, ns: SqlNs): { db: string; table: string }[] {
  const refs: { db: string; table: string }[] = [];
  const stripped = text.replace(/--[^\n]*/g, " ").replace(/\/\*.*?\*\//g, " ");
  const tokens = stripped.split(/[\s,()]+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const up = tokens[i].toUpperCase();
    if (up !== "FROM" && up !== "JOIN") continue;
    const next = tokens[i + 1] || "";
    const dotted = next.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
    if (dotted) {
      refs.push({ db: dotted[1], table: dotted[2] });
      continue;
    }
    const bare = next.match(/^([A-Za-z_]\w*)$/);
    if (bare) {
      const owners = Object.keys(ns).filter((d) => ns[d] && Object.prototype.hasOwnProperty.call(ns[d], bare[1]));
      refs.push({ db: owners.length === 1 ? owners[0] : "", table: bare[1] });
    }
  }
  return refs;
}

function allTables(ns: SqlNs): string[] {
  const set = new Set<string>();
  for (const db of Object.keys(ns)) for (const t of Object.keys(ns[db])) set.add(t);
  return [...set];
}

/**
 * A context-aware completion source for ClickHouse SQL layered on top of
 * @codemirror/lang-sql. lang-sql alone doesn't track the FROM clause, so it
 * suggests tables/databases in column positions (e.g. after SELECT/ORDER BY).
 * This source resolves the statement's FROM table(s) and offers their columns
 * in projection/predicate positions, databases/tables after FROM, and columns
 * after a `db.table.` qualifier.
 */
export function makeSqlCompletion(getNs: () => SqlNs) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const ns = getNs();
    const doc = ctx.state.doc.toString();
    const before = doc.slice(0, ctx.pos);

    // Don't interfere inside a string literal.
    if (/'[^']*$/.test(before) || /"[^"]*$/.test(before)) return null;

    // Dotted completion: "qual.part" — qual is a database (→ tables) or a
    // table (→ columns). The trailing part may be empty (cursor right after a
    // dot, e.g. "db.table.").
    const dotted = before.match(/([A-Za-z_]\w*)\.(\w*)$/);
    if (dotted) {
      const [, qual, part] = dotted;
      const from = ctx.pos - part.length;
      let options: Completion[];
      if (ns[qual]) {
        options = Object.keys(ns[qual]).map((t) => ({ label: t, type: "type" }));
      } else {
        const cols = columnsOfResolved(ns, { db: "", table: qual });
        options = cols.map((c) => ({ label: c, type: "property" }));
      }
      return options.length ? { from, options, validFor: /^[A-Za-z_]\w*$/ } : null;
    }

    // Word completion (the token being typed may be empty — e.g. right after a
    // space following ORDER BY). The context is driven by the last keyword, so
    // we offer columns/tables even with no partial word.
    const word = before.match(/[A-Za-z_]\w*$/);
    const from = word ? ctx.pos - word[0].length : ctx.pos;

    const kw = lastKeyword(before);
    let options: Completion[] = [];
    if (TABLE_KW.has(kw)) {
      // After FROM/JOIN: databases and tables.
      options = [
        ...Object.keys(ns).map((d) => ({ label: d, type: "namespace" })),
        ...allTables(ns).map((t) => ({ label: t, type: "type" })),
      ];
    } else if (COLUMN_KW.has(kw)) {
      // Column position: columns of the FROM table(s), plus the table names
      // themselves (for qualified refs like table.col).
      const cols = new Set<string>();
      for (const ref of resolveFromTables(doc, ns)) {
        cols.add(ref.table);
        for (const c of columnsOfResolved(ns, ref)) cols.add(c);
      }
      options = [...cols].map((c) => ({ label: c, type: "property" }));
    } else {
      return null; // Let lang-sql handle keywords/functions elsewhere.
    }

    return options.length ? { from, options, validFor: /^[A-Za-z_]\w*$/ } : null;
  };
}
