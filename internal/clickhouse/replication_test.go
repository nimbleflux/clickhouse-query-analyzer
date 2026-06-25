package clickhouse

import "testing"

func TestDeriveReplicationSummary(t *testing.T) {
	out := &ReplicationStatus{
		ReplicaStatuses: []ReplicaStatus{
			{QueueSize: 10, AbsoluteDelay: 5, IsReadOnly: 0},
			{QueueSize: 0, AbsoluteDelay: 400, IsReadOnly: 1},
			{QueueSize: 3, AbsoluteDelay: 12, IsReadOnly: 0},
		},
		ReplicationQueue: []ReplicationQueueEntry{
			{NumTries: 1},
			{NumTries: 10},
			{NumTries: 5},
			{NumTries: 0},
		},
		Mutations: []MutationEntry{{}, {}, {}},
	}

	c := &Client{}
	s := c.deriveReplicationSummary(out)

	if s.ReplicaCount != 3 {
		t.Errorf("ReplicaCount = %d, want 3", s.ReplicaCount)
	}
	if s.TotalQueueDepth != 13 {
		t.Errorf("TotalQueueDepth = %d, want 13", s.TotalQueueDepth)
	}
	if s.MaxAbsoluteDelay != 400 {
		t.Errorf("MaxAbsoluteDelay = %v, want 400", s.MaxAbsoluteDelay)
	}
	if s.ReadOnlyReplicas != 1 {
		t.Errorf("ReadOnlyReplicas = %d, want 1", s.ReadOnlyReplicas)
	}
	if s.StuckTasks != 2 {
		t.Errorf("StuckTasks = %d, want 2 (num_tries > 3)", s.StuckTasks)
	}
	if s.PendingMutations != 3 {
		t.Errorf("PendingMutations = %d, want 3", s.PendingMutations)
	}
}

func TestDeriveReplicationSummary_Empty(t *testing.T) {
	c := &Client{}
	s := c.deriveReplicationSummary(&ReplicationStatus{})
	if s != (ReplicationSummary{}) {
		t.Errorf("empty input should yield zero summary, got %+v", s)
	}
}
