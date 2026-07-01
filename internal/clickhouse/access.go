package clickhouse

import (
	"context"
	"fmt"
	"strings"
)

// UserRow is one row of system.users.
type UserRow struct {
	Name            string   `json:"name"`
	Storage         string   `json:"storage"`
	AuthType        []string `json:"auth_type"`
	DefaultRoles    []string `json:"default_roles"`
	DefaultDatabase string   `json:"default_database"`
}

// RoleRow is one row of system.roles.
type RoleRow struct {
	Name    string `json:"name"`
	Storage string `json:"storage"`
}

// GrantRow is one row of system.grants. Either user_name or role_name is set;
// the other is null.
type GrantRow struct {
	UserName        string `json:"user_name"`
	RoleName        string `json:"role_name"`
	AccessType      string `json:"access_type"`
	Database        string `json:"database"`
	Table           string `json:"table"`
	Column          string `json:"column"`
	IsPartialRevoke uint8  `json:"is_partial_revoke"`
	GrantOption     uint8  `json:"grant_option"`
}

// QuotaUsageRow is one row of system.quota_usage: a consumption bucket. The
// max_* fields are null when the quota sets no limit for that dimension.
type QuotaUsageRow struct {
	QuotaName     string  `json:"quota_name"`
	QuotaKey      string  `json:"quota_key"`
	StartTime     string  `json:"start_time"`
	EndTime       string  `json:"end_time"`
	Duration      uint32  `json:"duration"`
	Queries       uint64  `json:"queries"`
	MaxQueries    uint64  `json:"max_queries"`
	Errors        uint64  `json:"errors"`
	ResultRows    uint64  `json:"result_rows"`
	ResultBytes   uint64  `json:"result_bytes"`
	ReadRows      uint64  `json:"read_rows"`
	ReadBytes     uint64  `json:"read_bytes"`
	ExecutionTime float64 `json:"execution_time"`
}

// RoleGrant is one row of system.role_grants: a role granted to a user or
// another role. Unlike system.users.default_roles_list (which only covers
// default roles), this covers ALL role grants — default and non-default — so
// the Roles tab can show every member.
type RoleGrant struct {
	UserName        string `json:"user_name"`
	GrantedRoleName string `json:"granted_role_name"`
	IsDefault       uint8  `json:"granted_role_is_default"`
	WithAdminOption uint8  `json:"with_admin_option"`
}

// QuotaDef is one row of system.quotas: a quota's configuration (independent of
// consumption). Shown so the usage rows can be tied back to the quota that
// defines the limits and window.
type QuotaDef struct {
	Name          string   `json:"name"`
	Keys          string   `json:"keys"`
	Durations     []uint32 `json:"durations"`
	ApplyToAll    uint8    `json:"apply_to_all"`
	ApplyToList   []string `json:"apply_to_list"`
	ApplyToExcept []string `json:"apply_to_except"`
}

// AccessOverview is the composite returned by the Users & Access page. The
// system tables behind access management are frequently restricted, so each is
// fetched independently and recorded via addPartial — the page degrades to
// whichever sections the current user can read.
type AccessOverview struct {
	CurrentUser         string            `json:"current_user"`
	CanManageAccess     bool              `json:"can_manage_access"`
	Users               []UserRow         `json:"users"`
	Roles               []RoleRow         `json:"roles"`
	Grants              []GrantRow        `json:"grants"`
	RoleGrants          []RoleGrant       `json:"role_grants"`
	Quotas              []QuotaDef        `json:"quotas"`
	QuotaUsage          []QuotaUsageRow   `json:"quota_usage"`
	PartialErrors       []string          `json:"partial_errors"`
	PartialErrorDetails map[string]string `json:"partial_error_details,omitempty"`
}

func (a *AccessOverview) addPartial(table string, err error) {
	if err == nil {
		return
	}
	if a.PartialErrorDetails == nil {
		a.PartialErrorDetails = map[string]string{}
	}
	if _, ok := a.PartialErrorDetails[table]; !ok {
		a.PartialErrors = append(a.PartialErrors, table)
	}
	a.PartialErrorDetails[table] = err.Error()
}

// GetAccess assembles the access-management view. The capability probe decides
// whether the UI offers destructive actions; every manage call is still
// validated server-side (the probe can be wrong or privileges partial).
func (c *Client) GetAccess(ctx context.Context) (*AccessOverview, error) {
	out := &AccessOverview{Users: []UserRow{}, Roles: []RoleRow{}, Grants: []GrantRow{}, RoleGrants: []RoleGrant{}, Quotas: []QuotaDef{}, QuotaUsage: []QuotaUsageRow{}}

	c.queryCurrentUser(ctx, out)
	c.queryAccessCapability(ctx, out)
	c.queryUsers(ctx, out)
	c.queryRoles(ctx, out)
	c.queryGrants(ctx, out)
	c.queryRoleGrants(ctx, out)
	c.queryQuotas(ctx, out)
	c.queryQuotaUsage(ctx, out)

	return out, nil
}

func (c *Client) queryCurrentUser(ctx context.Context, out *AccessOverview) {
	var u string
	if err := c.conn.QueryRow(ctx, "SELECT currentUser()").Scan(&u); err != nil {
		return // non-fatal; current_user is informational
	}
	out.CurrentUser = u
}

// queryAccessCapability probes whether the current user holds an access-
// management privilege. Used only to decide whether to show manage UI; the
// server re-checks on every action.
func (c *Client) queryAccessCapability(ctx context.Context, out *AccessOverview) {
	const q = `SELECT count() > 0 FROM system.grants
		WHERE user_name = currentUser()
		  AND access_type IN ('ACCESS_MANAGEMENT','CREATE USER','ALTER USER','DROP USER','ROLE ADMIN')`
	var ok bool
	if err := c.conn.QueryRow(ctx, q).Scan(&ok); err != nil {
		return
	}
	out.CanManageAccess = ok
}

func (c *Client) queryUsers(ctx context.Context, out *AccessOverview) {
	const q = `SELECT name, storage, arrayStringConcat(auth_type, ','),
		arrayStringConcat(default_roles_list, ','), default_database
		FROM system.users ORDER BY name`
	rows, err := c.conn.Query(ctx, q)
	if err != nil {
		out.addPartial("system.users", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var u UserRow
		var auth, roles string
		if err := rows.Scan(&u.Name, &u.Storage, &auth, &roles, &u.DefaultDatabase); err != nil {
			out.addPartial("system.users", err)
			return
		}
		u.AuthType = splitCSV(auth)
		u.DefaultRoles = splitCSV(roles)
		out.Users = append(out.Users, u)
	}
}

func (c *Client) queryRoles(ctx context.Context, out *AccessOverview) {
	rows, err := c.conn.Query(ctx, "SELECT name, storage FROM system.roles ORDER BY name")
	if err != nil {
		out.addPartial("system.roles", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var r RoleRow
		if err := rows.Scan(&r.Name, &r.Storage); err != nil {
			out.addPartial("system.roles", err)
			return
		}
		out.Roles = append(out.Roles, r)
	}
}

func (c *Client) queryGrants(ctx context.Context, out *AccessOverview) {
	const q = `SELECT assumeNotNull(user_name), assumeNotNull(role_name),
		access_type, assumeNotNull(database), assumeNotNull(table), assumeNotNull(column),
		is_partial_revoke, grant_option
		FROM system.grants
		WHERE user_name IS NOT NULL OR role_name IS NOT NULL
		ORDER BY user_name, role_name, access_type`
	rows, err := c.conn.Query(ctx, q)
	if err != nil {
		out.addPartial("system.grants", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var g GrantRow
		if err := rows.Scan(&g.UserName, &g.RoleName, &g.AccessType, &g.Database, &g.Table, &g.Column,
			&g.IsPartialRevoke, &g.GrantOption); err != nil {
			out.addPartial("system.grants", err)
			return
		}
		out.Grants = append(out.Grants, g)
	}
}

func (c *Client) queryRoleGrants(ctx context.Context, out *AccessOverview) {
	const q = `SELECT assumeNotNull(user_name), granted_role_name, granted_role_is_default, with_admin_option
		FROM system.role_grants
		WHERE user_name IS NOT NULL
		ORDER BY granted_role_name, user_name`
	rows, err := c.conn.Query(ctx, q)
	if err != nil {
		out.addPartial("system.role_grants", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var rg RoleGrant
		if err := rows.Scan(&rg.UserName, &rg.GrantedRoleName, &rg.IsDefault, &rg.WithAdminOption); err != nil {
			out.addPartial("system.role_grants", err)
			return
		}
		out.RoleGrants = append(out.RoleGrants, rg)
	}
}

func (c *Client) queryQuotas(ctx context.Context, out *AccessOverview) {
	const q = `SELECT name, arrayStringConcat(keys, ','),
		durations, apply_to_all,
		arrayStringConcat(apply_to_list, ','), arrayStringConcat(apply_to_except, ',')
		FROM system.quotas ORDER BY name`
	rows, err := c.conn.Query(ctx, q)
	if err != nil {
		out.addPartial("system.quotas", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var qf QuotaDef
		var keys, applyList, applyExcept string
		if err := rows.Scan(&qf.Name, &keys, &qf.Durations, &qf.ApplyToAll, &applyList, &applyExcept); err != nil {
			out.addPartial("system.quotas", err)
			return
		}
		qf.Keys = keys
		qf.ApplyToList = splitCSV(applyList)
		qf.ApplyToExcept = splitCSV(applyExcept)
		out.Quotas = append(out.Quotas, qf)
	}
}

func (c *Client) queryQuotaUsage(ctx context.Context, out *AccessOverview) {
	const q = `SELECT quota_name, quota_key, toString(start_time), toString(end_time), assumeNotNull(duration),
		assumeNotNull(queries), assumeNotNull(max_queries),
		assumeNotNull(errors), assumeNotNull(result_rows), assumeNotNull(result_bytes),
		assumeNotNull(read_rows), assumeNotNull(read_bytes), assumeNotNull(execution_time)
		FROM system.quota_usage
		WHERE start_time IS NOT NULL
		ORDER BY start_time DESC
		LIMIT 200`
	rows, err := c.conn.Query(ctx, q)
	if err != nil {
		out.addPartial("system.quota_usage", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var q QuotaUsageRow
		if err := rows.Scan(&q.QuotaName, &q.QuotaKey, &q.StartTime, &q.EndTime, &q.Duration,
			&q.Queries, &q.MaxQueries, &q.Errors, &q.ResultRows, &q.ResultBytes,
			&q.ReadRows, &q.ReadBytes, &q.ExecutionTime); err != nil {
			out.addPartial("system.quota_usage", err)
			return
		}
		out.QuotaUsage = append(out.QuotaUsage, q)
	}
}

// DropUser drops a ClickHouse user. The server re-checks privileges.
func (c *Client) DropUser(ctx context.Context, name string) error {
	return c.conn.Exec(ctx, fmt.Sprintf("DROP USER IF EXISTS %s", quoteIdent(name)))
}

// DropRole drops a ClickHouse role.
func (c *Client) DropRole(ctx context.Context, name string) error {
	return c.conn.Exec(ctx, fmt.Sprintf("DROP ROLE IF EXISTS %s", quoteIdent(name)))
}

// RevokeGrant revokes a grant described by a system.grants row. granteeKind is
// "user" or "role". The ON clause is reconstructed from database/table/column;
// column-level and grant-option nuances are best-effort.
func (c *Client) RevokeGrant(ctx context.Context, granteeKind, grantee, accessType, database, table, column string, grantOption bool) error {
	on := "*.*"
	switch {
	case database != "" && table != "" && column != "":
		on = fmt.Sprintf("%s.%s (%s)", quoteIdent(database), quoteIdent(table), quoteIdent(column))
	case database != "" && table != "":
		on = fmt.Sprintf("%s.%s", quoteIdent(database), quoteIdent(table))
	case database != "":
		on = fmt.Sprintf("%s.*", quoteIdent(database))
	}
	kw := "FROM"
	if granteeKind == "role" {
		kw = "FROM"
	}
	stmt := fmt.Sprintf("REVOKE %s ON %s %s %s", accessType, on, kw, quoteIdent(grantee))
	if grantOption {
		// Revoke only the WITH GRANT OPTION, not the underlying privilege.
		stmt = "REVOKE GRANT OPTION FOR " + stmt[len("REVOKE "):]
	}
	return c.conn.Exec(ctx, stmt)
}

// splitCSV splits the comma-joined arrays returned via arrayString(..., ',').
// Empty string → nil so JSON encodes null (consistent with empty elsewhere).
func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// quoteIdent backtick-quotes an identifier for DDL statements (DROP USER, etc.).
// Identifiers come from system tables, not user input, but quoting guards
// against reserved words / odd names.
func quoteIdent(s string) string {
	return "`" + strings.ReplaceAll(s, "`", "``") + "`"
}
