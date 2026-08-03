import { sql, SQLDialect, type SQLNamespace } from "@codemirror/lang-sql";

/**
 * Base SQL keyword set. CodeMirror's `SQLDialect.define({ keywords })` *replaces*
 * the built-in `SQLKeywords` (it does not merge), and `SQLKeywords` is not
 * exported — so the common SQL keywords (select, from, where, ...) must be
 * included here verbatim or the Lezer grammar won't tokenize them and syntax
 * highlighting silently disappears. Built-in dialects (PostgreSQL, etc.) append
 * their extras to this same base string; we do the same for ClickHouse below.
 */
const BASE_SQL_KEYWORDS =
  "absolute action add after all allocate alter and any are as asc assertion at authorization " +
  "before begin between both breadth by call cascade cascaded case cast catalog check close collate " +
  "collation column commit condition connect connection constraint constraints constructor continue " +
  "corresponding count create cross cube current current_date current_default_transform_group " +
  "current_transform_group_for_type current_path current_role current_time current_timestamp " +
  "current_user cursor cycle data day deallocate declare default deferrable deferred delete depth " +
  "deref desc describe descriptor deterministic diagnostics disconnect distinct do domain drop dynamic " +
  "each else elseif end end-exec equals escape except exception exec execute exists exit external fetch " +
  "first for foreign found from free full function general get global go goto grant group grouping handle " +
  "having hold hour identity if immediate in indicator initially inner inout input insert intersect into " +
  "is isolation join key language last lateral leading leave left level like limit local localtime " +
  "localtimestamp locator loop map match method minute modifies module month names natural nesting new " +
  "next no none not of old on only open option or order ordinality out outer output overlaps pad " +
  "parameter partial path prepare preserve primary prior privileges procedure public read reads recursive " +
  "redo ref references referencing relative release repeat resignal restrict result return returns revoke " +
  "right role rollback rollup routine row rows savepoint schema scroll search second section select session " +
  "session_user set sets signal similar size some space specific specifictype sql sqlexception sqlstate " +
  "sqlwarning start state static system_user table temporary then timezone_hour timezone_minute to trailing " +
  "transaction translation treat trigger under undo union unique unnest until update usage user using value " +
  "values view when whenever where while without work write year zone";

/**
 * ClickHouse-specific keywords appended to the base SQL set. Lowercase to match
 * the base set (the grammar keyword-matches case-insensitively). Multi-word
 * clauses are added as their individual tokens (the parser composes them).
 */
const CLICKHOUSE_KEYWORDS =
  "prewhere final format settings attach detach optimize truncate kill mutation materialized " +
  "cluster clusters dictionary dictionaries distributed engine partition sample " +
  "ttl backup restore disk policy quota profile access";

/**
 * Full keyword spec for the dialect: base SQL + ClickHouse extras (deduped).
 */
const KEYWORDS = `${BASE_SQL_KEYWORDS} ${CLICKHOUSE_KEYWORDS}`;

/**
 * ClickHouse built-in types. Surfaced for both highlighting and completion.
 */
const TYPES =
  "UInt8 UInt16 UInt32 UInt64 UInt128 UInt256 Int8 Int16 Int32 Int64 Int128 Int256 " +
  "Float32 Float64 Decimal Decimal32 Decimal64 Decimal128 Decimal256 String " +
  "FixedString UUID Date Date32 DateTime DateTime64 Enum8 Enum16 LowCardinality " +
  "Array Tuple Map Nested Nullable Nothing IPv4 IPv6 Bool JSON Object AggregateFunction " +
  "SimpleAggregateFunction Point Polygon MultiPolygon Ring MultiRing";

/**
 * Common ClickHouse built-in functions / aggregate functions.
 */
const BUILTIN =
  "count sum avg min max any anyLast uniq uniqExact uniqCombined uniqCombined64 " +
  "groupArray groupUniqArray arrayJoin array flatten groupBitmap arrayMap arrayFilter " +
  "arrayFill arraySplit arrayReverseFill arrayReverseSplit arrayDifference " +
  "quantile quantiles quantileExact quantileTDigest quantileTiming median " +
  "argMin argMax if multiIf transform toUInt8 toUInt16 toUInt32 toUInt64 toInt8 " +
  "toInt16 toInt32 toInt64 toFloat32 toFloat64 toString toUUID toDate toDateTime " +
  "toDateTime64 toDecimal32 toDecimal64 toDecimal128 base64Decode base64Encode MD5 " +
  "SHA256 hex unhex length lower upper trim replaceAll splitByChar splitByString " +
  "substring position reinterpret toTypeName JSONExtract toJSONString " +
  "dictGet dictGetOrDefault dictHas dictGetUInt64 dictGetString runningDifference " +
  "neighbor rowNumberInBlock rowNumberInAllBlocks blockNumber rowNumberInAllChunks";

/**
 * A CodeMirror SQL dialect configured for ClickHouse:
 *  - slash-slash and dash-dash line comments + C-style block comments
 *  - double-quoted and backtick-quoted identifiers
 *  - case-insensitive identifiers (ClickHouse is case-insensitive for unquoted ids)
 */
export const clickhouseDialect = SQLDialect.define({
  keywords: KEYWORDS,
  types: TYPES,
  builtin: BUILTIN,
  slashComments: true,
  identifierQuotes: '"`',
  caseInsensitiveIdentifiers: true,
});

interface ClickhouseSqlOptions {
  /** Schema namespace (db → table → columns) used for schema completion. */
  schema?: SQLNamespace;
}

/**
 * Returns the SQL `LanguageSupport` for the ClickHouse dialect with the given
 * schema wired up for native keyword + schema completion (tables after FROM,
 * `db.table.column` dotted completion).
 */
export function clickhouseSql({ schema }: ClickhouseSqlOptions = {}) {
  return sql({ dialect: clickhouseDialect, schema, upperCaseKeywords: true });
}
