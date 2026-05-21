package clickhouse

import (
	"context"
	"fmt"
)

type ExplainResult struct {
	Plan     string `json:"plan,omitempty"`
	Pipeline string `json:"pipeline,omitempty"`
	Syntax   string `json:"syntax,omitempty"`
}

func (c *Client) GetExplain(ctx context.Context, query string) (*ExplainResult, error) {
	result := &ExplainResult{}

	plan, err := c.runExplain(ctx, "EXPLAIN PLAN", query)
	if err == nil {
		result.Plan = plan
	}

	pipeline, err := c.runExplain(ctx, "EXPLAIN PIPELINE", query)
	if err == nil {
		result.Pipeline = pipeline
	}

	syntax, err := c.runExplain(ctx, "EXPLAIN SYNTAX", query)
	if err == nil {
		result.Syntax = syntax
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
