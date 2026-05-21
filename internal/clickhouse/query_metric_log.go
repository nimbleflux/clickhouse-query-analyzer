package clickhouse

import (
	"context"
	"fmt"
	"time"
)

type MetricPoint struct {
	EventTime      time.Time `json:"event_time"`
	MemoryUsage    uint64    `json:"memory_usage"`
	PeakMemory     uint64    `json:"peak_memory_usage"`
	UserTimeUs     uint64    `json:"user_time_microseconds"`
	SystemTimeUs   uint64    `json:"system_time_microseconds"`
	DiskReadUs     uint64    `json:"disk_read_elapsed_microseconds"`
	DiskWriteUs    uint64    `json:"disk_write_elapsed_microseconds"`
	NetworkReadUs  uint64    `json:"network_receive_elapsed_microseconds"`
	NetworkWriteUs uint64    `json:"network_send_elapsed_microseconds"`
	ReadBytes      uint64    `json:"read_bytes"`
	WriteBytes     uint64    `json:"write_bytes"`
	NetRecvBytes   uint64    `json:"network_receive_bytes"`
	NetSendBytes   uint64    `json:"network_send_bytes"`
	ReadRows       uint64    `json:"read_rows"`
	ThreadCount    uint64    `json:"thread_count"`
}

func (c *Client) GetQueryMetrics(ctx context.Context, queryID string) ([]MetricPoint, error) {
	table := c.tableRef("query_metric_log")
	query := fmt.Sprintf(`SELECT
		event_time,
		memory_usage,
		peak_memory_usage,
		ProfileEvent_UserTimeMicroseconds,
		ProfileEvent_SystemTimeMicroseconds,
		ProfileEvent_DiskReadElapsedMicroseconds,
		ProfileEvent_DiskWriteElapsedMicroseconds,
		ProfileEvent_NetworkReceiveElapsedMicroseconds,
		ProfileEvent_NetworkSendElapsedMicroseconds,
		ProfileEvent_ReadBufferFromFileDescriptorReadBytes,
		ProfileEvent_WriteBufferFromFileDescriptorWriteBytes,
		ProfileEvent_NetworkReceiveBytes,
		ProfileEvent_NetworkSendBytes,
		ProfileEvent_SelectedRows,
		ProfileEvent_OSReadChars
	FROM %s
	WHERE query_id = ?
	ORDER BY event_time ASC`, table)

	rows, err := c.conn.Query(ctx, query, queryID)
	if err != nil {
		return nil, fmt.Errorf("querying query_metric_log: %w", err)
	}
	defer rows.Close()

	var points []MetricPoint
	for rows.Next() {
		var p MetricPoint
		if err := rows.Scan(
			&p.EventTime, &p.MemoryUsage, &p.PeakMemory,
			&p.UserTimeUs, &p.SystemTimeUs,
			&p.DiskReadUs, &p.DiskWriteUs,
			&p.NetworkReadUs, &p.NetworkWriteUs,
			&p.ReadBytes, &p.WriteBytes,
			&p.NetRecvBytes, &p.NetSendBytes,
			&p.ReadRows,
			&p.ThreadCount,
		); err != nil {
			return nil, fmt.Errorf("scanning metric row: %w", err)
		}
		points = append(points, p)
	}
	return points, nil
}
