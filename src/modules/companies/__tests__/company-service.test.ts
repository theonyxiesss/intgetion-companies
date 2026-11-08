import { describe, expect, it } from "vitest";
import { HttpError } from "@intgetion/kit";
import {
  assertCompanyEditable,
  isPossibleDuplicate,
  resolveEmployerCompany,
} from "../service";

describe("company authorization", () => {
  const internal = { origin: "internal" as const };
  it.each(["owner", "admin"])("allows %s to edit", (role) => {
    expect(() => assertCompanyEditable(internal, role)).not.toThrow();
  });
  it.each(["recruiter", "member"])("returns 403 for visible %s", (role) => {
    expect(() => assertCompanyEditable(internal, role)).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });
  it("hides a company from non-members", () => {
    expect(() => assertCompanyEditable(internal, null)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
  it("makes imported companies read-only", () => {
    try {
      assertCompanyEditable({ origin: "imported" }, "owner");
      throw new Error("expected imported company rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 422, code: "IMPORTED_READONLY" });
    }
  });
});

describe("possible duplicate rules", () => {
  it("flags a matching domain", () =>
    expect(isPossibleDuplicate("Example.com", "example.com", 0)).toBe(true));
  it("flags name similarity at or above 0.8", () =>
    expect(isPossibleDuplicate(null, null, 0.8)).toBe(true));
  it("does not flag name similarity below 0.8", () =>
    expect(isPossibleDuplicate(null, null, 0.79)).toBe(false));
});

describe("employer company context", () => {
  const first = { id: "first", name: "First", origin: "internal" };
  const second = { id: "second", name: "Second", origin: "internal" };

  it("selects the only company automatically", () => {
    expect(resolveEmployerCompany([first])).toEqual({
      companies: [first],
      selected: first,
    });
  });

  it("requires an explicit choice when there are multiple companies", () => {
    expect(resolveEmployerCompany([first, second]).selected).toBeNull();
    expect(resolveEmployerCompany([first, second], "second").selected).toBe(
      second,
    );
  });

  it("hides imported or non-member companies", () => {
    expect(
      resolveEmployerCompany([
        first,
        { id: "imported", name: "Imported", origin: "imported" },
      ]).companies,
    ).toEqual([first]);
    expect(() => resolveEmployerCompany([first], "outsider")).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
});
