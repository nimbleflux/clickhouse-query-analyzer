package clickhouse

import (
	"context"
	"fmt"
	"strconv"
	"strings"
)

type ExplainResult struct {
	Plan          string            `json:"plan,omitempty"`
	Pipeline      string            `json:"pipeline,omitempty"`
	PipelineGraph string            `json:"pipeline_graph,omitempty"`
	Syntax        string            `json:"syntax,omitempty"`
	Estimate      *ExplainEstimate  `json:"estimate,omitempty"`
	Errors        map[string]string `json:"errors,omitempty"`
}

type ExplainEstimate struct {
	Rows   uint64 `json:"rows"`
	Blocks uint64 `json:"blocks"`
	Bytes  uint64 `json:"bytes"`
	Parts  uint64 `json:"parts"`
	Marks  uint64 `json:"marks"`
	Raw    string `json:"raw,omitempty"`
}

func (c *Client) GetExplain(ctx context.Context, query string) (*ExplainResult, error) {
	result := &ExplainResult{Errors: map[string]string{}}

	plan, err := c.runExplain(ctx, "EXPLAIN PLAN", query)
	if err == nil {
		result.Plan = plan
	} else {
		result.Errors["plan"] = err.Error()
	}

	pipeline, err := c.runExplain(ctx, "EXPLAIN PIPELINE", query)
	if err == nil {
		result.Pipeline = pipeline
	} else {
		result.Errors["pipeline"] = err.Error()
	}

	pipelineGraph, err := c.runExplain(ctx, "EXPLAIN PIPELINE graph=1", query)
	if err == nil {
		result.PipelineGraph = pipelineGraph
	} else {
		result.Errors["pipeline_graph"] = err.Error()
	}

	syntax, err := c.runExplain(ctx, "EXPLAIN SYNTAX", query)
	if err == nil {
		result.Syntax = syntax
	} else {
		result.Errors["syntax"] = err.Error()
	}

	estimate, err := c.runExplainEstimate(ctx, query)
	if err == nil && estimate != nil {
		result.Estimate = estimate
	} else if err != nil {
		result.Errors["estimate"] = err.Error()
	}

	if len(result.Errors) == 0 {
		result.Errors = nil
	}
	return result, nil
}

func (c *Client) runExplain(ctx context.Context, explainType, query string) (string, error) {
	explainQuery := fmt.Sprintf("%s %s", explainType, query)

	rows, err := c.conn.Query(ctx, explainQuery)
	if err != nil {
		return "", fmt.Errorf("running %s: %w", explainType, err)
	}
	defer rows.Close()

	var result string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return "", fmt.Errorf("scanning explain row: %w", err)
		}
		if result != "" {
			result += "\n"
		}
		result += line
	}
	return result, nil
}

func (c *Client) runExplainEstimate(ctx context.Context, query string) (*ExplainEstimate, error) {
	rows, err := c.conn.Query(ctx, fmt.Sprintf("EXPLAIN ESTIMATE %s", query))
	if err != nil {
		return nil, fmt.Errorf("running EXPLAIN ESTIMATE: %w", err)
	}
	defer rows.Close()

	var lines []string
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			return nil, fmt.Errorf("scanning EXPLAIN ESTIMATE row: %w", err)
		}
		lines = append(lines, line)
	}

	if len(lines) == 0 {
		return nil, nil
	}

	estimate := &ExplainEstimate{Raw: strings.Join(lines, "\n")}
	for _, line := range lines {
		parsed := parseEstimateLine(line)
		if parsed != nil {
			estimate.Rows += parsed.Rows
			estimate.Blocks += parsed.Blocks
			estimate.Bytes += parsed.Bytes
			estimate.Parts += parsed.Parts
			estimate.Marks += parsed.Marks
		}
	}
	return estimate, nil
}

func parseEstimateLine(line string) *ExplainEstimate {
	parts := strings.Fields(line)
	if len(parts) < 5 {
		return nil
	}
	e := &ExplainEstimate{}
	var err error
	if e.Rows, err = strconv.ParseUint(parts[0], 10, 64); err != nil {
		return nil
	}
	if e.Blocks, err = strconv.ParseUint(parts[1], 10, 64); err != nil {
		return nil
	}
	if e.Bytes, err = strconv.ParseUint(parts[2], 10, 64); err != nil {
		return nil
	}
	if e.Parts, err = strconv.ParseUint(parts[3], 10, 64); err != nil {
		return nil
	}
	if e.Marks, err = strconv.ParseUint(parts[4], 10, 64); err != nil {
		return nil
	}
	return e
}
