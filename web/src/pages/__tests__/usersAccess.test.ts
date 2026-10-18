import { describe, it, expect } from "vitest";
import { tabFromParam } from "../UsersAccess";

// The ?tab= param is user-editable; an unknown value must fall back to the
// "users" tab instead of rendering an empty page.
describe("tabFromParam", () => {
  it("accepts the known tab ids", () => {
    expect(tabFromParam("users")).toBe("users");
    expect(tabFromParam("roles")).toBe("roles");
    expect(tabFromParam("grants")).toBe("grants");
    expect(tabFromParam("quota")).toBe("quota");
  });

  it("falls back to users for unknown values", () => {
    expect(tabFromParam("foo")).toBe("users");
    expect(tabFromParam("USERS")).toBe("users");
    expect(tabFromParam("")).toBe("users");
  });

  it("falls back to users when the param is absent", () => {
    expect(tabFromParam(null)).toBe("users");
  });
});
