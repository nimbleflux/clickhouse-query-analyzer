package clickhouse

import "testing"

func TestSplitKey(t *testing.T) {
	tests := []struct {
		name     string
		key      string
		expected []string
	}{
		{"empty", "", nil},
		{"single", "col1", []string{"col1"}},
		{"multiple", "col1, col2, col3", []string{"col1", "col2", "col3"}},
		{"with backticks", "`col1`, `col2`", []string{"col1", "col2"}},
		{"spaces", "  col1  ,  col2  ", []string{"col1", "col2"}},
		{"trailing comma", "col1,", []string{"col1"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitKey(tt.key)
			if len(got) != len(tt.expected) {
				t.Fatalf("expected %v, got %v", tt.expected, got)
			}
			for i, v := range got {
				if v != tt.expected[i] {
					t.Errorf("element %d: got %q, want %q", i, v, tt.expected[i])
				}
			}
		})
	}
}

func TestContains(t *testing.T) {
	slice := []string{"a", "b", "c"}

	if !contains(slice, "a") {
		t.Error("expected to find 'a'")
	}
	if contains(slice, "d") {
		t.Error("expected not to find 'd'")
	}
	if contains(nil, "a") {
		t.Error("expected false for nil slice")
	}
}

func TestIsStringType(t *testing.T) {
	tests := []struct {
		typ      string
		expected bool
	}{
		{"String", true},
		{"FixedString(16)", true},
		{"UUID", true},
		{"Enum8('a' = 1)", true},
		{"Nullable(String)", true},
		{"Int64", false},
		{"Float64", false},
	}

	for _, tt := range tests {
		if got := isStringType(tt.typ); got != tt.expected {
			t.Errorf("isStringType(%q) = %v, want %v", tt.typ, got, tt.expected)
		}
	}
}

func TestIsIntType(t *testing.T) {
	tests := []struct {
		typ      string
		expected bool
	}{
		{"Int8", true},
		{"Int16", true},
		{"Int32", true},
		{"Int64", true},
		{"UInt8", true},
		{"UInt16", true},
		{"UInt32", true},
		{"UInt64", true},
		{"Int128", true},
		{"Int256", true},
		{"UInt128", true},
		{"UInt256", true},
		{"Nullable(Int64)", true},
		{"String", false},
		{"Float64", false},
	}

	for _, tt := range tests {
		if got := isIntType(tt.typ); got != tt.expected {
			t.Errorf("isIntType(%q) = %v, want %v", tt.typ, got, tt.expected)
		}
	}
}

func TestIsNumericType(t *testing.T) {
	if !isNumericType("Float64") {
		t.Error("expected Float64 to be numeric")
	}
	if !isNumericType("Int64") {
		t.Error("expected Int64 to be numeric")
	}
	if isNumericType("String") {
		t.Error("expected String to not be numeric")
	}
	if !isNumericType("Nullable(Float32)") {
		t.Error("expected Nullable(Float32) to be numeric")
	}
}

func TestIsDateOrDateTimeType(t *testing.T) {
	tests := []struct {
		typ      string
		expected bool
	}{
		{"Date", true},
		{"Date32", true},
		{"DateTime", true},
		{"DateTime64(3)", true},
		{"Nullable(DateTime)", true},
		{"String", false},
		{"Int64", false},
	}

	for _, tt := range tests {
		if got := isDateOrDateTimeType(tt.typ); got != tt.expected {
			t.Errorf("isDateOrDateTimeType(%q) = %v, want %v", tt.typ, got, tt.expected)
		}
	}
}

func TestStripNullable(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"Nullable(String)", "String"},
		{"Nullable(Int64)", "Int64"},
		{"String", "String"},
		{"Int64", "Int64"},
	}

	for _, tt := range tests {
		if got := stripNullable(tt.input); got != tt.expected {
			t.Errorf("stripNullable(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}

func TestParseMinMaxInt(t *testing.T) {
	min, max, err := parseMinMaxInt("0", "255")
	if err != nil || min != 0 || max != 255 {
		t.Errorf("expected (0, 255, nil), got (%d, %d, %v)", min, max, err)
	}

	min, max, err = parseMinMaxInt("-128", "127")
	if err != nil || min != -128 || max != 127 {
		t.Errorf("expected (-128, 127, nil), got (%d, %d, %v)", min, max, err)
	}

	_, _, err = parseMinMaxInt("abc", "123")
	if err == nil {
		t.Error("expected error for non-numeric input")
	}
}

func TestSuggestIntType(t *testing.T) {
	tests := []struct {
		name     string
		min      int64
		max      int64
		expected string
	}{
		{"uint8 range", 0, 255, "UInt8"},
		{"uint16 range", 0, 65535, "UInt16"},
		{"uint32 range", 0, 4294967295, "UInt32"},
		{"too large uint", 0, 1 << 40, ""},
		{"int8 range", -128, 127, "Int8"},
		{"int16 range", -32768, 32767, "Int16"},
		{"int32 range", -2147483648, 2147483647, "Int32"},
		{"too large int", -1 << 40, 1 << 40, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := suggestIntType(tt.min, tt.max); got != tt.expected {
				t.Errorf("suggestIntType(%d, %d) = %q, want %q", tt.min, tt.max, got, tt.expected)
			}
		})
	}
}

func TestSuggestUIntType(t *testing.T) {
	tests := []struct {
		max      uint64
		expected string
	}{
		{255, "UInt8"},
		{65535, "UInt16"},
		{4294967295, "UInt32"},
		{1 << 40, ""},
	}

	for _, tt := range tests {
		if got := suggestUIntType(0, tt.max); got != tt.expected {
			t.Errorf("suggestUIntType(0, %d) = %q, want %q", tt.max, got, tt.expected)
		}
	}
}

func TestIntTypeSize(t *testing.T) {
	tests := []struct {
		typ      string
		expected int
	}{
		{"Int8", 1},
		{"UInt8", 1},
		{"Int16", 2},
		{"UInt16", 2},
		{"Int32", 4},
		{"UInt32", 4},
		{"Int64", 8},
		{"UInt64", 8},
		{"Int128", 16},
		{"UInt128", 16},
		{"Int256", 32},
		{"UInt256", 32},
		{"Unknown", 8},
	}

	for _, tt := range tests {
		if got := intTypeSize(tt.typ); got != tt.expected {
			t.Errorf("intTypeSize(%q) = %d, want %d", tt.typ, got, tt.expected)
		}
	}
}

func TestSeverity(t *testing.T) {
	if severity(0.01, 0.05, 0.10) != "high" {
		t.Error("expected high severity")
	}
	if severity(0.07, 0.05, 0.10) != "medium" {
		t.Error("expected medium severity")
	}
	if severity(0.15, 0.05, 0.10) != "low" {
		t.Error("expected low severity")
	}
}

func TestEstimateLowCardSavings(t *testing.T) {
	if estimateLowCardSavings(0.005) != "90-95%" {
		t.Error("expected 90-95% for very low cardinality")
	}
	if estimateLowCardSavings(0.03) != "70-85%" {
		t.Error("expected 70-85% for low cardinality")
	}
	if estimateLowCardSavings(0.10) != "40-60%" {
		t.Error("expected 40-60% for moderate cardinality")
	}
}

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		bytes    uint64
		expected string
	}{
		{0, "0 B"},
		{512, "512 B"},
		{1536, "1.5 KB"},
		{1572864, "1.5 MB"},
		{1610612736, "1.5 GB"},
		{1649267441664, "1.5 TB"},
	}

	for _, tt := range tests {
		if got := formatBytes(tt.bytes); got != tt.expected {
			t.Errorf("formatBytes(%d) = %q, want %q", tt.bytes, got, tt.expected)
		}
	}
}

func TestSampleSource(t *testing.T) {
	tests := []struct {
		rows        uint64
		samplingKey string
		expected    string
	}{
		// Small tables are read whole regardless of a sampling key.
		{99999, "", ""},
		{99999, "id", ""},
		// Tables with a sampling key get proportional SAMPLE.
		{100000, "id", "SAMPLE 0.01"},
		{9999999, "id", "SAMPLE 0.01"},
		{10000000, "id", "SAMPLE 0.001"},
		// Tables WITHOUT a sampling key must never get SAMPLE
		// (SAMPLING_NOT_ENABLED) — they fall back to bounded LIMIT reads.
		{100000, "", "LIMIT 100000"},
		{9999999, "", "LIMIT 100000"},
		{10000000, "", "LIMIT 1000000"},
	}

	for _, tt := range tests {
		if got := sampleSource(tt.rows, tt.samplingKey); got != tt.expected {
			t.Errorf("sampleSource(%d, %q) = %q, want %q", tt.rows, tt.samplingKey, got, tt.expected)
		}
	}
}

// TestQuoteStr covers the backslash breakout: ClickHouse honors \'
// escapes inside single-quoted literals, so quoteStr must double
// backslashes before doubling quotes or a trailing \ terminates the
// literal early and the rest of the value executes as SQL.
func TestQuoteStr(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"plain", "'plain'"},
		{"it's", "'it''s'"},
		{`trailing\`, `'trailing\\'`},
		{`x\' UNION SELECT 1 -- `, `'x\\'' UNION SELECT 1 -- '`},
		{"", "''"},
	}
	for _, tt := range tests {
		if got := quoteStr(tt.in); got != tt.want {
			t.Errorf("quoteStr(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestConfidenceAssess(t *testing.T) {
	tests := []struct {
		name     string
		ctx      confidenceCtx
		expected string
	}{
		{"data_type low rows", confidenceCtx{totalRows: 100, totalSampled: 50, category: "data_type"}, "low"},
		{"data_type medium rows", confidenceCtx{totalRows: 50000, totalSampled: 5000, category: "data_type"}, "medium"},
		{"data_type high rows", confidenceCtx{totalRows: 2000000, totalSampled: 50000, category: "data_type"}, "high"},
		{"order_by always low", confidenceCtx{category: "order_by"}, "low"},
		{"partition_by with rows", confidenceCtx{totalRows: 100, category: "partition_by"}, "high"},
		{"partition_by no rows", confidenceCtx{totalRows: 0, category: "partition_by"}, "low"},
		{"index low", confidenceCtx{totalRows: 10000, category: "index"}, "low"},
		{"index medium", confidenceCtx{totalRows: 500000, category: "index"}, "medium"},
		{"index high", confidenceCtx{totalRows: 5000000, category: "index"}, "high"},
		{"codec low", confidenceCtx{totalRows: 10000, totalSampled: 5000, category: "codec"}, "low"},
		{"codec medium", confidenceCtx{totalRows: 1000000, totalSampled: 50000, category: "codec"}, "medium"},
		{"health always high", confidenceCtx{category: "health"}, "high"},
		{"unknown defaults medium", confidenceCtx{category: "something"}, "medium"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.ctx.assess(); got != tt.expected {
				t.Errorf("assess() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestInferRole(t *testing.T) {
	tests := []struct {
		name       string
		pe         map[string]uint64
		threadName string
		expected   string
	}{
		{"TCPHandler", nil, "TCPHandler", "Coordinator"},
		{"QueryPullPipeEx", nil, "QueryPullPipeEx", "Pipeline Manager"},
		{"ThreadPoolRead", nil, "ThreadPoolRead", "I/O Pool"},
		{"scan and filter", map[string]uint64{"SelectedRows": 100, "FilterTransformPassedRows": 50}, "worker", "Scan + Filter"},
		{"table scanner", map[string]uint64{"SelectedRows": 100}, "worker", "Table Scanner"},
		{"aggregator keys", map[string]uint64{"AggregatedKeys": 100}, "worker", "Aggregator"},
		{"aggregator merged", map[string]uint64{"MergedRows": 100}, "worker", "Aggregator"},
		{"insert writer", map[string]uint64{"InsertedRows": 100}, "worker", "Insert Writer"},
		{"filter only", map[string]uint64{"FilterTransformPassedRows": 50}, "worker", "Filter"},
		{"reader", map[string]uint64{"CreatedReadBufferOrdinary": 1}, "worker", "Reader"},
		{"default worker", map[string]uint64{}, "worker", "Worker"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := inferRole(tt.pe, tt.threadName); got != tt.expected {
				t.Errorf("inferRole() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestShortenSymbol(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"DB::SomeClass::method()", "SomeClass::method"},
		{"DB::SomeClass const", "SomeClass"},
		{"DB::SomeClass", "SomeClass"},
		{"SomeClass::method()", "SomeClass::method"},
		{"DB::SomeClass(const int)", "SomeClass"},
	}

	for _, tt := range tests {
		if got := shortenSymbol(tt.input); got != tt.expected {
			t.Errorf("shortenSymbol(%q) = %q, want %q", tt.input, got, tt.expected)
		}
	}
}
